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
const ReconnectBackoff = require('../util/reconnectBackoff.js');
const RustPlusHistory = require('../util/rustplusHistory.js');
const RustPlusSync = require('../util/rustplusSync.js');
const ServerAddressHandler = require('../handlers/serverAddressHandler.js');
const SetupServerList = require('../discordTools/SetupServerList.js');
const StorageMonitorHandler = require('../handlers/storageMonitorHandler.js');

/*
    Storage monitors are polled every 30 polls (about five minutes at the default polling interval), so a monitor that
    is adopted in between would say "not connected" for minutes. Ask for the state of the connected server right away;
    the handler also posts the message of every monitor, so the caller must not post it a second time.

    Returns false when the guild is not connected to that server, the caller posts the message then.
*/
async function refreshStorageMonitors(client, device) {
    const rustplus = client.rustplusInstances ? client.rustplusInstances[device.guildId] : null;

    if (!rustplus || !rustplus.isOperational || rustplus.serverId !== device.serverKey) return false;

    /* The next monitor cycle is due now, the handler resets the counter after it ran. */
    rustplus.storageMonitorIntervalCounter = 29;

    await StorageMonitorHandler.handler(rustplus, client);

    return true;
}

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        for (const guild of client.guilds.cache) {
            require('../util/createInstanceFile')(client, guild[1]);
            require('../util/createCredentialsFile')(client, guild[1]);
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
        else {
            /*
                Without a token every Battlemetrics request would be answered with 401, the bot asks for nothing at all.
                Say so once, otherwise the missing player information looks like a bug.
            */
            client.log(client.intlGet(null, 'infoCap'),
                'Battlemetrics is disabled (RPP_BATTLEMETRICS_TOKEN is not set), no requests are sent.', 'info');
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
            const { devices, deaths } = await RustPlusHistory.refresh(client);
            const refreshedStorageMonitors = new Set();

            for (const device of devices) {
                if (!device.serverKey) continue;

                try {
                    if (device.entityType === RustPlusSync.ENTITY_TYPES.SWITCH) {
                        await DiscordMessages.sendSmartSwitchMessage(device.guildId, device.serverKey, device.entityId);
                    }
                    else if (device.entityType === RustPlusSync.ENTITY_TYPES.ALARM) {
                        await DiscordMessages.sendSmartAlarmMessage(device.guildId, device.serverKey, device.entityId);
                    }
                    else if (device.entityType === RustPlusSync.ENTITY_TYPES.STORAGE_MONITOR) {
                        /*
                            A monitor that is adopted while the bot runs has no items/capacity yet, its message would
                            say "not connected" until the monitor cycle runs - and that cycle only runs every 30 polls
                            (about five minutes). Read the state first, the handler posts the messages of the server.
                        */
                        const key = `${device.guildId}|${device.serverKey}`;
                        const refreshed = refreshedStorageMonitors.has(key) ?
                            true : await refreshStorageMonitors(client, device);

                        if (refreshed) {
                            refreshedStorageMonitors.add(key);
                        }
                        else {
                            await DiscordMessages.sendStorageMonitorMessage(device.guildId, device.serverKey,
                                device.entityId);
                        }
                    }

                    client.log(client.intlGet(null, 'infoCap'),
                        `Paired device ${device.entityId} was adopted from the notification history.`);
                }
                catch (e) {
                    client.log(client.intlGet(null, 'warningCap'), e, 'warning');
                }
            }

            /*
                A death of the account is reported as a direct message - the job the removed FCM listener did. The
                history carries the notification, so a death is reported even when the bot was not connected.
            */
            for (const entry of deaths) {
                try {
                    const instance = client.getInstance(entry.guildId);
                    if (!instance || !instance.generalSettings.deathNotifyDm) continue;

                    const sent = await DiscordMessages.sendDeathDirectMessage(entry.guildId, entry.death);

                    if (sent !== 0) {
                        client.log(client.intlGet(null, 'infoCap'),
                            `Death of ${entry.steamId} was reported as a direct message to ${sent} user(s).`);
                    }
                }
                catch (e) {
                    client.log(client.intlGet(null, 'warningCap'), e, 'warn');
                }
            }

            /*
                A server that is adopted while the bot runs has no message in the servers channel, so it would not be
                listed in Discord (and cannot be connected, the button lives on that message).
            */

            /*
                The address of a server is not part of the pairing, so the connect field of its messages stays empty.
                The server list of the game knows it, fill it in before the messages are posted or written again.
            */
            await ServerAddressHandler.handler(client);

            for (const guildId of Object.keys(client.instances || {})) {
                try {
                    const posted = await SetupServerList.postMissingServerMessages(client, guildId);

                    for (const serverId of posted) {
                        client.log(client.intlGet(null, 'infoCap'),
                            `Server ${serverId} was adopted, its message was posted to the servers channel.`);
                    }
                }
                catch (e) {
                    client.log(client.intlGet(null, 'warningCap'), e, 'warn');
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
            }

            if (repaired) client.setInstance(guildId, instance);

            /* Every server of the instance has to be listed, also one that was adopted while the bot was down. */
            await SetupServerList.postMissingServerMessages(client, guildId);

            /* Activate the only server of the guild, createRustplusInstancesFromConfig() connects it then. */
            if (instance.activeServer === null && serverIds.length === 1) {
                const server = instance.serverList[serverIds[0]];

                if (server && server.paired !== false && (server.guid || (server.serverIp && server.appPort))) {
                    instance.activeServer = serverIds[0];
                    client.setInstance(guildId, instance);

                    client.log(client.intlGet(null, 'infoCap'),
                        `Activating the only server of the guild: ${server.title}`);
                }
            }
        }

        client.createRustplusInstancesFromConfig();
    },
    refreshStorageMonitors: refreshStorageMonitors,
};
