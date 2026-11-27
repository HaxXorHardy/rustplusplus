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

const Assert = require('node:assert');
const EventEmitter = require('node:events');
const Test = require('node:test');

const Bootstrap = require('../src/bootstrap.js');
const DiscordBot = require('../src/structures/DiscordBot.js');
const ErrorEvent = require('../src/discordEvents/error.js');

function fakeClient() {
    const transport = new EventEmitter();
    const client = {
        logs: [],
        destroyed: false,
        deleted: 0,
        battlemetricsIntervalId: setInterval(() => { }, 100000).unref(),
        credentialsExpiryIntervalId: setInterval(() => { }, 100000).unref(),
        pairingHistoryIntervalId: setInterval(() => { }, 100000).unref(),
        rustplusReconnectTimers: { g: setTimeout(() => { }, 100000).unref() },
        rustplusInstances: { g: { deleteThisRustplusInstance: () => { client.deleted++; } } },
        intlGet: (guildId, id) => id,
        log: (title, text, level) => client.logs.push({ title, text, level }),
        destroy: async () => { client.destroyed = true; },
        logger: {
            formatError: (error) => `${error && error.message ? error.message : error}`,
            logger: {
                transports: [transport],
                ended: false,
                end() {
                    this.ended = true;
                    setImmediate(() => transport.emit('finish'));
                },
            },
        },
    };

    return client;
}

Test.describe('process lifecycle', () => {
    Test.afterEach(() => {
        Bootstrap.resetShutdownState();
    });

    Test.it('stops the timers, logs out, flushes the log and exits on SIGTERM', async () => {
        const client = fakeClient();
        const target = new EventEmitter();
        const exits = [];

        Bootstrap.installProcessHandlers(client, target, { exit: (code) => exits.push(code) });
        target.emit('SIGTERM');
        await Bootstrap.shutdown(client, { exitCode: 0, reason: 'again' });

        Assert.deepStrictEqual(exits, [0]);
        Assert.strictEqual(client.battlemetricsIntervalId, null);
        Assert.strictEqual(client.credentialsExpiryIntervalId, null);
        Assert.strictEqual(client.pairingHistoryIntervalId, null);
        Assert.strictEqual(client.rustplusReconnectTimers.g, null);
        Assert.strictEqual(client.deleted, 1);
        Assert.strictEqual(client.destroyed, true);
        Assert.strictEqual(client.logger.logger.ended, true);
        Assert.match(client.logs[0].text, /Received SIGTERM/);
    });

    Test.it('logs an uncaught exception and exits with 1', async () => {
        const client = fakeClient();
        const target = new EventEmitter();
        const exits = [];

        Bootstrap.installProcessHandlers(client, target, { exit: (code) => exits.push(code) });
        target.emit('uncaughtException', new Error('boom'));
        await Bootstrap.shutdown(client, { exitCode: 1, reason: 'ignored' });

        Assert.deepStrictEqual(exits, [1]);
        Assert.strictEqual(client.logs[0].level, 'error');
        Assert.match(client.logs[0].text, /boom/);
    });

    /* discord.js recovers from WebSocket errors on its own, the bot must not exit on them. */
    Test.it('only logs a client error', async () => {
        const client = fakeClient();
        const originalExit = process.exit;
        let exited = false;
        process.exit = () => { exited = true; };

        try {
            await ErrorEvent.execute(client, new Error('socket hang up'));
        }
        finally {
            process.exit = originalExit;
        }

        Assert.strictEqual(exited, false);
        Assert.strictEqual(client.logs.length, 1);
    });
});

Test.describe('Discord login', () => {
    const error = (props) => Object.assign(new Error('x'), props);

    Test.it('retries a passing outage', () => {
        Assert.strictEqual(DiscordBot.isRetryableLoginError(error({ status: 502 })), true);
        Assert.strictEqual(DiscordBot.isRetryableLoginError(error({ status: 429 })), true);
        Assert.strictEqual(DiscordBot.isRetryableLoginError(error({ code: 'ENOTFOUND' })), true);
        Assert.strictEqual(DiscordBot.isRetryableLoginError(error({ cause: { code: 'ECONNRESET' } })), true);
        Assert.strictEqual(DiscordBot.isRetryableLoginError(error({ name: 'AbortError' })), true);
    });

    Test.it('does not retry an invalid token or an unknown failure', () => {
        Assert.strictEqual(DiscordBot.isRetryableLoginError(error({ status: 401 })), false);
        Assert.strictEqual(DiscordBot.isRetryableLoginError(error({ code: 'TokenInvalid' })), false);
        Assert.strictEqual(DiscordBot.isRetryableLoginError(new Error('Used disallowed intents')), false);
        Assert.strictEqual(DiscordBot.isRetryableLoginError(null), false);
    });

    Test.it('keeps logging in after a 5xx and gives up on an invalid token', async () => {
        const answers = [error({ status: 503 }), error({ code: 'ECONNRESET' }), error({ code: 'TokenInvalid' })];
        const waits = [];
        const bot = {
            login: async () => { throw answers.shift(); },
            log: () => { },
            intlGet: (guildId, id) => id,
            logger: { formatError: (e) => `${e}` },
        };

        await Assert.rejects(DiscordBot.prototype.loginWithRetry.call(bot, async (ms) => { waits.push(ms); }),
            (e) => e.code === 'TokenInvalid');
        Assert.deepStrictEqual(waits, [5000, 10000]);
    });

    Test.it('resolves once a retry succeeds', async () => {
        const answers = [error({ status: 500 })];
        const bot = {
            login: async () => { if (answers.length) throw answers.shift(); return 'token'; },
            log: () => { },
            intlGet: (guildId, id) => id,
            logger: { formatError: (e) => `${e}` },
        };

        Assert.strictEqual(await DiscordBot.prototype.loginWithRetry.call(bot, async () => { }), 'token');
    });
});
