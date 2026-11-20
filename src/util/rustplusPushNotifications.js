/*
    Copyright (C) 2026

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

/*
    What a push notification of the Rust+ app does in Discord. These are the jobs of the FCM listener that was removed
    in 85e9dfa and that the notification history cannot do in real time:

    - raid alarm of the raid-alarm plugin (umod.org/plugins/raid-alarm) -> @everyone in the activity channel and the
      in-game team chat; this one only exists as a push notification,
    - smart alarm of a server the bot is not connected to (the connected server reports its alarms over the socket),
    - team login on a server the bot is not connected to (the connected server reports it through the team poll),
    - pairing of a server or device -> applied straight from the push payload (the history is only read when the
      payload carries no pairing, and its timer stays the fallback for pushes that never arrived).

    Deaths are left to the history (util/rustplusHistory.js), it reports them once per guild already.
*/

const Discord = require('discord.js');
const Path = require('path');

const Config = require('../../config');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const RustPlusHistory = require('./rustplusHistory.js');
const Scrape = require('./scrape.js');

const RAID_ALARM_TITLE = 'You\'re getting raided!';

/* The history may not carry a pairing yet when its push notification arrives. */
const PAIRING_REFRESH_DELAY_MS = 3000;

/* { persistentId, channelId, title, message, body } of an FCM data message (src/util/fcm), or null. */
function parse(data) {
    if (!data || !Array.isArray(data.appData)) return null;

    const value = (key) => {
        const item = data.appData.find((entry) => entry && entry.key === key);
        return item ? item.value : undefined;
    };

    const channelId = value('channelId');
    if (!channelId) return null;

    let body = {};
    const rawBody = value('body');

    if (typeof rawBody === 'string' && rawBody !== '') {
        try {
            body = JSON.parse(rawBody);
        }
        catch (e) {
            body = {};
        }
    }

    return {
        persistentId: typeof data.persistentId === 'string' ? data.persistentId : null,
        channelId: `${channelId}`,
        title: value('title') || '',
        message: value('message') || '',
        body: (body && typeof body === 'object') ? body : {},
    };
}

/* What kind of notification this is: 'raidAlarm', 'smartAlarm', 'teamLogin', 'pairing', 'death' or 'other'. */
function classify(notification) {
    const { channelId, title, body } = notification;

    switch (channelId) {
        case 'alarm':
            if (body.type === 'alarm') return 'smartAlarm';
            if (title === RAID_ALARM_TITLE) return 'raidAlarm';
            return 'other';
        case 'team':
            return body.type === 'login' ? 'teamLogin' : 'other';
        case 'pairing':
            return 'pairing';
        case 'player':
            return body.type === 'death' ? 'death' : 'other';
        default:
            return 'other';
    }
}

/* The key of the server of a notification in the server list of a guild (pairing id first, address second). */
function findServerKey(instance, body) {
    const serverList = (instance && instance.serverList) ? instance.serverList : {};

    if (body.id) {
        for (const [key, server] of Object.entries(serverList)) {
            if (server && server.guid && `${server.guid}` === `${body.id}`) return key;
        }

        if (serverList[`relay-${body.id}`]) return `relay-${body.id}`;
    }

    if (body.ip && body.port && serverList[`${body.ip}-${body.port}`]) return `${body.ip}-${body.port}`;

    return null;
}

/* The guilds whose server list belongs to this account. */
function guildsOfAccount(client, steamId) {
    const guildIds = [];

    for (const guildId of Object.keys(client.instances || {})) {
        let instance = null;

        try {
            instance = client.getInstance(guildId);
        }
        catch (e) {
            continue;
        }

        if (instance && RustPlusHistory.steamIdsOfGuild(instance).includes(`${steamId}`)) guildIds.push(guildId);
    }

    return guildIds;
}

function isConnectedTo(client, guildId, serverKey) {
    const rustplus = client.rustplusInstances ? client.rustplusInstances[guildId] : null;

    return Boolean(rustplus && rustplus.serverId === serverKey && rustplus.isOperational);
}

function isValidUrl(url) {
    return typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'));
}

async function raidAlarm(client, guildId, serverKey, notification) {
    const instance = client.getInstance(guildId);
    const { title, message, body } = notification;

    const files = [];
    if (!isValidUrl(body.img)) {
        files.push(new Discord.AttachmentBuilder(Path.join(__dirname, '..', 'resources', 'images', 'rocket.png')));
    }

    await DiscordMessages.sendMessage(guildId, {
        embeds: [DiscordEmbeds.getAlarmRaidAlarmEmbed({ title: title, message: message },
            Object.assign({}, body, { img: isValidUrl(body.img) ? body.img : '' }))],
        content: '@everyone',
        files: files,
    }, null, instance.channelId.activity);

    if (isConnectedTo(client, guildId, serverKey)) {
        client.rustplusInstances[guildId].sendInGameMessage(`${title}: ${message}`);
    }

    return true;
}

async function smartAlarm(client, guildId, serverKey, notification) {
    if (!Config.general.pushAlarmsOtherServers) return false;

    /* The socket of the connected server reports its alarms itself (rustplusEvents/message.js). */
    if (isConnectedTo(client, guildId, serverKey)) return false;

    const instance = client.getInstance(guildId);
    const entityId = notification.body.entityId;
    const server = instance.serverList[serverKey];

    if (!server || !server.alarms || !server.alarms[entityId]) return false;

    server.alarms[entityId].lastTrigger = Math.floor(Date.now() / 1000);
    client.setInstance(guildId, instance);

    await DiscordMessages.sendSmartAlarmTriggerMessage(guildId, serverKey, entityId);

    return true;
}

async function teamLogin(client, guildId, serverKey, notification) {
    /* The team poll of the connected server reports logins itself (handlers/teamHandler.js). */
    if (isConnectedTo(client, guildId, serverKey)) return false;

    const instance = client.getInstance(guildId);
    const body = notification.body;

    let png = null;
    try {
        if (body.targetId) png = await Scrape.scrapeSteamProfilePicture(client, body.targetId);
    }
    catch (e) {
        png = null;
    }

    await DiscordMessages.sendMessage(guildId, {
        embeds: [DiscordEmbeds.getTeamLoginEmbed(guildId, body, png)],
    }, null, instance.channelId.activity);

    return true;
}

/*
    Handle one notification of the account. Returns what was done per guild, for the log and the tests.
    deps.schedule: replaces setTimeout in tests.
*/
async function handle(client, steamId, notification, deps = {}) {
    const schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms));
    const kind = classify(notification);
    const results = [];

    if (kind === 'pairing') {
        /*
            The push carries the whole pairing (player token, device), it is applied right away - the same queue as the
            history timer, which posts the Discord messages. A payload without a pairing makes it read the history.
        */
        const body = notification.body;
        const present = (value) => value !== undefined && value !== null && value !== '';
        const usable = Boolean(body.id) && (present(body.entityId) || present(body.playerToken));

        if (typeof client.refreshPairingHistory === 'function') {
            const run = () => client.refreshPairingHistory(usable ?
                { pushPairing: { steamId: `${steamId}`, body: body } } :
                { steamIds: [`${steamId}`], freshAccountState: true }).catch(() => undefined);

            /* The history may not carry a pairing yet when its push arrives, only that path waits. */
            if (usable) run();
            else schedule(run, PAIRING_REFRESH_DELAY_MS);
        }

        client.log(client.intlGet(null, 'infoCap'),
            `Rust+ push: pairing (${body.type || 'unknown'}${body.entityName ? ` "${body.entityName}"` : ''}) for ` +
            `${steamId}, ${usable ? 'applied from the push' : 'no pairing data in the push, the history is read'}.`);

        return [{ kind: kind, handled: true }];
    }

    if (kind === 'death') return [{ kind: kind, handled: false }];

    if (kind === 'other') {
        /* Logged in full: the formats of new kinds are only known from what arrives. */
        client.log(client.intlGet(null, 'infoCap'),
            `Rust+ push: unhandled notification for ${steamId}: ${JSON.stringify({
                channelId: notification.channelId, title: notification.title, message: notification.message,
                body: notification.body
            })}`);

        return [{ kind: kind, handled: false }];
    }

    for (const guildId of guildsOfAccount(client, steamId)) {
        const instance = client.getInstance(guildId);
        const serverKey = findServerKey(instance, notification.body);

        /* A notification of a server this guild does not know. */
        if (serverKey === null) {
            results.push({ kind: kind, guildId: guildId, handled: false });
            continue;
        }

        let handled = false;

        try {
            if (kind === 'raidAlarm') handled = await raidAlarm(client, guildId, serverKey, notification);
            else if (kind === 'smartAlarm') handled = await smartAlarm(client, guildId, serverKey, notification);
            else if (kind === 'teamLogin') handled = await teamLogin(client, guildId, serverKey, notification);
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `Rust+ push: the ${kind} for ${guildId} failed: ${e && e.message ? e.message : e}`, 'warn');
        }

        if (handled) {
            client.log(client.intlGet(null, 'infoCap'),
                `Rust+ push: ${kind} "${notification.title}" reported to ${guildId}.`);
        }

        results.push({ kind: kind, guildId: guildId, serverKey: serverKey, handled: handled });
    }

    return results;
}

module.exports = {
    RAID_ALARM_TITLE: RAID_ALARM_TITLE,
    parse: parse,
    classify: classify,
    findServerKey: findServerKey,
    guildsOfAccount: guildsOfAccount,
    handle: handle,
};
