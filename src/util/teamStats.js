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
    Team statistics per week (ISO week in RPP_TIMEZONE): online time, sessions and deaths of every teammate, kept in
    the instance (server.teamStats) so a restart or a redeploy keeps the week. The team poll adds the time since its
    last run for everybody online (at most MAX_TICK_MS, a pause of the bot is no online time). When the week changes
    the finished week is returned once for the weekly report.
*/

const Config = require('../../config');

const MAX_TICK_MS = 60 * 1000;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

const lastTick = new Map();     /* `${guildId}:${serverId}` -> ms of the last tick */
const lastFlush = new Map();    /* `${guildId}:${serverId}` -> ms the instance was last written */

function timeZone() {
    const zone = Config.general.scheduleTimeZone;
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: zone });
        return zone;
    }
    catch (e) {
        return 'UTC';
    }
}

/* "2026-W47": the ISO week of the date in the time zone. */
function weekKey(date = new Date(), zone = timeZone()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    const day = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));

    /* ISO 8601: the week with the year's first Thursday is week 1. */
    const weekday = (day.getUTCDay() + 6) % 7;
    day.setUTCDate(day.getUTCDate() - weekday + 3);
    const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((day - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);

    return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function emptyWeek(key) {
    return { week: key, players: {} };
}

function statsOf(server, key) {
    if (!server.teamStats || typeof server.teamStats !== 'object' || !server.teamStats.players) {
        server.teamStats = emptyWeek(key);
    }
    return server.teamStats;
}

function playerOf(stats, steamId, name) {
    const id = `${steamId}`;
    if (!stats.players[id]) stats.players[id] = { name: `${name || id}`, onlineMs: 0, sessions: 0, deaths: 0 };
    if (name) stats.players[id].name = `${name}`;
    return stats.players[id];
}

/*
    The team poll: online time for the members that are online. Returns the finished week when the week just changed
    (with data), else null. members: teamInfo.members ({ steamId, name, isOnline }).
*/
function tick(client, guildId, serverId, members, now = Date.now(), date = new Date(now)) {
    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server || !Array.isArray(members)) return null;

    const key = `${guildId}:${serverId}`;
    const week = weekKey(date);
    let finished = null;

    const stats = statsOf(server, week);
    if (stats.week !== week) {
        if (Object.keys(stats.players).length !== 0) finished = stats;
        server.teamStats = emptyWeek(week);
    }

    const current = server.teamStats;
    const previous = lastTick.get(key);
    const elapsed = previous === undefined ? 0 : Math.min(MAX_TICK_MS, Math.max(0, now - previous));
    lastTick.set(key, now);

    for (const member of members) {
        const player = playerOf(current, member.steamId, member.name);
        if (member.isOnline) player.onlineMs += elapsed;
    }

    const flushed = lastFlush.get(key) || 0;
    if (finished !== null || now - flushed >= FLUSH_INTERVAL_MS) {
        lastFlush.set(key, now);
        client.setInstance(guildId, instance);
    }

    return finished;
}

function noteSession(client, guildId, serverId, steamId, name) {
    const server = client.getInstance(guildId).serverList[serverId];
    if (!server) return;
    playerOf(statsOf(server, weekKey()), steamId, name).sessions += 1;
}

function noteDeath(client, guildId, serverId, steamId, name) {
    const server = client.getInstance(guildId).serverList[serverId];
    if (!server) return;
    playerOf(statsOf(server, weekKey()), steamId, name).deaths += 1;
}

/* The players of a week, most online time first. */
function ranking(stats) {
    if (!stats || !stats.players) return [];

    return Object.entries(stats.players)
        .map(([steamId, p]) => Object.assign({ steamId: steamId }, p))
        .sort((a, b) => b.onlineMs - a.onlineMs);
}

/* For tests. */
function reset() {
    lastTick.clear();
    lastFlush.clear();
}

module.exports = {
    MAX_TICK_MS: MAX_TICK_MS,
    weekKey: weekKey,
    tick: tick,
    noteSession: noteSession,
    noteDeath: noteDeath,
    ranking: ranking,
    reset: reset,
};
