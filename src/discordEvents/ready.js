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

        refreshPairingHistory();
        client.pairingHistoryIntervalId = setInterval(refreshPairingHistory,
            Config.general.rustplusHistoryIntervalMs);

        client.createRustplusInstancesFromConfig();
    },
};
