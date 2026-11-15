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
    A step of the poll is awaited, and a Discord call inside it can wait on a rate limit for minutes. That froze the
    whole poll cycle: isPolling stayed true, every further tick was skipped and the bot looked alive while it updated
    nothing (measured: 15 minutes without a single information update, without one error in the log).

    Every awaited step gets a deadline instead. The step keeps running in the background, the cycle moves on.
*/

const DEFAULT_TIMEOUT_MS = 10 * 1000;

function withTimeout(promise, timeoutMs = DEFAULT_TIMEOUT_MS, label = 'the step') {
    return new Promise((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;

            settled = true;

            const limit = (timeoutMs >= 1000) ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`;
                        const error = new Error(`${label} did not finish within ${limit}.`);
            error.code = 'ESTEPTIMEOUT';

            reject(error);
        }, timeoutMs);

        /* No unref: the deadline must survive an otherwise empty event loop (a test, or a hung handler). */
        Promise.resolve(promise).then((value) => {
            if (settled) return;

            settled = true;
            clearTimeout(timer);

            resolve(value);
        }, (error) => {
            if (settled) return;

            settled = true;
            clearTimeout(timer);

            reject(error);
        });
    });
}

module.exports = {
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    withTimeout: withTimeout,
};
