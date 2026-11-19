/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)
    Copyright (C) 2026 FaiThiX
    
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
const CommandHandler = require('../handlers/inGameCommandHandler.js');
const Constants = require('../util/constants.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const InGameChatHandler = require('../handlers/inGameChatHandler.js');
const RaidHandler = require('../handlers/raidHandler.js');
const SmartSwitchGroupHandler = require('../handlers/smartSwitchGroupHandler.js');
const StorageAlerts = require('../util/storageAlerts.js');
const StorageMonitorHandler = require('../handlers/storageMonitorHandler.js');
const SwitchTimeouts = require('../util/switchTimeouts.js');
const TeamChatHandler = require("../handlers/teamChatHandler.js");
const TeamHandler = require('../handlers/teamHandler.js');
const KeyedThrottle = require('../util/keyedThrottle.js');
const { CHANNELS } = require('../util/inGameChat.js');

/* A tool cupboard is read this long after its push, as before the throttle. */
const TOOL_CUPBOARD_READ_DELAY_MS = 2000;

/* The reads of the tool cupboards after their pushes, one per cupboard and pause (see updateToolCupboard). */
const toolCupboardUpdates = KeyedThrottle.createKeyedThrottle(() => DiscordMessages.storageMonitorEditIntervalMs());

/* A chat text reduced to its letters and digits: how the bot recognizes its own messages coming back. */
function botMessageKey(text) {
    return `${text}`.toLowerCase().replace(/&(#\d+|[a-z]+);/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

module.exports = {
    name: 'message',
    botMessageKey: botMessageKey,
    /* exported for tests */
    messageBroadcastEntityChangedStorageMonitor: (...args) => messageBroadcastEntityChangedStorageMonitor(...args),
    resetToolCupboardUpdates: () => toolCupboardUpdates.reset(),
    toolCupboardReadDelayMs: TOOL_CUPBOARD_READ_DELAY_MS,
    async execute(rustplus, client, message) {
        if (!rustplus.isServerAvailable()) return rustplus.deleteThisRustplusInstance();

        if (!rustplus.isOperational) return;

        if (message.hasOwnProperty('response')) {
            messageResponse(rustplus, client, message);
        }
        else if (message.hasOwnProperty('broadcast')) {
            messageBroadcast(rustplus, client, message);
        }
    },
};

async function messageResponse(rustplus, client, message) {
    /* Not implemented */
}

async function messageBroadcast(rustplus, client, message) {
    if (message.broadcast.hasOwnProperty('teamChanged')) {
        messageBroadcastTeamChanged(rustplus, client, message);
    }
    else if (message.broadcast.hasOwnProperty('teamMessage')) {
        messageBroadcastTeamMessage(rustplus, client, message);
    }
    else if (message.broadcast.hasOwnProperty('entityChanged')) {
        messageBroadcastEntityChanged(rustplus, client, message);
    }
    else if (message.broadcast.hasOwnProperty('clanChanged')) {
        messageBroadcastClanChanged(rustplus, client, message);
    }
    else if (message.broadcast.hasOwnProperty('clanMessage')) {
        messageBroadcastClanMessage(rustplus, client, message);
    }
    else if (message.broadcast.hasOwnProperty('cameraRays')) {
        messageBroadcastCameraRays(rustplus, client, message);
    }
    else {
        /* Diagnostic (RPP_DEBUG=true): log broadcasts that rustplusplus does not handle yet. */
        rustplus.log(client.intlGet(null, 'infoCap'),
            `UNHANDLED BROADCAST: ${Object.keys(message.broadcast).join(', ')}`, 'debug');
    }
}

async function messageBroadcastTeamChanged(rustplus, client, message) {
    TeamHandler.handler(rustplus, client, message.broadcast.teamChanged.teamInfo);
    const changed = rustplus.team.isLeaderSteamIdChanged(message.broadcast.teamChanged.teamInfo);
    rustplus.team.updateTeam(message.broadcast.teamChanged.teamInfo);
    if (changed) rustplus.updateLeaderRustPlusLiteInstance();
}

async function messageBroadcastTeamMessage(rustplus, client, message) {
    await handleInGameChatMessage(rustplus, client, message.broadcast.teamMessage.message, CHANNELS.TEAM);
}

/*
    Handles an in-game chat message of the team chat or of the clan chat. In-Game commands are read from both
    channels, the bot writes its own messages to the channel configured in the settings.
*/
async function handleInGameChatMessage(rustplus, client, chatMessage, chatChannel) {
    const instance = client.getInstance(rustplus.guildId);
    const steamId = chatMessage.steamId.toString();

    if (steamId === rustplus.playerId) {
        /* Delay inGameChatHandler */
        clearTimeout(rustplus.inGameChatTimeout);
        const commandDelayMs = parseInt(rustplus.generalSettings.commandDelay) * 1000;
        rustplus.inGameChatTimeout = setTimeout(
            InGameChatHandler.inGameChatHandler, commandDelayMs, rustplus, client);
    }

    /* Some servers (Rustafied) add size and color tags to the name and the message. */
    chatMessage.name = chatMessage.name.replace(/^<size=.*?><color=.*?>/, '')
        .replace(/<\/color><\/size>$/, '');
    chatMessage.message = chatMessage.message.replace(/^<size=.*?><color=.*?>/, '')
        .replace(/<\/color><\/size>$/, '')
        .replace(/^<color.+?<\/color>/g, '');

    let executeInGameCommand = true;

    const inGameCommandAccessMode = getInGameCommandAccessMode(rustplus);
    if (executeInGameCommand && steamId !== rustplus.playerId &&
        shouldIgnoreInGameCommand(instance, steamId, inGameCommandAccessMode)) {
        const strId = inGameCommandAccessMode === 'whitelist' ?
            'userNotPartOfWhitelistInGame' : 'userPartOfBlacklistInGame';
        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, strId, {
            user: `${chatMessage.name} (${steamId})`,
            message: chatMessage.message
        }));
        executeInGameCommand = false;
    }

    /*
        The bot's own message coming back: not a command and not mirrored to Discord. Compared without markup, the
        game returns "<" and ">" (rich text tags) changed, so "High Quality Metal at 199 (< 200)" did not match.
    */
    const sentKey = botMessageKey(chatMessage.message);
    if (executeInGameCommand && sentKey !== '' &&
        rustplus.messagesSentByBot.some((sent) => botMessageKey(sent) === sentKey)) {
        for (let i = rustplus.messagesSentByBot.length - 1; i >= 0; i--) {
            if (botMessageKey(rustplus.messagesSentByBot[i]) === sentKey) {
                rustplus.messagesSentByBot.splice(i, 1);
            }
        }
        return;
    }

    if (executeInGameCommand) {
        const isCommand = await CommandHandler.inGameCommandHandler(rustplus, client, chatMessage);
        if (isCommand) return;

        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, `logInGameMessage`, {
            message: chatMessage.message,
            user: `${chatMessage.name} (${steamId})`
        }));
    }

    await forwardChatMessageToDiscord(rustplus, client, chatMessage, chatChannel);
}

/* Mirrors an in-game chat message into the Discord channel of the same chat. */
async function forwardChatMessageToDiscord(rustplus, client, chatMessage, chatChannel) {
    if (chatChannel === CHANNELS.CLAN) {
        await ClanChatHandler.handler(rustplus, client, chatMessage);
    }
    else {
        await TeamChatHandler(rustplus, client, chatMessage);
    }
}

async function messageBroadcastEntityChanged(rustplus, client, message) {
    const instance = client.getInstance(rustplus.guildId);
    const entityId = message.broadcast.entityChanged.entityId;

    if (instance.serverList[rustplus.serverId].switches.hasOwnProperty(entityId)) {
        messageBroadcastEntityChangedSmartSwitch(rustplus, client, message);
    }
    else if (instance.serverList[rustplus.serverId].alarms.hasOwnProperty(entityId)) {
        messageBroadcastEntityChangedSmartAlarm(rustplus, client, message);
    }
    else if (instance.serverList[rustplus.serverId].storageMonitors.hasOwnProperty(entityId)) {
        messageBroadcastEntityChangedStorageMonitor(rustplus, client, message);
    }
}

async function messageBroadcastCameraRays(rustplus, client, message) {
    /* Not implemented */
}

async function messageBroadcastClanChanged(rustplus, client, message) {
    /* The paired account joined, left or changed its clan: refresh the cached clan info. */
    await ClanChatHandler.updateClanInfo(rustplus, client);
}

async function messageBroadcastClanMessage(rustplus, client, message) {
    await handleInGameChatMessage(rustplus, client, message.broadcast.clanMessage.message, CHANNELS.CLAN);
}

async function messageBroadcastEntityChangedSmartSwitch(rustplus, client, message) {
    const instance = client.getInstance(rustplus.guildId);
    const serverId = rustplus.serverId;
    const entityId = message.broadcast.entityChanged.entityId;
    const server = instance.serverList[serverId];

    if (!server || (server && !server.switches[entityId])) return;

    if (rustplus.interactionSwitches.includes(`${entityId}`)) {
        rustplus.interactionSwitches = rustplus.interactionSwitches.filter(e => e !== `${entityId}`);
        return;
    }

    /* Switched in game: a running "on/off for X" of the switch is over. */
    SwitchTimeouts.cancel(rustplus.guildId, serverId, `${entityId}`);

    const active = message.broadcast.entityChanged.payload.value;
    server.switches[entityId].active = active;
    client.setInstance(rustplus.guildId, instance);

    DiscordMessages.sendSmartSwitchMessage(rustplus.guildId, serverId, entityId);
    SmartSwitchGroupHandler.updateSwitchGroupIfContainSwitch(
        client, rustplus.guildId, serverId, entityId);
}

async function messageBroadcastEntityChangedSmartAlarm(rustplus, client, message) {
    const instance = client.getInstance(rustplus.guildId);
    const serverId = rustplus.serverId;
    const entityId = message.broadcast.entityChanged.entityId;
    const server = instance.serverList[serverId];

    if (!server || (server && !server.alarms[entityId])) return;

    const active = message.broadcast.entityChanged.payload.value;
    server.alarms[entityId].active = active;
    server.alarms[entityId].reachable = true;
    client.setInstance(rustplus.guildId, instance);

    if (active) {
        server.alarms[entityId].lastTrigger = Math.floor(new Date() / 1000);
        client.setInstance(rustplus.guildId, instance);

        /* Cooldown, escalation and raid mode (handlers/raidHandler.js). */
        const decision = RaidHandler.onAlarm(rustplus, entityId);

        if (decision.raidStarted) {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `Raid mode: the alarm ${server.alarms[entityId].name} fired while nobody of the team is online.`, 'warn');
        }

        if (decision.directMessage) {
            DiscordMessages.sendRaidDirectMessage(rustplus.guildId, serverId, `${entityId}`).catch(() => undefined);
        }

        if (decision.post) {
            await DiscordMessages.sendSmartAlarmTriggerMessage(rustplus.guildId, serverId, entityId,
                { everyone: decision.everyone, suppressed: decision.suppressed });

            if (instance.generalSettings.smartAlarmNotifyInGame) {
                rustplus.sendInGameMessage(`${server.alarms[entityId].name}: ${server.alarms[entityId].message}`);
            }
        }

        /* Groups with this alarm as their trigger are turned on (turrets, lights, ...). */
        SmartSwitchGroupHandler.onAlarmTriggered(client, rustplus, entityId).catch((e) => {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The switch groups of the alarm ${entityId} could not be turned on: ${e && e.message ? e.message : e}`,
                'warn');
        });
    }

    DiscordMessages.sendSmartAlarmMessage(rustplus.guildId, rustplus.serverId, entityId);
}

async function messageBroadcastEntityChangedStorageMonitor(rustplus, client, message) {
    const instance = client.getInstance(rustplus.guildId);
    const serverId = rustplus.serverId;
    const entityId = message.broadcast.entityChanged.entityId;
    const server = instance.serverList[serverId];

    if (!server || (server && !server.storageMonitors[entityId])) return;

    if (message.broadcast.entityChanged.payload.value === true) return;

    if (server.storageMonitors[entityId].type === 'toolCupboard' ||
        message.broadcast.entityChanged.payload.capacity === Constants.STORAGE_MONITOR_TOOL_CUPBOARD_CAPACITY) {
        /*
            Read 2 s after the push, and at most once per RPP_STORAGE_MONITOR_EDIT_INTERVAL: a tool cupboard pushes
            every few seconds (issue #8), each push used to cost one getEntityInfo. The read after the pause gets the
            latest state, the upkeep warning and the storage alerts are checked with it.
        */
        toolCupboardUpdates.request(`${rustplus.guildId}:${serverId}:${entityId}`, async () => {
            try {
                await updateToolCupboard(rustplus, client, entityId);
            }
            catch (e) {
                rustplus.log(client.intlGet(null, 'warningCap'),
                    `Reading tool cupboard ${entityId} failed: ${e && e.message ? e.message : e}`, 'warn');
            }
        }, { delayMs: module.exports.toolCupboardReadDelayMs });
    }
    else {
        rustplus.storageMonitors[entityId] = {
            items: message.broadcast.entityChanged.payload.items,
            expiry: message.broadcast.entityChanged.payload.protectionExpiry,
            capacity: message.broadcast.entityChanged.payload.capacity,
            hasProtection: message.broadcast.entityChanged.payload.hasProtection
        }

        const info = await rustplus.getEntityInfoAsync(entityId);
        server.storageMonitors[entityId].reachable = await rustplus.isResponseValid(info) ? true : false;

        if (server.storageMonitors[entityId].reachable) {
            if (info.entityInfo.payload.capacity === Constants.STORAGE_MONITOR_VENDING_MACHINE_CAPACITY) {
                server.storageMonitors[entityId].type = 'vendingMachine';
            }
            else if (info.entityInfo.payload.capacity === Constants.STORAGE_MONITOR_LARGE_WOOD_BOX_CAPACITY) {
                server.storageMonitors[entityId].type = 'largeWoodBox';
            }
        }
        client.setInstance(rustplus.guildId, instance);

        /* The alerts are checked on every push, only the Discord edit waits for the pause. */
        DiscordMessages.sendStorageMonitorMessageThrottled(rustplus.guildId, serverId, entityId).catch((e) => {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `Updating storage monitor ${entityId} failed: ${e && e.message ? e.message : e}`, 'warn');
        });
        await StorageAlerts.check(client, rustplus, entityId);
    }
}

async function updateToolCupboard(rustplus, client, entityId) {
    if (!rustplus.isOperational) return;

    const instance = client.getInstance(rustplus.guildId);
    const server = instance.serverList[rustplus.serverId];
    /* Removed while the read waited for the pause. */
    if (!server || !server.storageMonitors[entityId]) return;

    const info = await rustplus.getEntityInfoAsync(entityId);
    if (!server.storageMonitors[entityId]) return;
    server.storageMonitors[entityId].reachable = await rustplus.isResponseValid(info) ? true : false;
    client.setInstance(rustplus.guildId, instance);

    if (server.storageMonitors[entityId].reachable) {
        rustplus.storageMonitors[entityId] = {
            items: info.entityInfo.payload.items,
            expiry: info.entityInfo.payload.protectionExpiry,
            capacity: info.entityInfo.payload.capacity,
            hasProtection: info.entityInfo.payload.hasProtection
        }

        server.storageMonitors[entityId].type = 'toolCupboard';

        if (info.entityInfo.payload.protectionExpiry === 0 && server.storageMonitors[entityId].decaying === false) {
            server.storageMonitors[entityId].decaying = true;

            await DiscordMessages.sendDecayingNotificationMessage(rustplus.guildId, rustplus.serverId, entityId);

            if (server.storageMonitors[entityId].inGame) {
                rustplus.sendInGameMessage(client.intlGet(rustplus.guildId, 'isDecaying', {
                    device: server.storageMonitors[entityId].name
                }));
            }
        }
        else if (info.entityInfo.payload.protectionExpiry !== 0) {
            server.storageMonitors[entityId].decaying = false;
        }
        client.setInstance(rustplus.guildId, instance);

        /* The early upkeep warning also when the cupboard changed, not only in the monitor cycle. */
        StorageMonitorHandler.warnUpkeep(rustplus, client, rustplus.serverId, entityId,
            info.entityInfo.payload.protectionExpiry);
    }

    /* The alerts do not wait for Discord. */
    DiscordMessages.sendStorageMonitorMessageThrottled(rustplus.guildId, rustplus.serverId, entityId).catch((e) => {
        rustplus.log(client.intlGet(null, 'warningCap'),
            `Updating storage monitor ${entityId} failed: ${e && e.message ? e.message : e}`, 'warn');
    });
    await StorageAlerts.check(client, rustplus, entityId);
}

function getInGameCommandAccessMode(rustplus) {
    const mode = `${rustplus.generalSettings.inGameCommandAccessMode || 'blacklist'}`.toLowerCase();
    return mode === 'whitelist' ? 'whitelist' : 'blacklist';
}

function shouldIgnoreInGameCommand(instance, steamId, inGameCommandAccessMode) {
    const steamIdStr = `${steamId}`;
    const blacklistSteamIds = (instance.blacklist && Array.isArray(instance.blacklist['steamIds'])) ?
        instance.blacklist['steamIds'] : [];

    if (inGameCommandAccessMode === 'whitelist') {
        const whitelistSteamIds = (instance.whitelist && Array.isArray(instance.whitelist['steamIds'])) ?
            instance.whitelist['steamIds'] : [];
        return !whitelistSteamIds.includes(steamIdStr);
    }

    return blacklistSteamIds.includes(steamIdStr);
}
