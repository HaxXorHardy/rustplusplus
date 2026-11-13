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
    Helpers of the camera watch: which of the players a camera saw is a stranger, and when it was reported last.

    The camera only sends a name per player entity, no steam id, so the comparison with the team is by name - a player
    can rename himself to a team name, the same limitation the Rust+ app has. Everything here is pure, so it is testable
    without a server.
*/

function normalizeName(name) {
    return `${name === undefined || name === null ? '' : name}`.trim().toLowerCase();
}

/* The names of the team of the paired account, normalized for the comparison. */
function teamNameSet(team) {
    const names = new Set();

    for (const player of (team && Array.isArray(team.players)) ? team.players : []) {
        const name = normalizeName(player.name);
        if (name !== '') names.add(name);
    }

    return names;
}

/* The intervals the settings menu offers, in seconds (5 s up to 5 minutes). */
const INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 120, 300];

const INTERVAL_DEFAULT_SECONDS = 60;
const INTERVAL_MIN_SECONDS = 5;
const INTERVAL_MAX_SECONDS = 3600;

/* How long a check of one camera takes (3 frames + subscribe/unsubscribe), used for the smallest sane interval. */
const ROUND_SECONDS_PER_CAMERA = 0.6;

/*
    The interval of the watch in seconds: a value from the select menu, the instance file or an older version, clamped to
    a range that neither spams the server nor leaves the base unwatched for hours.
*/
function normalizeIntervalSeconds(value) {
    /* Number(null) is 0, so the empty values are handled before the conversion. */
    if (value === undefined || value === null || value === '') return INTERVAL_DEFAULT_SECONDS;

    const seconds = Number(value);

    if (!Number.isFinite(seconds)) return INTERVAL_DEFAULT_SECONDS;

    return Math.min(INTERVAL_MAX_SECONDS, Math.max(INTERVAL_MIN_SECONDS, Math.round(seconds)));
}

/*
    The interval that is really used: a round takes ROUND_SECONDS_PER_CAMERA per camera, so an interval below that would
    make the watch run back to back (a permanent camera stream). With 10 cameras a 5 s choice becomes 6 s.
*/
function effectiveIntervalSeconds(chosenSeconds, cameraCount) {
    const chosen = normalizeIntervalSeconds(chosenSeconds);
    const count = Math.max(1, Number.isFinite(Number(cameraCount)) ? Math.floor(Number(cameraCount)) : 1);
    const roundSeconds = Math.max(1, Math.ceil(count * ROUND_SECONDS_PER_CAMERA));

    return Math.max(chosen, roundSeconds);
}

/* A readable interval for the select menu: 5 s, 45 s, 2 min, 5 min. */
function formatInterval(seconds) {
    const value = normalizeIntervalSeconds(seconds);

    return (value < 60) ? `${value} s` : `${Math.round(value / 60)} min`;
}

/*
    The names that do not trigger an alert. A team member is only ignored while the setting says so, so a group can be
    told to report its own members as well.
*/
function teamIgnoreSet(team, reportTeam) {
    if (reportTeam === true) return new Set();

    return teamNameSet(team);
}

/*
    The players the camera saw that are not in the team. A player without a name is reported as well (it cannot be
    compared, and a stranger without a name is more interesting than a missed one).
*/
function findStrangers(players, names) {
    const strangers = new Map();

    for (const player of Array.isArray(players) ? players : []) {
        const name = normalizeName(player.name);
        if (name !== '' && names.has(name)) continue;

        const key = name === '' ? `#${player.entityId}` : name;
        if (strangers.has(key)) continue;

        strangers.set(key, {
            name: name === '' ? null : `${player.name}`,
            entityId: player.entityId,
            distance: distanceOf(player),
        });
    }

    return [...strangers.values()];
}

/* The position of a camera entity is relative to the camera, in metres. */
function distanceOf(entity) {
    const position = entity && entity.position;
    if (!position) return null;

    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    return Math.round(Math.sqrt((x * x) + (y * y) + (z * z)) * 10) / 10;
}

/* Key of the rate limit: one alert per camera and player within the cooldown. */
function alertKey(cameraCode, stranger) {
    return `${cameraCode}:${stranger.name === null ? `#${stranger.entityId}` : stranger.name}`;
}

function isCooldownOver(state, key, nowMs, cooldownMs) {
    const lastMs = state[key];

    return (lastMs === undefined) || ((nowMs - lastMs) >= cooldownMs);
}

function markAlert(state, key, nowMs) {
    state[key] = nowMs;
    return state;
}

/* Drops the entries that are older than the cooldown, so a long running bot does not grow the state forever. */
function pruneAlertState(state, nowMs, cooldownMs) {
    for (const [key, lastMs] of Object.entries(state)) {
        if ((nowMs - lastMs) >= cooldownMs) delete state[key];
    }

    return state;
}

module.exports = {
    normalizeName: normalizeName,
    teamNameSet: teamNameSet,
    teamIgnoreSet: teamIgnoreSet,
    normalizeIntervalSeconds: normalizeIntervalSeconds,
    effectiveIntervalSeconds: effectiveIntervalSeconds,
    formatInterval: formatInterval,
    INTERVAL_OPTIONS: INTERVAL_OPTIONS,
    INTERVAL_DEFAULT_SECONDS: INTERVAL_DEFAULT_SECONDS,
    findStrangers: findStrangers,
    distanceOf: distanceOf,
    alertKey: alertKey,
    isCooldownOver: isCooldownOver,
    markAlert: markAlert,
    pruneAlertState: pruneAlertState,
};
