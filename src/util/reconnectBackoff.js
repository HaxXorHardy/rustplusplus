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
    Delay before the next reconnect attempt. The first attempt waits the configured interval, every further attempt
    waits twice as long, up to the configured maximum.

    A server that is offline for hours answers every request with `not_found` while the relay accepts the socket, so
    without a backoff the bot would reconnect every few seconds for as long as the server is down.
    @param {number} attempt Number of the attempt, starting at 1.
    @param {number} intervalMs Interval of the first attempt.
    @param {number} maxIntervalMs Upper limit of the delay.
    @returns {number}
*/
module.exports = function reconnectBackoffMs(attempt, intervalMs, maxIntervalMs) {
    const attempts = (Number.isFinite(attempt) && attempt >= 1) ? Math.floor(attempt) : 1;
    const base = (Number.isFinite(intervalMs) && intervalMs > 0) ? intervalMs : 15000;
    const max = (Number.isFinite(maxIntervalMs) && maxIntervalMs > 0) ? maxIntervalMs : base;

    return Math.min(base * Math.pow(2, attempts - 1), Math.max(base, max));
};
