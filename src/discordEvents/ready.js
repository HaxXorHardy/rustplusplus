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

const Discord = require('discord.js');
const Path = require('path');

const BattlemetricsHandler = require('../handlers/battlemetricsHandler.js');
const Config = require('../../config');
const CredentialsExpiryHandler = require('../handlers/credentialsExpiryHandler.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const RustPlusHistory = require('../util/rustplusHistory.js');
const RustPlusSync = require('../util/rustplusSync.js');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        for (const guild of client.guilds.cache) {
            require('../util/createInstanceFile')(client, guild[1]);
            require('../util/createCredentialsFile')(client, guild[1]);
            client.fcmListenersLite[guild[0]] = new Object();
        }

        client.loadGuildsIntl();
        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'loggedInAs', {
            name: client.user.tag
        }));

        try {
            await client.user.setUsername(Config.discord.username);
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'), client.intlGet(null, 'ignoreSetUsername'));
        }

        try {
            await client.user.setAvatar(Path.join(__dirname, '..', 'resources/images/rustplusplus_logo.png'));
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'), client.intlGet(null, 'ignoreSetAvatar'));
        }

        client.user.setPresence({
            activities: [{ name: '/help', type: Discord.ActivityType.Listening }],
            status: 'online'
        });

        client.uptimeBot = new Date();

        for (let guildArray of client.guilds.cache) {
            const guild = guildArray[1];

            try {
                await guild.members.me.setNickname(Config.discord.username);
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'), client.intlGet(null, 'ignoreSetNickname'));
            }
            await client.syncCredentialsWithUsers(guild);
            await client.setupGuild(guild);
        }

        if (Config.battlemetrics.enabled) {
            await client.updateBattlemetricsInstances();
            BattlemetricsHandler.handler(client, true);
            client.battlemetricsIntervalId = setInterval(BattlemetricsHandler.handler, 60000, client, false);
        }

        /* Notify users when their stored Rust+ credentials are about to expire or have expired. */
        await CredentialsExpiryHandler.handler(client, true);
        client.credentialsExpiryIntervalId = setInterval(CredentialsExpiryHandler.handler,
            Config.general.credentialsExpiryCheckIntervalMs, client, false);

        /*
            Adopt servers and devices that were paired in-game. The notification history of the account knows them,
            so this works without FCM credentials.
        */
        const refreshPairingHistory = async () => {
            const added = await RustPlusHistory.refresh(client);

            for (const device of added) {
                if (!device.serverKey) continue;

                try {
                    if (device.entityType === RustPlusSync.ENTITY_TYPES.SWITCH) {
                        await DiscordMessages.sendSmartSwitchMessage(device.guildId, device.serverKey, device.entityId);
                    }
                    else if (device.entityType === RustPlusSync.ENTITY_TYPES.ALARM) {
                        await DiscordMessages.sendSmartAlarmMessage(device.guildId, device.serverKey, device.entityId);
                    }
                    else if (device.entityType === RustPlusSync.ENTITY_TYPES.STORAGE_MONITOR) {
                        await DiscordMessages.sendStorageMonitorMessage(device.guildId, device.serverKey,
                            device.entityId);
                    }

                    client.log(client.intlGet(null, 'infoCap'),
                        `Paired device ${device.entityId} was adopted from the notification history.`);
                }
                catch (e) {
                    client.log(client.intlGet(null, 'warningCap'), e, 'warning');
                }
            }
        };

        /*
            Awaited on purpose: a renewed pairing carries the player token the connection needs, so the history is
            adopted before the server is connected.
        */
        await refreshPairingHistory();
        client.pairingHistoryIntervalId = setInterval(refreshPairingHistory,
            Config.general.rustplusHistoryIntervalMs);

        /*
            Servers and devices that were adopted from the account state (login, notification history) still need
            their Discord messages, and the only server of a guild is connected right away.
        */
        for (const guildId of Object.keys(client.instances)) {
            const instance = client.getInstance(guildId);
            const serverIds = Object.keys(instance.serverList || {});
            let repaired = false;

            for (const serverId of serverIds) {
                const server = instance.serverList[serverId];
                if (!server) continue;

                /*
                    An entry of an older version, or a pairing that only carried the pairing id, has no address.
                    The relay does not need one, so it is rebuilt from the pairing id.
                */
                if ((!server.serverIp || !server.appPort) && server.guid) {
                    server.serverIp = RustPlusSync.RELAY_SERVER_IP;
                    server.appPort = `${server.guid}`;
                    repaired = true;
                }

                if (!server.serverIp || !server.appPort) {
                    client.log(client.intlGet(null, 'warningCap'),
                        `The server "${server.title}" (${serverId}) has no address and no pairing id, it is ` +
                        'skipped. Pair it again in the Rust+ app or use "/credentials login" in Discord.',
                        'warning');
                    continue;
                }

                if (server.messageId) continue;
                server.messageId = null;

                try {
                    await DiscordMessages.sendServerMessage(guildId, serverId);
                }
                catch (e) {
                    client.log(client.intlGet(null, 'warningCap'),
                        `Could not post the server message of ${serverId}: ${e && e.message ? e.message : e}`,
                        'warning');
                }
            }

            if (repaired) client.setInstance(guildId, instance);

            /* Activate the only server of the guild, createRustplusInstancesFromConfig() connects it then. */
            if (instance.activeServer === null && serverIds.length === 1) {
                const server = instance.serverList[serverIds[0]];

                if (server && (server.guid || (server.serverIp && server.appPort))) {
                    instance.activeServer = serverIds[0];
                    client.setInstance(guildId, instance);

                    client.log(client.intlGet(null, 'infoCap'),
                        `Activating the only server of the guild: ${server.title}`);
                }
            }
        }

        client.createRustplusInstancesFromConfig();
    },
};
