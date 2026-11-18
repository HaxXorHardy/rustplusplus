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

/*
    The timers are written to the instance file as well (server.pendingTimers, the instances folder is a volume):
    after a restart or a redeploy handlers/switchTimerRestore.js starts them again.
*/
function persist(guildId, serverId, key, record) {
    const Client = require('../structures/clientRegistry.js');
    const client = Client.client;
    if (!client || typeof client.getInstance !== 'function') return;

    const instance = client.getInstance(guildId);
    const server = instance && instance.serverList ? instance.serverList[serverId] : null;
    if (!server) return;

    if (record === null) {
        if (!server.pendingTimers || !server.pendingTimers.hasOwnProperty(key)) return;
        delete server.pendingTimers[key];
    }
    else {
        if (!server.pendingTimers || typeof server.pendingTimers !== 'object') server.pendingTimers = {};
        server.pendingTimers[key] = record;
    }

    client.setInstance(guildId, instance);
}

/*
    Start a timer: record = { kind: 'switch' | 'group', id, value (the state it switches to), inGame }. fire runs when
    it is due; a timer under the same key is replaced. Returns the time it ends.
*/
function schedule(guildId, serverId, key, delayMs, record, fire) {
    /* The replaced timer only stops here: the record below overwrites its entry (one write instead of two). */
    stop(guildId, serverId, key);

    const timeouts = of(guildId, serverId);
    const endsAtMs = Date.now() + Math.max(0, delayMs);

    const handle = setTimeout(async () => {
        if (timeouts[key] !== handle) return;

        delete timeouts[key];
        ends.delete(`${guildId}:${serverId}:${key}`);
        persist(guildId, serverId, key, null);

        await fire();
    }, Math.max(0, delayMs));

    timeouts[key] = handle;
    ends.set(`${guildId}:${serverId}:${key}`, { handle: handle, endsAtMs: endsAtMs, value: record.value });
    persist(guildId, serverId, key, Object.assign({}, record, { endsAtMs: endsAtMs }));

    return endsAtMs;
}

/* Stop a running timer in memory only. */
function stop(guildId, serverId, key) {
    const timeouts = of(guildId, serverId);
    if (timeouts.hasOwnProperty(key)) {
        clearTimeout(timeouts[key]);
        delete timeouts[key];
    }

    ends.delete(`${guildId}:${serverId}:${key}`);
}

/* Stop a timer (if one runs) and forget it, in memory and in the instance file. */
function cancel(guildId, serverId, key) {
    stop(guildId, serverId, key);
    persist(guildId, serverId, key, null);
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
    schedule: schedule,
    cancel: cancel,
    groupKey: groupKey,
    getEnd: getEnd,
    reset: reset,
};
