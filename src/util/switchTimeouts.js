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

/* For tests. */
function reset() {
    for (const entry of timeouts.values()) {
        for (const handle of Object.values(entry)) clearTimeout(handle);
    }
    timeouts.clear();
}

module.exports = {
    of: of,
    currentInstance: currentInstance,
    reset: reset,
};
