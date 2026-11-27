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

const Discord = require('discord.js');
const Fs = require('fs');
const Path = require('path');

const ClientRegistry = require('./structures/clientRegistry.js');
const DiscordBot = require('./structures/DiscordBot');

/* Directories the bot writes to at runtime. Created before the client starts so no handler has to
   worry about their existence. */
function createMissingDirectories() {
    for (const directory of ['logs', 'instances', 'credentials', 'maps']) {
        const path = Path.join(__dirname, '..', directory);
        if (!Fs.existsSync(path)) {
            Fs.mkdirSync(path);
        }
    }
}

/*
    Build the bot, publish it to the client registry and start it. Kept as an explicit function so
    importing a module never boots the application.
*/
function start() {
    createMissingDirectories();

    const client = new DiscordBot({
        intents: [
            Discord.GatewayIntentBits.Guilds,
            Discord.GatewayIntentBits.GuildMessages,
            Discord.GatewayIntentBits.MessageContent,
            Discord.GatewayIntentBits.GuildMembers,
            Discord.GatewayIntentBits.GuildVoiceStates],
        retryLimit: 2,
        restRequestTimeout: 60000,
        disableEveryone: false
    });

    ClientRegistry.client = client;
    client.build().catch((error) => {
        /* Not a passing outage (those are retried): an invalid token or similar. Exit so the restart policy acts. */
        shutdown(client, { exitCode: 1, reason: `The Discord login failed for good: ${describe(client, error)}` });
    });

    return client;
}

/* docker stop waits 10 s before SIGKILL: the shutdown must be done well before that. */
const SHUTDOWN_TIMEOUT_MS = 8000;
const RELAY_FLUSH_TIMEOUT_MS = 4000;
const LOG_FLUSH_TIMEOUT_MS = 2000;

let shutdownPromise = null;

function describe(client, error) {
    try {
        return client.logger.formatError(error, true);
    }
    catch (e) {
        return `${error && error.stack ? error.stack : error}`;
    }
}

function logLine(client, level, text) {
    try {
        client.log(client.intlGet(null, level === 'error' ? 'errorCap' : 'infoCap'), text, level);
    }
    catch (e) {
        console.error(text);
    }
}

/* Resolves after the promise or after the timeout, whichever comes first; never rejects. */
function settleWithin(promise, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        Promise.resolve(promise).catch(() => { }).then(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/* Stop the timers of the bot and the Rust+ connections, so nothing new is started while the process ends. */
function stopTimers(client) {
    for (const key of ['battlemetricsIntervalId', 'credentialsExpiryIntervalId', 'pairingHistoryIntervalId']) {
        if (client[key]) {
            clearInterval(client[key]);
            client[key] = null;
        }
    }

    for (const stop of [() => require('./util/tokenRecovery.js').stop(),
        () => require('./util/rustplusPushListener.js').stop()]) {
        try {
            stop();
        }
        catch (e) {
            /* Best effort, the process ends anyway. */
        }
    }

    for (const guildId of Object.keys(client.rustplusReconnectTimers || {})) {
        if (client.rustplusReconnectTimers[guildId]) clearTimeout(client.rustplusReconnectTimers[guildId]);
        client.rustplusReconnectTimers[guildId] = null;
    }

    for (const rustplus of Object.values(client.rustplusInstances || {})) {
        try {
            rustplus.deleteThisRustplusInstance();
        }
        catch (e) {
            /* Best effort. */
        }
    }
}

/* Wait until the file transports of the bot log have written everything. */
function flushWinston(client) {
    const winston = client.logger && client.logger.logger;
    if (!winston || typeof winston.end !== 'function') return Promise.resolve();

    const finished = (winston.transports || []).map((transport) =>
        new Promise((resolve) => transport.once('finish', resolve)));
    winston.end();

    return Promise.all(finished);
}

/**
 * End the process cleanly: stop the timers and connections, send what the server-log channels still have queued,
 * log out of Discord, close the runtime database, flush the log file and exit. Runs once; a hard timer exits
 * after SHUTDOWN_TIMEOUT_MS whatever step hangs.
 * @param {*} client
 * @param {{exitCode: number, reason: string}} options
 * @param {{exit: function(number): void}} [deps] Replaced by the tests.
 * @returns {Promise<void>}
 */
function shutdown(client, options, deps = { exit: (code) => process.exit(code) }) {
    if (shutdownPromise !== null) return shutdownPromise;

    const exitCode = options.exitCode ?? 0;
    const hardExit = setTimeout(() => deps.exit(exitCode), SHUTDOWN_TIMEOUT_MS);
    if (typeof hardExit.unref === 'function') hardExit.unref();

    shutdownPromise = (async () => {
        logLine(client, exitCode === 0 ? 'info' : 'error', `${options.reason} Shutting down.`);

        try {
            stopTimers(client);
        }
        catch (e) {
            console.error(e);
        }

        await settleWithin(require('./util/logChannelRelay.js').flushAll(), RELAY_FLUSH_TIMEOUT_MS);

        try {
            await settleWithin(client.destroy(), 1000);
        }
        catch (e) {
            console.error(e);
        }

        try {
            require('./util/storage/getRuntimeDataStorage.js').reset();
        }
        catch (e) {
            console.error(e);
        }

        try {
            await settleWithin(flushWinston(client), LOG_FLUSH_TIMEOUT_MS);
        }
        catch (e) {
            console.error(e);
        }

        clearTimeout(hardExit);
        deps.exit(exitCode);
    })();

    return shutdownPromise;
}

/**
 * SIGTERM/SIGINT (docker stop, Ctrl+C) end the bot cleanly. An uncaught exception leaves the process in an unknown
 * state: it is logged and the process exits with 1 after the logs are flushed, so the restart policy acts.
 * @param {*} client
 * @param {*} [target] The process, replaced by the tests.
 * @param {{exit: function(number): void}} [deps]
 * @returns {void}
 */
function installProcessHandlers(client, target = process, deps = undefined) {
    for (const signal of ['SIGTERM', 'SIGINT']) {
        target.on(signal, () => shutdown(client, { exitCode: 0, reason: `Received ${signal}.` }, deps));
    }

    target.on('uncaughtException', (error) => {
        shutdown(client, { exitCode: 1, reason: `Uncaught exception: ${describe(client, error)}` }, deps);
    });
}

/* Used by the tests to run shutdown() more than once. */
function resetShutdownState() {
    shutdownPromise = null;
}

module.exports = { start, shutdown, installProcessHandlers, resetShutdownState };
