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

const Info = require('../structures/Info');
const CameraWatchHandler = require('../handlers/cameraWatchHandler.js');
const MapMarkers = require('../structures/MapMarkers.js');
const SmartAlarmHandler = require('../handlers/smartAlarmHandler.js');
const SmartSwitchHandler = require('../handlers/smartSwitchHandler.js');
const Team = require('../structures/Team');
const TeamHandler = require('../handlers/teamHandler.js');
const Time = require('../structures/Time');
const TimeHandler = require('../handlers/timeHandler.js');
const VendingMachines = require('../handlers/vendingMachineHandler.js');
const WithTimeout = require('../util/withTimeout.js');

/*
    Runs one handler of the poll. A failing handler must not stop the others and must not end as an unhandled rejection
    on every poll (the poll runs every few seconds).
*/
async function runHandler(rustplus, client, label, handler) {
    rustplus.pollPending = rustplus.pollPending || new Object();

    /* A handler that is still running is skipped instead of started twice (both wait for the same rate limit). */
    if (rustplus.pollPending[label]) {
        rustplus.log(client.intlGet(null, 'infoCap'),
            `poll: ${label} is still running, it is skipped.`, 'debug');
        return;
    }

    rustplus.pollPending[label] = true;
    rustplus.pollPhase = label;
    rustplus.log(client.intlGet(null, 'infoCap'), `poll: ${label}`, 'debug');

    const work = (async () => {
        try {
            await handler();
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The handler for ${label} failed: ${e && e.message ? e.message : e}`, 'warn');
        }
        finally {
            delete rustplus.pollPending[label];
        }
    })();

    try {
        await WithTimeout.withTimeout(work, HANDLER_TIMEOUT_MS, label);
    }
    catch (e) {
        rustplus.log(client.intlGet(null, 'warningCap'),
            `The handler for ${label} is slow (${e && e.message ? e.message : e}), it keeps running.`, 'warn');
    }
}

/* A poll cycle can wait up to 30 s for a free token or a request timeout - the interval must not stack cycles. */
const MAX_FAILED_POLLS = 6;

/* A handler that hangs on Discord (rate limit) must not freeze the cycle: every step gets a deadline. */
const HANDLER_TIMEOUT_MS = 10 * 1000;

/* A cycle that runs longer than this releases the isPolling flag, so the loop recovers on its own. */
const POLL_WATCHDOG_MS = 60 * 1000;

/* The second overlong cycle in a row rebuilds the connection instead of waiting for more. */
const POLL_WATCHDOG_RECONNECT_AFTER = 2;

/* Stops the polling loop of an instance that must not poll anymore. */
function stopPolling(rustplus) {
    clearInterval(rustplus.pollingTaskId);
    rustplus.pollingTaskId = 0;
}

/*
    Is this instance still the one that speaks for its guild? A reconnect can replace an instance while its polling loop
    keeps running; the old one would then poll forever without anyone reading its results.
*/
function isCurrentInstance(rustplus, client) {
    if (rustplus.isDeleted) return false;

    const instances = client.rustplusInstances;
    if (!instances || !Object.prototype.hasOwnProperty.call(instances, rustplus.guildId)) return true;

    return instances[rustplus.guildId] === rustplus;
}

/*
    A connection that keeps failing is torn down and rebuilt instead of polling a dead socket forever (that state used to
    survive for days, with one ERROR per minute for every request). disconnect() starts the regular reconnect with the
    growing delay (see rustplusEvents/disconnected.js).
*/
function updatePollHealth(rustplus, client, success) {
    if (success) {
        rustplus.consecutiveFailedPolls = 0;

        /* Proof that the account token of this socket works (util/tokenRecovery.js trusts it over a refused read). */
        rustplus.lastSuccessfulPollMs = Date.now();
        return;
    }

    rustplus.consecutiveFailedPolls = (rustplus.consecutiveFailedPolls || 0) + 1;

    /*
        The token was renewed elsewhere (another guild, the login, the renewal script): the relay answers this socket
        with not_found until it is opened again with the stored token. No need to wait for more failed polls.
    */
    if (typeof rustplus.hasStaleAuthToken === 'function' && rustplus.hasStaleAuthToken()) {
        rustplus.consecutiveFailedPolls = 0;
        rustplus.rebuildConnection('the stored account token is newer than the one of this socket', { force: true });
        return;
    }

    if (rustplus.consecutiveFailedPolls < MAX_FAILED_POLLS) return;

    rustplus.consecutiveFailedPolls = 0;

    rustplus.log(client.intlGet(null, 'warningCap'),
        `${MAX_FAILED_POLLS} polls in a row got no valid answer from the server, reconnecting.`, 'warn');

    forceReconnect(rustplus, client);
}

/*
    Tear the connection down and let the client build a fresh instance. A socket that is already closed does not emit
    'disconnected' (there is nothing to close), so the instance is replaced here as well - otherwise the same dead
    connection would be polled forever.
*/
function forceReconnect(rustplus, client) {
    rustplus.disconnect();

    const timer = setTimeout(() => {
        if (rustplus.isDeleted) return;
        if (!client.rustplusInstances || client.rustplusInstances[rustplus.guildId] !== rustplus) return;

        stopPolling(rustplus);
        rustplus.isDeleted = true;
        delete client.rustplusInstances[rustplus.guildId];

        client.createRustplusInstance(rustplus.guildId, rustplus.server, rustplus.port, rustplus.playerId,
            rustplus.playerToken);
    }, 5000);

    if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
    pollingHandler: async function (rustplus, client) {
        /*
            One cycle at a time: the previous one may still wait for a token or for a response. A skipped tick is part of
            the delay of every poll-based announcement, so it is written to the log.
        */
        if (rustplus.isPolling) {
            rustplus.log(client.intlGet(null, 'infoCap'),
                'The previous poll cycle is still running, this tick is skipped.', 'debug');
            return;
        }

        if (!isCurrentInstance(rustplus, client)) {
            stopPolling(rustplus);
            rustplus.log(client.intlGet(null, 'infoCap'),
                'The instance was replaced, its polling loop stopped.', 'debug');
            return;
        }

        rustplus.isPolling = true;

        const cycleId = (rustplus.pollCycleId || 0) + 1;
        rustplus.pollCycleId = cycleId;
        rustplus.pollPhase = 'start';

        const startedMs = Date.now();

        /*
            The watchdog releases the flag of a cycle that never finishes (a hung await). Without it the loop stayed
            silent for as long as the caller waited - measured: 15 minutes without a poll and without one log line.
        */
        const watchdog = setTimeout(() => {
            if (rustplus.isDeleted || rustplus.pollCycleId !== cycleId) return;

            rustplus.pollWatchdogHits = (rustplus.pollWatchdogHits || 0) + 1;

            rustplus.log(client.intlGet(null, 'warningCap'),
                `The poll cycle runs longer than ${POLL_WATCHDOG_MS / 1000} s (phase: ${rustplus.pollPhase}), ` +
                'the flag is released.', 'warn');

            rustplus.isPolling = false;

            if (rustplus.pollWatchdogHits >= POLL_WATCHDOG_RECONNECT_AFTER) {
                rustplus.pollWatchdogHits = 0;

                rustplus.log(client.intlGet(null, 'warningCap'),
                    'Poll cycles keep hanging, the connection is rebuilt.', 'warn');

                forceReconnect(rustplus, client);
            }
        }, POLL_WATCHDOG_MS);

        if (typeof watchdog.unref === 'function') watchdog.unref();

        let success = false;
        try {
            success = await module.exports.poll(rustplus, client);
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The poll failed: ${e && e.message ? e.message : e}`, 'warn');
        }
        finally {
            clearTimeout(watchdog);

            if (rustplus.pollCycleId === cycleId) rustplus.isPolling = false;

            rustplus.pollPhase = 'idle';
            rustplus.log(client.intlGet(null, 'infoCap'),
                `Poll cycle: ${Date.now() - startedMs} ms.`, 'debug');
        }

        if (success) rustplus.pollWatchdogHits = 0;

        updatePollHealth(rustplus, client, success);
    },

    /* One poll cycle, true when every request of the cycle was answered. */
    poll: async function (rustplus, client) {
        /* Poll information such as info, mapMarkers, teamInfo and time */
        let info = await rustplus.getInfoAsync();
        if (!(await rustplus.isResponseValid(info))) return false;
        let mapMarkers = await rustplus.getMapMarkersAsync();
        if (!(await rustplus.isResponseValid(mapMarkers))) return false;
        let teamInfo = await rustplus.getTeamInfoAsync();
        if (!(await rustplus.isResponseValid(teamInfo))) return false;
        let time = await rustplus.getTimeAsync();
        if (!(await rustplus.isResponseValid(time))) return false;

        if (rustplus.isFirstPoll) {
            rustplus.info = new Info(info.info);
            rustplus.time = new Time(time.time, rustplus, client);
            rustplus.team = new Team(teamInfo.teamInfo, rustplus);
            rustplus.mapMarkers = new MapMarkers(mapMarkers.mapMarkers, rustplus, client);
            rustplus.restorePersistentRuntimeState();
        }

        await module.exports.handlers(rustplus, client, info, mapMarkers, teamInfo, time);

        rustplus.isFirstPoll = false;

        return true;
    },

    handlers: async function (rustplus, client, info, mapMarkers, teamInfo, time) {
        await runHandler(rustplus, client, 'the team', () => TeamHandler.handler(rustplus, client, teamInfo.teamInfo));
        rustplus.team.updateTeam(teamInfo.teamInfo);

        await runHandler(rustplus, client, 'the smart switches',
            () => SmartSwitchHandler.handler(rustplus, client, time.time));
        await runHandler(rustplus, client, 'the time', () => TimeHandler.handler(rustplus, client, time.time));
        await runHandler(rustplus, client, 'the vending machines',
            () => VendingMachines.handler(rustplus, client, mapMarkers.mapMarkers));

        rustplus.time.updateTime(time.time);
        rustplus.info.updateInfo(info.info);
        rustplus.mapMarkers.updateMapMarkers(mapMarkers.mapMarkers);

        /*
            The information embeds and the storage monitors run in their own cycle (handlers/backgroundHandler.js):
            they fetch 100 messages and post several embeds, and one Discord call waiting on a rate limit froze this
            cycle (all poll-based updates) before.
        */
        await runHandler(rustplus, client, 'the smart alarms', () => SmartAlarmHandler.handler(rustplus, client));

        /*
            The camera watch runs detached: a check needs a photo's worth of frames (seconds), the poll must not wait for
            it. It guards itself (one round at a time, an interval, a pause while the paired account is on the server).
        */
        CameraWatchHandler.handler(rustplus, client).catch((e) => {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The camera watch failed: ${e && e.message ? e.message : e}`, 'warn');
        });
    },
};
