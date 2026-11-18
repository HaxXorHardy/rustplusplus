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

const InformationHandler = require('./informationHandler.js');
const StorageMonitorHandler = require('./storageMonitorHandler.js');
const WithTimeout = require('../util/withTimeout.js');

/*
    The information embeds and the storage monitors post several Discord messages per run, and the information order
    check fetches up to 100 messages. Waiting for that inside the poll froze the whole cycle when Discord throttled one
    call (measured: 15 minutes without a poll, without one line in the log).

    They run here instead: own 60 s timer, own guard, and a deadline per step - the poll keeps its 10 s rhythm no
    matter what Discord does.
*/

const BACKGROUND_INTERVAL_MS = 60 * 1000;
const STEP_TIMEOUT_MS = 15 * 1000;

/*
    A step that is still pending after this long is given up: the next round starts it again. Without it one promise
    that never settled skipped the storage monitors for seven hours (1.41.6, a Discord call without an answer), and the
    reconnect did not help because the flag lives on the RustPlus object. Long enough for a slow information round
    (measured up to ~70 s) and a few rate limited monitor posts.
*/
const STEP_ABANDON_MS = 5 * 60 * 1000;

function stop(rustplus) {
    if (!rustplus.backgroundTaskId) return;

    clearInterval(rustplus.backgroundTaskId);
    rustplus.backgroundTaskId = 0;
}

async function step(rustplus, client, label, handler) {
    rustplus.backgroundPending = rustplus.backgroundPending || new Object();

    /* A step that is still running is not started a second time: both copies would wait for the same rate limit. */
    const pending = rustplus.backgroundPending[label];
    if (pending) {
        const pendingMs = Date.now() - pending.startedMs;

        if (pendingMs < module.exports.STEP_ABANDON_MS) {
            rustplus.log(client.intlGet(null, 'infoCap'),
                `background: ${label} is still running, it is skipped.`, 'debug');
            return;
        }

        rustplus.log(client.intlGet(null, 'warningCap'),
            `The background step for ${label} did not finish after ${Math.round(pendingMs / 1000)} s, ` +
            'it is given up and started again.', 'warn');
    }

    const startedMs = Date.now();
    /* Own token per run: a given-up run that settles later must not clear the flag of the run that replaced it. */
    const token = { startedMs: startedMs };
    rustplus.backgroundPending[label] = token;
    /* No log line per step: a slow step is reported below with its name, the cycle line carries the duration. */
    rustplus.backgroundPhase = label;

    let reportedSlow = false;

    const work = (async () => {
        try {
            await handler();

            /* A step that was reported as slow says when it is done, so the log shows how long it really took. */
            if (reportedSlow) {
                rustplus.log(client.intlGet(null, 'infoCap'),
                    `The background step for ${label} finished after ${Math.round((Date.now() - startedMs) / 1000)} s.`,
                    'debug');
            }
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The background step for ${label} failed: ${e && e.message ? e.message : e}`, 'warn');
        }
        finally {
            if (rustplus.backgroundPending[label] === token) delete rustplus.backgroundPending[label];
        }
    })();

    /*
        A slow step is reported and the cycle moves on, but the step is not abandoned: its pending flag keeps a second
        copy out, otherwise the copies pile up in front of the same Discord rate limit.
    */
    try {
        await WithTimeout.withTimeout(work, STEP_TIMEOUT_MS, label);
    }
    catch (e) {
        reportedSlow = true;

        /* The phase names the part that waits (the information step sets it, see handlers/informationHandler.js). */
        const where = (rustplus.backgroundPhase && rustplus.backgroundPhase !== label) ?
            `, waiting in ${rustplus.backgroundPhase}` : '';

        rustplus.log(client.intlGet(null, 'warningCap'),
            `The background step for ${label} is slow (${e && e.message ? e.message : e}${where}), it keeps running.`,
            'warn');
    }
}

async function run(rustplus, client) {
    if (rustplus.isDeleted) return stop(rustplus);

    if (rustplus.isBackgroundRunning) {
        rustplus.log(client.intlGet(null, 'infoCap'),
            'The previous background cycle is still running, this tick is skipped.', 'debug');
        return;
    }

    rustplus.isBackgroundRunning = true;

    const startedMs = Date.now();

    try {
        await step(rustplus, client, 'the information', () => InformationHandler.handler(rustplus));
        await step(rustplus, client, 'the storage monitors', () => StorageMonitorHandler.handler(rustplus, client));
    }
    finally {
        rustplus.isBackgroundRunning = false;
        rustplus.backgroundPhase = 'idle';

        rustplus.log(client.intlGet(null, 'infoCap'),
            `Background cycle: ${Date.now() - startedMs} ms.`, 'debug');
    }
}

function start(rustplus, client) {
    stop(rustplus);

    rustplus.backgroundTaskId = setInterval(() => {
        run(rustplus, client).catch((e) => {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The background cycle failed: ${e && e.message ? e.message : e}`, 'warn');
        });
    }, BACKGROUND_INTERVAL_MS);

    if (typeof rustplus.backgroundTaskId.unref === 'function') rustplus.backgroundTaskId.unref();
}

module.exports = {
    BACKGROUND_INTERVAL_MS: BACKGROUND_INTERVAL_MS,
    STEP_TIMEOUT_MS: STEP_TIMEOUT_MS,
    STEP_ABANDON_MS: STEP_ABANDON_MS,
    start: start,
    stop: stop,
    run: run,
};
