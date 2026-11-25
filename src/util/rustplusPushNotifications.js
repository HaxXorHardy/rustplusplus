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

const AlarmTexts = require('./alarmTexts.js');
const Config = require('../../config');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const RustPlusHistory = require('./rustplusHistory.js');
const Scrape = require('./scrape.js');

const RAID_ALARM_TITLE = 'You\'re getting raided!';

/* The history may not carry a pairing yet when its push notification arrives. */
const PAIRING_REFRESH_DELAY_MS = 3000;

/*
    An alarm push of the connected server waits this long for the socket to report the trigger (broadcast
    entityChanged). Without a report the alarm was not subscribed, the push reports it instead.
*/
const ALARM_SOCKET_GRACE_MS = 5000;

/* A trigger the socket reported this long before the alarm was pushed is the one the push is about. */
const ALARM_SOCKET_WINDOW_S = 60;

/*
    A push that Google sent longer ago than this is not reported as a new trigger: FCM delivers what it queued after a
    reconnect, minutes or hours late, and the raid would long be over. The alarm is still subscribed.
*/
const ALARM_PUSH_MAX_AGE_S = 5 * 60;

/* A trigger message posted this long before the send time of the push still belongs to its trigger (clock skew). */
const ALARM_POST_MARGIN_MS = 10 * 1000;

/*
    When Google sent the message, in ms, or null. DataMessageStanza.sent says seconds in mcs.proto, Google sends
    milliseconds: both are accepted.
*/
function sentAtMs(sent) {
    const value = Number(sent);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (value >= 1e12) return Math.floor(value);
    if (value >= 1e9) return Math.floor(value * 1000);
    return null;
}

/* { persistentId, sentAtMs, channelId, title, message, body } of an FCM data message (src/util/fcm), or null. */
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
        sentAtMs: sentAtMs(data.sent),
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

        if (!instance) continue;

        /*
            The account of the active server, and the account of every other server of the guild: a server paired with
            another account (a guild can have several) sends its alarms and logins to that account, and its pushes were
            dropped before (steamIdsOfGuild only names the account of the active server).
        */
        const ofServer = Object.values(instance.serverList || {})
            .some((server) => server && server.steamId && `${server.steamId}` === `${steamId}`);

        if (ofServer || RustPlusHistory.steamIdsOfGuild(instance).includes(`${steamId}`)) guildIds.push(guildId);
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

/*
    Which alarm of the server a push is about. The alarm push of the game names no entity (seen live: its body has no
    entityId, title and message are the name and the message set in game), so it is found by, in this order: the
    entityId if a push ever carries one, the only alarm of the server, the alarm whose name is the title of the push,
    and with recentTriggerAt (the connected server, after the socket had its time) the only alarm the socket reported
    around that time. null when it cannot be told.
*/
function alarmOfPush(server, notification, recentTriggerAt = null) {
    const alarms = (server && server.alarms) ? server.alarms : {};
    const ids = Object.keys(alarms);
    const entityId = notification.body ? notification.body.entityId : undefined;

    if (entityId !== undefined && entityId !== null && alarms[`${entityId}`]) return `${entityId}`;
    if (ids.length === 1) return ids[0];

    const title = typeof notification.title === 'string' ? notification.title.trim() : '';
    if (title !== '') {
        const named = ids.filter((id) => alarms[id] && `${alarms[id].name}`.trim() === title);
        if (named.length === 1) return named[0];
    }

    if (recentTriggerAt !== null) {
        const recent = ids.filter((id) => {
            const lastTrigger = Number(alarms[id] && alarms[id].lastTrigger);
            return Number.isFinite(lastTrigger) && Math.abs(lastTrigger - recentTriggerAt) <= ALARM_SOCKET_WINDOW_S;
        });
        if (recent.length === 1) return recent[0];
    }

    return null;
}

async function smartAlarm(client, guildId, serverKey, notification, deps = {}) {
    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverKey];

    if (!server || !server.alarms || Object.keys(server.alarms).length === 0) return false;

    const now = deps.now || (() => Date.now());
    const triggeredAt = alarmTime(notification, now());

    /* Without the socket: only an alarm the push itself points to (entityId, the only one, the name). */
    const knownId = alarmOfPush(server, notification);

    /*
        Its texts are taken right away: the push often arrives before the socket reports the trigger (seen live one
        second earlier), and the socket posts the trigger with the texts the alarm has then.
    */
    if (knownId !== null) await takeAlarmTexts(client, guildId, serverKey, knownId, notification, triggeredAt);

    /*
        The socket of the connected server reports its alarms itself (rustplusEvents/message.js) - but only the
        subscribed ones. After its grace time the push tells which alarm it was (also by the trigger the socket
        reported), takes its texts, and checks that the socket reported it.
    */
    if (isConnectedTo(client, guildId, serverKey)) {
        const schedule = deps.schedule || ((fn, ms) => {
            const timer = setTimeout(fn, ms);
            if (timer && typeof timer.unref === 'function') timer.unref();
            return timer;
        });

        schedule(() => (async () => {
            /* An alarm the push did not point to may be told by the trigger the socket reported meanwhile. */
            if (knownId === null) {
                const current = client.getInstance(guildId).serverList[serverKey];
                const entityId = alarmOfPush(current, notification, triggeredAt);

                if (entityId === null) {
                    client.log(client.intlGet(null, 'infoCap'),
                        `Rust+ push: the alarm "${notification.title}" of ${guildId} matches none or several alarms ` +
                        'of the server, its name and message are not taken.', 'debug');
                    return;
                }

                await takeAlarmTexts(client, guildId, serverKey, entityId, notification, triggeredAt);
            }

            /* A trigger the socket reported is no proof for a missed one: only an alarm the push points to. */
            if (knownId !== null) {
                await reportMissedAlarm(client, guildId, serverKey, knownId, triggeredAt, { now: now });
            }
        })().catch((e) => {
            client.log(client.intlGet(null, 'warningCap'),
                `Rust+ push: the alarm "${notification.title}" of ${guildId} could not be checked: ` +
                `${e && e.message ? e.message : e}`, 'warn');
        }), ALARM_SOCKET_GRACE_MS);

        return false;
    }

    if (knownId === null) {
        client.log(client.intlGet(null, 'infoCap'),
            `Rust+ push: the alarm "${notification.title}" of another server of ${guildId} matches none or several ` +
            'of its alarms, it is not reported.', 'debug');
        return false;
    }

    return reportFromPush(client, guildId, serverKey, knownId, triggeredAt, now());
}

/*
    The push names the alarm and its message as they are set in game (util/alarmTexts.js): taken into the alarm unless
    they were set in Discord, the message of the alarm in Discord is updated. The socket of the connected server may
    have posted the trigger with the old texts already; the next trigger has the new ones.
*/
async function takeAlarmTexts(client, guildId, serverKey, entityId, notification, triggeredAt = null) {
    const instance = client.getInstance(guildId);
    const alarm = instance.serverList[serverKey].alarms[entityId];
    const changed = AlarmTexts.applyFromPush(alarm, notification.title, notification.message);

    if (changed.length === 0) return;

    client.setInstance(guildId, instance);
    client.log(client.intlGet(null, 'infoCap'),
        `Rust+ push: the alarm ${entityId} takes its ${changed.join(' and ')} from the game: ` +
        `"${alarm.name}", "${alarm.message}".`);

    await DiscordMessages.sendSmartAlarmMessage(guildId, serverKey, entityId).catch(() => undefined);

    /*
        The socket may have posted this trigger with the old texts a moment earlier (seen live: milliseconds) - only a
        post of this trigger, never the one of the trigger before (ALARM_POST_MARGIN_MS for the clocks).
    */
    const sinceMs = Number.isFinite(triggeredAt) ? triggeredAt * 1000 - ALARM_POST_MARGIN_MS : undefined;
    await DiscordMessages.refreshSmartAlarmTriggerMessage(guildId, serverKey, entityId, { sinceMs: sinceMs })
        .catch(() => false);
}

/*
    The alarm of a server without a socket (another server, or the connection dropped meanwhile) is reported from its
    push alone - if Config.general.pushAlarmsOtherServers allows it and the push is not out of date. Returns whether it
    was reported.
*/
async function reportFromPush(client, guildId, serverKey, entityId, triggeredAt, nowMs) {
    if (!Config.general.pushAlarmsOtherServers) return false;

    const instance = client.getInstance(guildId);
    const server = instance && instance.serverList ? instance.serverList[serverKey] : null;
    const alarm = server && server.alarms ? server.alarms[entityId] : null;

    if (!alarm) return false;

    const ageSeconds = Math.floor(nowMs / 1000) - triggeredAt;
    if (ageSeconds > ALARM_PUSH_MAX_AGE_S) {
        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: the alarm "${alarm.name}" (${entityId}) fired ${Math.round(ageSeconds / 60)} min ago and ` +
            'its push arrived only now, it is not reported.', 'warn');
        return false;
    }

    alarm.lastTrigger = Math.floor(nowMs / 1000);
    client.setInstance(guildId, instance);

    await DiscordMessages.sendSmartAlarmTriggerMessage(guildId, serverKey, entityId);

    return true;
}

/*
    When the alarm fired, in seconds: when Google sent its push, not when the push arrived - a push queued during an
    FCM reconnect arrives minutes after the socket reported the trigger. Arrival time without a usable sent time, and
    for a sent time ahead of the clock of the host.
*/
function alarmTime(notification, nowMs) {
    const sent = notification ? notification.sentAtMs : null;
    const ms = (typeof sent === 'number' && sent <= nowMs + ALARM_SOCKET_WINDOW_S * 1000) ? sent : nowMs;

    return Math.floor(ms / 1000);
}

/*
    The socket did not report an alarm whose push arrived: the alarm is not subscribed (paired while connected, or the
    subscription failed). The trigger is reported through the path of the socket (raid mode, switch groups, in-game
    message), then the alarm is subscribed and its state read, so the next trigger and the reset come from the server.
    triggeredAt is when the alarm fired (alarmTime), in seconds. Returns whether the push reported the trigger.
*/
async function reportMissedAlarm(client, guildId, serverKey, entityId, triggeredAt, deps = {}) {
    const now = deps.now || (() => Date.now());
    const instance = client.getInstance(guildId);
    const server = instance && instance.serverList ? instance.serverList[serverKey] : null;
    const alarm = server && server.alarms ? server.alarms[entityId] : null;

    if (!alarm) return false;

    const lastTrigger = Number(alarm.lastTrigger);
    if (alarm.lastTrigger !== null && alarm.lastTrigger !== undefined && Number.isFinite(lastTrigger) &&
        lastTrigger >= triggeredAt - ALARM_SOCKET_WINDOW_S) {
        return false;
    }

    /* An old push that arrived late: the trigger is not news anymore, only the subscription is made up for. */
    const ageSeconds = Math.floor(now() / 1000) - triggeredAt;
    if (ageSeconds > ALARM_PUSH_MAX_AGE_S) {
        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: the alarm "${alarm.name}" (${entityId}) fired ${Math.round(ageSeconds / 60)} min ago and ` +
            'its push arrived only now, it is not reported again.', 'warn');

        if (isConnectedTo(client, guildId, serverKey)) await client.rustplusInstances[guildId].subscribeAlarm(entityId);
        return false;
    }

    /* Disconnected meanwhile: reported like the alarm of another server, with the same setting. */
    if (!isConnectedTo(client, guildId, serverKey)) {
        return reportFromPush(client, guildId, serverKey, entityId, triggeredAt, now());
    }

    const rustplus = client.rustplusInstances[guildId];
    const Message = require('../rustplusEvents/message.js');
    const changed = (value) => ({ broadcast: { entityChanged: { entityId: entityId, payload: { value: value } } } });

    client.log(client.intlGet(null, 'warningCap'),
        `Rust+ push: the alarm "${alarm.name}" (${entityId}) fired but the server did not report it, ` +
        'it is reported from the push and subscribed now.', 'warn');

    await Message.messageBroadcastEntityChangedSmartAlarm(rustplus, client, changed(true));

    if (!(await rustplus.subscribeAlarm(entityId))) return true;

    /* The alarm may be off again already, a change before the subscription is not pushed. */
    const info = await rustplus.getEntityInfoAsync(entityId);
    if (info && info.entityInfo && info.entityInfo.payload && info.entityInfo.payload.value === false) {
        await Message.messageBroadcastEntityChangedSmartAlarm(rustplus, client, changed(false));
    }

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
            else if (kind === 'smartAlarm') handled = await smartAlarm(client, guildId, serverKey, notification, deps);
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
    isConnectedTo: isConnectedTo,
    alarmOfPush: alarmOfPush,
    alarmTime: alarmTime,
    reportMissedAlarm: reportMissedAlarm,
    ALARM_SOCKET_GRACE_MS: ALARM_SOCKET_GRACE_MS,
    ALARM_PUSH_MAX_AGE_S: ALARM_PUSH_MAX_AGE_S,
    handle: handle,
};
