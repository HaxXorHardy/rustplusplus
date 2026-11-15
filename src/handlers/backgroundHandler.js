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

function stop(rustplus) {
    if (!rustplus.backgroundTaskId) return;

    clearInterval(rustplus.backgroundTaskId);
    rustplus.backgroundTaskId = 0;
}

async function step(rustplus, client, label, handler) {
    rustplus.backgroundPhase = label;
    rustplus.log(client.intlGet(null, 'infoCap'), `background: ${label}`, 'debug');

    try {
        await WithTimeout.withTimeout(handler(), STEP_TIMEOUT_MS, label);
    }
    catch (e) {
        rustplus.log(client.intlGet(null, 'warningCap'),
            `The background step for ${label} failed: ${e && e.message ? e.message : e}`, 'warn');
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
    start: start,
    stop: stop,
    run: run,
};
