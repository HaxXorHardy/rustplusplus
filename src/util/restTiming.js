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
    Discord requests that take long. Message edits of the device channels took 90 s and more (2026-11-18) while the
    network to Discord answered in milliseconds and no rate limit was reported: every request through the REST manager
    that takes longer than SLOW_REQUEST_MS is logged with its route and duration, so the cause becomes visible.
*/

const SLOW_REQUEST_MS = 5000;

/* Wraps rest.request (all REST calls of discord.js go through it). log(text) is called for a slow request. */
function instrument(rest, log, slowMs = SLOW_REQUEST_MS) {
    if (!rest || typeof rest.request !== 'function' || rest.request.rppTimed) return;

    const original = rest.request.bind(rest);
    const timed = async function (options) {
        const startedMs = Date.now();
        let outcome = 'ok';
        try {
            return await original(options);
        }
        catch (e) {
            outcome = `failed (${e && (e.status || e.code || e.name) ? (e.status || e.code || e.name) : 'error'})`;
            throw e;
        }
        finally {
            const ms = Date.now() - startedMs;
            if (ms >= slowMs) {
                const files = options && Array.isArray(options.files) ? options.files.length : 0;
                log(`Slow Discord request: ${options ? options.method : '?'} ${options ? options.fullRoute : '?'} ` +
                    `took ${ms} ms, ${outcome}${files !== 0 ? `, ${files} file(s)` : ''}.`);
            }
        }
    };
    timed.rppTimed = true;
    rest.request = timed;
}

module.exports = {
    SLOW_REQUEST_MS: SLOW_REQUEST_MS,
    instrument: instrument,
};
