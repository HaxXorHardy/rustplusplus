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
    The numbers that a Battlemetrics server request reports about the players on that server.

    The current session of a player is part of the metadata of the server request (key 'time', in seconds). The
    attribute 'updatedAt' of a player is not usable for it: Battlemetrics updates it whenever it touches the profile,
    which is the same timestamp for nearly all players of a request.

    The time played is reported per server (meta.timePlayed of the server entry of a player). The profile wide total of
    the time played statistics sums every server and every name based match of a profile together, which produces
    numbers far beyond any real play time.
*/

const SESSION_METADATA_KEY = 'time';

/*
    The length of the current session (seconds) of a player entity of a server request, null when it is not reported.
*/
function getSessionSeconds(meta) {
    if (!meta || !Array.isArray(meta.metadata)) return null;

    const entry = meta.metadata.find((e) => e && e.key === SESSION_METADATA_KEY);
    if (!entry || typeof (entry.value) !== 'number' || !Number.isFinite(entry.value)) return null;

    return entry.value;
}

/*
    A duration formatted as [seconds, HH:MM].
*/
function formatSeconds(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return [seconds, `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`];
}

module.exports = {
    getSessionSeconds: getSessionSeconds,
    formatSeconds: formatSeconds,
};
