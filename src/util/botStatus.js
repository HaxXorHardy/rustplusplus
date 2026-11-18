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
    What /status shows: collected while the bot runs (warnings, disconnects) and read from the live objects when the
    command is used. Nothing here is stored on disk, a restart starts the counters at zero.
*/

const MAX_WARNINGS = 20;

const warnings = [];                /* { atMs, level, text } newest last */
const disconnects = new Map();      /* guildId -> { count, lastMs } */

/* Called by DiscordBot.log for every line: keeps the last warnings and errors. */
function record(level, title, text) {
    if (level !== 'warn' && level !== 'error') return;

    warnings.push({ atMs: Date.now(), level: level, text: `${text}` });
    if (warnings.length > MAX_WARNINGS) warnings.splice(0, warnings.length - MAX_WARNINGS);
}

/* An unexpected disconnect of the guild's Rust+ connection. */
function noteDisconnect(guildId, now = Date.now()) {
    const entry = disconnects.get(`${guildId}`) || { count: 0, lastMs: null };
    entry.count += 1;
    entry.lastMs = now;
    disconnects.set(`${guildId}`, entry);
}

function recentWarnings(count = 5) {
    return warnings.slice(-count);
}

function warningsSince(sinceMs) {
    return warnings.filter((w) => w.atMs >= sinceMs).length;
}

function disconnectsOf(guildId) {
    return disconnects.get(`${guildId}`) || { count: 0, lastMs: null };
}

/*
    Everything the status embed shows, as plain values. deps: { auth, push, pushState, tokenRefused, version }
    to keep this testable without files.
*/
function collect(client, guildId, deps = {}, now = Date.now()) {
    const rustplus = client.rustplusInstances ? client.rustplusInstances[guildId] : null;
    const instance = client.getInstance(guildId);
    const server = (instance && instance.activeServer !== null && instance.serverList) ?
        instance.serverList[instance.activeServer] : null;

    const status = {
        version: deps.version || null,
        botUptimeMs: client.uptimeBot ? now - new Date(client.uptimeBot).getTime() : null,
        discordPingMs: client.ws && Number.isFinite(client.ws.ping) && client.ws.ping >= 0 ? client.ws.ping : null,
        server: server ? server.title : null,
        connection: 'offline',
        socketAgeMs: null,
        lastPollAgoMs: null,
        disconnects: disconnectsOf(guildId),
        tokenExpiresMs: null,
        tokenRefused: Boolean(deps.tokenRefused),
        push: deps.pushState || null,
        pushNotifications: deps.push && Array.isArray(deps.push.persistentIds) ? deps.push.persistentIds.length : null,
        pushRegistrationExpiresMs: null,
        warningsLastHour: warningsSince(now - 60 * 60 * 1000),
        warnings: recentWarnings(5),
    };

    if (rustplus) {
        status.connection = rustplus.isOperational ? 'operational' : 'connecting';
        if (rustplus.relayConnectedAtMs) status.socketAgeMs = now - rustplus.relayConnectedAtMs;
        if (rustplus.lastSuccessfulPollMs) status.lastPollAgoMs = now - rustplus.lastSuccessfulPollMs;
    }

    const toMs = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n < 1e12 ? n * 1000 : n;
    };

    if (deps.auth) status.tokenExpiresMs = toMs(deps.auth.tokenExpiresAt);
    if (deps.push && deps.push.registration) status.pushRegistrationExpiresMs = toMs(deps.push.registration.expiresAt);

    return status;
}

/* For tests. */
function reset() {
    warnings.length = 0;
    disconnects.clear();
}

module.exports = {
    MAX_WARNINGS: MAX_WARNINGS,
    record: record,
    noteDisconnect: noteDisconnect,
    recentWarnings: recentWarnings,
    disconnectsOf: disconnectsOf,
    collect: collect,
    reset: reset,
};
