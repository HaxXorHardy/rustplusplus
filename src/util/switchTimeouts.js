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
    The auto ON/OFF timers of smart switches and switch groups ("!lights on 10m"), per guild and server.

    They used to live on the RustPlus instance, which is replaced on every reconnect (a token renewal, a dropped relay
    socket - every hour or two). A reconnect lost the handles: the timer could no longer be cancelled and fired on the
    dead connection. Kept here, a reconnected instance sees the same timers (rustplus.currentSwitchTimeouts).
*/

const timeouts = new Map();    /* `${guildId}:${serverId}` -> { [entityId | groupId]: timeout handle } */
const ends = new Map();        /* `${guildId}:${serverId}:${id}` -> { handle, endsAtMs, value } (shown in Discord) */

function of(guildId, serverId) {
    const key = `${guildId}:${serverId}`;
    let entry = timeouts.get(key);

    if (entry === undefined) {
        entry = {};
        timeouts.set(key, entry);
    }

    return entry;
}

/* The connection of the guild a timer has to use when it fires, or null when the guild is on another server now. */
function currentInstance(client, guildId, serverId) {
    const rustplus = client.rustplusInstances ? client.rustplusInstances[guildId] : null;
    if (!rustplus || rustplus.serverId !== serverId) return null;

    return rustplus;
}

/* Remember when a timer ends and what it switches to, for the group message. */
function setEnd(guildId, serverId, id, endsAtMs, value) {
    ends.set(`${guildId}:${serverId}:${id}`, { handle: of(guildId, serverId)[id], endsAtMs: endsAtMs, value: value });
}

/* { endsAtMs, value } of a timer that still runs, or null (also when it was cancelled by clearTimeout + delete). */
function getEnd(guildId, serverId, id, now = Date.now()) {
    const end = ends.get(`${guildId}:${serverId}:${id}`);
    if (!end) return null;

    if (of(guildId, serverId)[id] !== end.handle || end.endsAtMs <= now) {
        ends.delete(`${guildId}:${serverId}:${id}`);
        return null;
    }

    return { endsAtMs: end.endsAtMs, value: end.value };
}

/* The key of a group timer: groups and switches share the timers of a server, their ids must not collide. */
function groupKey(groupId) {
    return `group-${groupId}`;
}

/* For tests. */
function reset() {
    for (const entry of timeouts.values()) {
        for (const handle of Object.values(entry)) clearTimeout(handle);
    }
    timeouts.clear();
    ends.clear();
}

module.exports = {
    of: of,
    currentInstance: currentInstance,
    setEnd: setEnd,
    groupKey: groupKey,
    getEnd: getEnd,
    reset: reset,
};
