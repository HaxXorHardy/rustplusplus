/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

const BackgroundHandler = require('../handlers/backgroundHandler.js');
const ClanChatHandler = require('../handlers/clanChatHandler.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const Info = require('../structures/Info');
const Map = require('../structures/Map');
const OfflineAnnouncement = require('../util/offlineAnnouncement.js');
const PollingHandler = require('../handlers/pollingHandler.js');
const RustPlusHistory = require('../util/rustplusHistory.js');
const SwitchTimerRestore = require('../handlers/switchTimerRestore.js');
const WipeHelper = require('../handlers/wipeHelper.js');
const TokenRecovery = require('../util/tokenRecovery.js');
const WithTimeout = require('../util/withTimeout.js');

/*
    How long the connect flow waits for one Discord step before it goes on. The polling only starts at the end of this
    flow: a Discord call that never answered (the information queue behind a hung request) kept a connected server
    without a single poll for five hours - and without a poll, util/tokenRecovery.js could not see that the token
    works and renewed it on every refused history read.
*/
const DISCORD_STEP_TIMEOUT_MS = 30 * 1000;
const SETUP_STEP_TIMEOUT_MS = 2 * 60 * 1000;

/*
    The first poll cycle follows "RUSTPLUS OPERATIONAL" within about a minute. A connection that has not polled after
    this long is stuck somewhere in the connect flow: it looked connected but did nothing (no alarms, no switches, no
    storage monitors), and util/tokenRecovery.js counted every refused history read as a failed renewal until the owner
    got a "please log in again" message - with a working token. Generous on purpose: the device setup steps may each
    wait SETUP_STEP_TIMEOUT_MS for Discord.
*/
const FIRST_POLL_WATCHDOG_MS = 10 * 60 * 1000;

/* Runs one Discord step of the connect flow with a deadline. A failure or a timeout is logged, the flow goes on. */
async function discordStep(client, rustplus, label, step, timeoutMs = DISCORD_STEP_TIMEOUT_MS) {
    try {
        await WithTimeout.withTimeout(Promise.resolve().then(step), timeoutMs, label);
    }
    catch (e) {
        const timedOut = Boolean(e) && e.code === 'ESTEPTIMEOUT';

        rustplus.log(client.intlGet(null, 'warningCap'), timedOut ?
            `${e.message} The connection goes on without it.` :
            `${label} failed: ${e && e.message ? e.message : e}`, 'warn');
    }
}

/*
    Only the connection of the guild may run the connect flow. Another one - a replaced instance, or one whose
    'disconnected' event already removed it from the guild while a late request reconnected it - is retired and its
    socket closed. Returned silently before, such a socket stayed open for hours: nobody polled it, and the Connect
    button could not reach it.
*/
function dropIfNotCurrent(client, rustplus, stage) {
    if (rustplus.isCurrentInstance()) return false;

    if (!rustplus.isDeleted) {
        rustplus.log(client.intlGet(null, 'infoCap'),
            `This connection is not the one of the guild anymore (${stage}), its socket is closed.`, 'debug');
    }

    rustplus.deleteThisRustplusInstance();
    return true;
}

/* Rebuilds a connection that reached "RUSTPLUS OPERATIONAL" but never started to poll (see FIRST_POLL_WATCHDOG_MS). */
function startFirstPollWatchdog(client, rustplus) {
    clearTimeout(rustplus.operationalWatchdog);

    rustplus.operationalWatchdog = setTimeout(() => {
        rustplus.operationalWatchdog = null;

        /* pollCycleId is set by the first cycle of pollingHandler. */
        if (rustplus.isDeleted || rustplus.pollCycleId) return;
        if (dropIfNotCurrent(client, rustplus, 'no poll cycle ran')) return;

        rustplus.log(client.intlGet(null, 'warningCap'),
            `No poll cycle ran within ${FIRST_POLL_WATCHDOG_MS / 60000} minutes after the connection became ` +
            'operational, the connection is rebuilt.', 'warn');

        rustplus.rebuildConnection('no poll cycle after the connect', { force: true });
    }, FIRST_POLL_WATCHDOG_MS);

    if (typeof rustplus.operationalWatchdog.unref === 'function') rustplus.operationalWatchdog.unref();
}

/*
    Runs one device setup step. A failure is logged and must not abort the steps after it: when a single message could
    not be built, the guild lost the alarms and storage monitors of that server as well (and the rejection ended as an
    unhandled one that stopped the whole connect flow).
*/
async function runSetup(client, rustplus, label, setupPath) {
    await discordStep(client, rustplus, `The setup of ${label}`, () => require(setupPath)(client, rustplus),
        SETUP_STEP_TIMEOUT_MS);
}

module.exports = {
    name: 'connected',
    /* exported for tests */
    FIRST_POLL_WATCHDOG_MS: FIRST_POLL_WATCHDOG_MS,
    startFirstPollWatchdog: startFirstPollWatchdog,
    async execute(rustplus, client) {
        if (!rustplus.isServerAvailable()) return rustplus.deleteThisRustplusInstance();

        /* A replaced or removed instance must not run the connect flow of the guild, nor keep its socket. */
        if (dropIfNotCurrent(client, rustplus, 'before the connect flow')) return;

        rustplus.log(client.intlGet(null, 'connectedCap'), client.intlGet(null, 'connectedToServer'));

        const instance = client.getInstance(rustplus.guildId);
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;

        /* The endpoint works, so the next connection attempt starts with the direct transport again. */
        client.rustplusConnectFailures = client.rustplusConnectFailures || new Object();
        client.rustplusConnectFailures[guildId] = 0;

        rustplus.uptimeServer = new Date();

        /*
            Request the map. Act as a check to see if connection is truly operational.

            A server that answers `not_found` to every request is offline, restarting or lost its Rust+ pairing.
            That is temporary, so the server stays configured and the instance reconnects instead of dropping it.
        */
        const map = await rustplus.getMapAsync(3 * 60 * 1000); /* 3 min timeout */
        if (!(await rustplus.isResponseValid(map))) {
            const reason = (map && map.error) ? `${map.error}` : 'unknown';

            /*
                not_found on a fresh connection has two causes: the stored account token was renewed after this socket
                read it (then the reconnect simply uses the stored one), or the server was paired again and the player
                token is stale (then the pairing history carries the new one). Neither is a server failure.
            */
            const isStaleToken = reason === 'not_found';

            rustplus.log(client.intlGet(null, isStaleToken ? 'warningCap' : 'errorCap'),
                client.intlGet(null, 'serverNotAnswering', {
                    reason: reason
                }), isStaleToken ? 'warn' : 'error');

            const tokenWasRenewed = typeof rustplus.hasStaleAuthToken === 'function' && rustplus.hasStaleAuthToken();

            if (isStaleToken && !tokenWasRenewed) {
                /*
                    Only the account of this connection is read, and at most every two minutes: a server that keeps
                    answering not_found must not ask Facepunch for every guild on every reconnect.
                */
                try {
                    await RustPlusHistory.refreshAccount(client, rustplus.playerId);
                }
                catch (e) {
                    rustplus.log(client.intlGet(null, 'warningCap'),
                        `Could not refresh the Rust+ pairing: ${e && e.message ? e.message : e}`, 'debug');
                }
            }

            /*
                Reconnect through the `disconnected` event, keeping activeServer and the server message. A refresh that
                renewed the token already replaced the instance, then this one is done (and its socket closed).
            */
            if (!dropIfNotCurrent(client, rustplus, 'the map was not answered')) rustplus.disconnect();
            return;
        }

        /* The map request awaited the server: a connection that was replaced meanwhile is not operational. */
        if (dropIfNotCurrent(client, rustplus, 'after the map request')) return;

        rustplus.log(client.intlGet(null, 'connectedCap'), client.intlGet(null, 'rustplusOperational'));
        startFirstPollWatchdog(client, rustplus);

        /* The connection works: the strikes, the renewal count and the backoff of the account are forgotten. */
        if (rustplus.playerId) TokenRecovery.markHealthy(rustplus.playerId);

        const info = await rustplus.getInfoAsync();
        if (await rustplus.isResponseValid(info)) rustplus.info = new Info(info.info)

        const wiped = client.rustplusMaps.hasOwnProperty(guildId) && client.isJpgImageChanged(guildId, map.map);

        rustplus.map = new Map(map.map, rustplus);
        await rustplus.map.writeMap(false, true);

        if (wiped) {
            await discordStep(client, rustplus, 'The wipe message',
                () => DiscordMessages.sendServerWipeDetectedMessage(guildId, serverId));
            await discordStep(client, rustplus, 'The wipe checklist', () => WipeHelper.onWipe(client, rustplus));
        }

        await discordStep(client, rustplus, 'The map message',
            () => DiscordMessages.sendInformationMapMessage(guildId));

        if (client.rustplusReconnecting[guildId]) {
            client.rustplusReconnecting[guildId] = false;

            if (client.rustplusReconnectTimers[guildId]) {
                clearTimeout(client.rustplusReconnectTimers[guildId]);
                client.rustplusReconnectTimers[guildId] = null;
            }

            /* The reconnect came within the delay, the pending offline message of the blip is dropped. */
            OfflineAnnouncement.cancel(client, guildId);

            /* `online` is only worth a message when the outage was announced. */
            if (OfflineAnnouncement.takeAnnounced(client, guildId)) {
                await discordStep(client, rustplus, 'The online message',
                    () => DiscordMessages.sendServerChangeStateMessage(guildId, serverId, 0));
            }
        }

        await discordStep(client, rustplus, 'The server message',
            () => DiscordMessages.sendServerMessage(guildId, serverId, null));

        /* A replaced instance must not set up devices, subscribe entities or poll for the guild. */
        if (dropIfNotCurrent(client, rustplus, 'before the device setup')) return;

        /* Setup Smart Devices */
        await runSetup(client, rustplus, 'the smart switches', '../discordTools/SetupSwitches');
        await runSetup(client, rustplus, 'the switch groups', '../discordTools/SetupSwitchGroups');
        await runSetup(client, rustplus, 'the smart alarms', '../discordTools/SetupAlarms');
        await runSetup(client, rustplus, 'the storage monitors', '../discordTools/SetupStorageMonitors');
        rustplus.isNewConnection = false;
        rustplus.loadMarkers();

        /* The setup awaits Discord calls, so the instance can be replaced meanwhile (renewed pairing). */
        if (dropIfNotCurrent(client, rustplus, 'after the device setup')) return;

        /* Let the server push changes of the paired entities, like the Rust+ app does. */
        const subscribed = await rustplus.subscribeEntities(instance);
        if (subscribed !== 0) {
            rustplus.log(client.intlGet(null, 'infoCap'),
                `Subscribed to ${subscribed} device(s), their changes are pushed by the server.`);
        }

        await PollingHandler.pollingHandler(rustplus, client);

        /*
            The subscriptions (up to one timeout per alarm) and the first poll await the server: a socket that closed
            meanwhile has run its 'disconnected' cleanup already. Timers started below would then belong to a retired
            instance that nothing stops - a second poll loop and leader socket next to the live connection.
        */
        if (dropIfNotCurrent(client, rustplus, 'after the first poll')) return;

        rustplus.restorePersistentRuntimeState();
        rustplus.persistMapMarkersRuntimeState();

        /*
            Start both timers here and together: the setup above awaits Discord and the game server, and the 'disconnected'
            event of a previous socket can arrive late (it is closed asynchronously). It clears the timers, and a timer
            that was already set then stayed gone - an instance that polled without ever refilling its token bucket.
        */
        clearInterval(rustplus.pollingTaskId);
        clearInterval(rustplus.tokensReplenishTaskId);

        rustplus.tokensUpdatedMs = Date.now();
        rustplus.tokensReplenishTaskId = setInterval(rustplus.replenishTokens.bind(rustplus), 1000);
        rustplus.pollingTaskId = setInterval(PollingHandler.pollingHandler, client.pollingIntervalMs, rustplus, client);

        /* The embeds and the storage monitors run in their own cycle, they must not hold up the poll. */
        BackgroundHandler.start(rustplus, client);

        rustplus.isOperational = true;

        /* "On/off for X" timers that were running before a restart or a redeploy. */
        try {
            SwitchTimerRestore.restore(client, rustplus);
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'warningCap'), `The switch timers could not be restored: ${e}`, 'warn');
        }

        /* The server answers, the next disconnect starts with the shortest delay again. */
        client.rustplusReconnectAttempts = client.rustplusReconnectAttempts || new Object();
        client.rustplusReconnectAttempts[guildId] = 0;

        /* Fetch the clan of the paired steam account, the clan chat support of rustplusplus depends on it. */
        try {
            await ClanChatHandler.updateClanInfo(rustplus, client);
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'errorCap'), `Could not fetch the clan info: ${e}`, 'error');
        }

        /* The clan request awaited the server as well: a retired instance must not open a leader socket. */
        if (dropIfNotCurrent(client, rustplus, 'after the clan info')) return;

        rustplus.updateLeaderRustPlusLiteInstance();
    },
};
