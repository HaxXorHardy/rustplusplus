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
    The deaths of the team with their world position (server.deathLog in the instance, the newest MAX_ENTRIES), for
    the death map. Cleared by a map wipe (handlers/wipeHelper.js).
*/

const MAX_ENTRIES = 300;

function add(client, guildId, serverId, entry) {
    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server) return;

    const x = Number(entry.x);
    const y = Number(entry.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    if (!Array.isArray(server.deathLog)) server.deathLog = [];
    server.deathLog.push({
        steamId: `${entry.steamId}`,
        name: `${entry.name}`,
        x: Math.round(x),
        y: Math.round(y),
        grid: entry.grid ? `${entry.grid}` : null,
        atMs: entry.atMs || Date.now()
    });
    if (server.deathLog.length > MAX_ENTRIES) server.deathLog.splice(0, server.deathLog.length - MAX_ENTRIES);

    client.setInstance(guildId, instance);
}

/* The deaths, filtered by a part of the player name (case-insensitive) and by age. */
function list(server, options = {}) {
    if (!server || !Array.isArray(server.deathLog)) return [];

    const name = options.player ? `${options.player}`.toLowerCase() : null;
    const since = options.sinceMs || 0;

    return server.deathLog.filter((d) => d.atMs >= since && (name === null || d.name.toLowerCase().includes(name)));
}

function clear(client, guildId, serverId) {
    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server || !Array.isArray(server.deathLog) || server.deathLog.length === 0) return;

    server.deathLog = [];
    client.setInstance(guildId, instance);
}

module.exports = {
    MAX_ENTRIES: MAX_ENTRIES,
    add: add,
    list: list,
    clear: clear,
};
