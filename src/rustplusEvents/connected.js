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

const ClanChatHandler = require('../handlers/clanChatHandler.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const Info = require('../structures/Info');
const Map = require('../structures/Map');
const PollingHandler = require('../handlers/pollingHandler.js');

module.exports = {
    name: 'connected',
    async execute(rustplus, client) {
        if (!rustplus.isServerAvailable()) return rustplus.deleteThisRustplusInstance();

        /* A replaced instance must not run the connect flow of the guild. */
        if (rustplus.isDeleted) return;
        const current = client.rustplusInstances[rustplus.guildId];
        if (current && current !== rustplus) return rustplus.deleteThisRustplusInstance();

        rustplus.log(client.intlGet(null, 'connectedCap'), client.intlGet(null, 'connectedToServer'));

        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;

        /* The endpoint works, so the next connection attempt starts with the direct transport again. */
        client.rustplusConnectFailures = client.rustplusConnectFailures || new Object();
        client.rustplusConnectFailures[guildId] = 0;

        rustplus.uptimeServer = new Date();

        /* Start the token replenish task */
        rustplus.tokensReplenishTaskId = setInterval(rustplus.replenishTokens.bind(rustplus), 1000);

        /*
            Request the map. Act as a check to see if connection is truly operational.

            A server that answers `not_found` to every request is offline, restarting or lost its Rust+ pairing.
            That is temporary, so the server stays configured and the instance reconnects instead of dropping it.
        */
        const map = await rustplus.getMapAsync(3 * 60 * 1000); /* 3 min timeout */
        if (!(await rustplus.isResponseValid(map))) {
            const reason = (map && map.error) ? `${map.error}` : 'unknown';

            rustplus.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'serverNotAnswering', {
                reason: reason
            }), 'error');

            /* Reconnect through the `disconnected` event, keeping activeServer and the server message. */
            rustplus.disconnect();
            return;
        }
        rustplus.log(client.intlGet(null, 'connectedCap'), client.intlGet(null, 'rustplusOperational'));

        const info = await rustplus.getInfoAsync();
        if (await rustplus.isResponseValid(info)) rustplus.info = new Info(info.info)

        if (client.rustplusMaps.hasOwnProperty(guildId)) {
            if (client.isJpgImageChanged(guildId, map.map)) {
                rustplus.map = new Map(map.map, rustplus);

                await rustplus.map.writeMap(false, true);
                await DiscordMessages.sendServerWipeDetectedMessage(guildId, serverId);
                await DiscordMessages.sendInformationMapMessage(guildId);
            }
            else {
                rustplus.map = new Map(map.map, rustplus);

                await rustplus.map.writeMap(false, true);
                await DiscordMessages.sendInformationMapMessage(guildId);
            }
        }
        else {
            rustplus.map = new Map(map.map, rustplus);

            await rustplus.map.writeMap(false, true);
            await DiscordMessages.sendInformationMapMessage(guildId);
        }

        if (client.rustplusReconnecting[guildId]) {
            client.rustplusReconnecting[guildId] = false;

            if (client.rustplusReconnectTimers[guildId]) {
                clearTimeout(client.rustplusReconnectTimers[guildId]);
                client.rustplusReconnectTimers[guildId] = null;
            }

            await DiscordMessages.sendServerChangeStateMessage(guildId, serverId, 0);
        }

        await DiscordMessages.sendServerMessage(guildId, serverId, null);

        /* Setup Smart Devices */
        await require('../discordTools/SetupSwitches')(client, rustplus);
        await require('../discordTools/SetupSwitchGroups')(client, rustplus);
        await require('../discordTools/SetupAlarms')(client, rustplus);
        await require('../discordTools/SetupStorageMonitors')(client, rustplus);
        rustplus.isNewConnection = false;
        rustplus.loadMarkers();

        /* Let the server push changes of the paired entities, like the Rust+ app does. */
        const subscribed = await rustplus.subscribeEntities(instance);
        if (subscribed !== 0) {
            rustplus.log(client.intlGet(null, 'infoCap'),
                `Subscribed to ${subscribed} device(s), their changes are pushed by the server.`);
        }

        await PollingHandler.pollingHandler(rustplus, client);
        rustplus.restorePersistentRuntimeState();
        rustplus.persistMapMarkersRuntimeState();
        rustplus.pollingTaskId = setInterval(PollingHandler.pollingHandler, client.pollingIntervalMs, rustplus, client);
        rustplus.isOperational = true;

        /* Fetch the clan of the paired steam account, the clan chat support of rustplusplus depends on it. */
        try {
            await ClanChatHandler.updateClanInfo(rustplus, client);
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'errorCap'), `Could not fetch the clan info: ${e}`, 'error');
        }

        rustplus.updateLeaderRustPlusLiteInstance();
    },
};
