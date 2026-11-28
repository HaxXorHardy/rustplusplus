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
    The polling loop. A cycle can wait 30 s for a token, so the interval used to stack cycles; and an instance that was
    replaced by a reconnect kept polling forever, one ERROR per request. Both are covered here, plus the watchdog that
    rebuilds a connection that keeps failing.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const PollingHandler = require('../src/handlers/pollingHandler.js');

function fakeClient(instances = {}) {
    return {
        rustplusInstances: instances,
        intlGet: (guildId, key) => key,
    };
}

function fakeRustplus(client, options = {}) {
    const rustplus = {
        guildId: 'testguild',
        server: '127.0.0.1',
        port: 28082,
        playerId: '76561198000000001',
        playerToken: 'token',
        isDeleted: false,
        isPolling: false,
        isFirstPoll: false,
        pollingTaskId: 12345,
        consecutiveFailedPolls: 0,
        infoCalls: 0,
        disconnects: 0,
        logs: [],
        log: (title, text, level) => rustplus.logs.push({ level: level, text: text }),
        disconnect: () => { rustplus.disconnects += 1; },
        getInfoAsync: async () => {
            rustplus.infoCalls += 1;
            return options.valid ? { info: {} } : { error: 'not_found' };
        },
        getMapMarkersAsync: async () => (options.valid ? { mapMarkers: {} } : { error: 'not_found' }),
        getTeamInfoAsync: async () => (options.valid ? { teamInfo: {} } : { error: 'not_found' }),
        getTimeAsync: async () => (options.valid ? { time: {} } : { error: 'not_found' }),
        isResponseValid: async (response) => !response.hasOwnProperty('error'),
    };

    return rustplus;
}

Test.describe('pollingHandler', () => {
    /* A running cycle must not be started a second time by the next interval tick. */
    Test.it('skips a tick while a cycle is still running', async () => {
        const rustplus = fakeRustplus(fakeClient());
        const client = fakeClient({});
        rustplus.isPolling = true;

        await PollingHandler.pollingHandler(rustplus, client);

        Assert.strictEqual(rustplus.infoCalls, 0);
        Assert.strictEqual(rustplus.isPolling, true, 'the running cycle must keep the flag');
    });

    /* An instance that a reconnect replaced must not poll forever. */
    Test.it('stops the loop of an instance that was replaced', async () => {
        const client = fakeClient({});
        const rustplus = fakeRustplus(client);
        client.rustplusInstances[rustplus.guildId] = { replaced: true };

        await PollingHandler.pollingHandler(rustplus, client);

        Assert.strictEqual(rustplus.infoCalls, 0);
        Assert.strictEqual(rustplus.pollingTaskId, 0);
    });

    Test.it('stops the loop of a deleted instance', async () => {
        const client = fakeClient();
        const rustplus = fakeRustplus(client);
        rustplus.isDeleted = true;

        await PollingHandler.pollingHandler(rustplus, client);

        Assert.strictEqual(rustplus.infoCalls, 0);
        Assert.strictEqual(rustplus.pollingTaskId, 0);
    });

    Test.it('counts the failed cycles', async () => {
        const client = fakeClient();
        const rustplus = fakeRustplus(client);
        client.rustplusInstances[rustplus.guildId] = rustplus;

        await PollingHandler.pollingHandler(rustplus, client);

        Assert.strictEqual(rustplus.consecutiveFailedPolls, 1);
        Assert.strictEqual(rustplus.isPolling, false);
        Assert.strictEqual(rustplus.disconnects, 0);
    });

    /* Six failed cycles in a row (~1 minute) rebuild the connection instead of polling a dead socket. */
    Test.it('reconnects after six failed cycles in a row', async () => {
        const client = fakeClient();
        const rustplus = fakeRustplus(client);
        client.rustplusInstances[rustplus.guildId] = rustplus;

        for (let i = 0; i < 6; i++) await PollingHandler.pollingHandler(rustplus, client);

        Assert.strictEqual(rustplus.disconnects, 1);
        Assert.strictEqual(rustplus.consecutiveFailedPolls, 0);
        Assert.ok(rustplus.logs.some((entry) => entry.level === 'warn' && entry.text.includes('reconnecting')));
    });

    Test.it('resets the counter on a successful cycle', async () => {
        const client = fakeClient();
        const rustplus = fakeRustplus(client, { valid: true });
        client.rustplusInstances[rustplus.guildId] = rustplus;
        rustplus.consecutiveFailedPolls = 3;

        /* The handlers of a real cycle need a full instance; only the counter is under test here. */
        const originalHandlers = PollingHandler.handlers;
        PollingHandler.handlers = async () => undefined;

        try {
            await PollingHandler.pollingHandler(rustplus, client);
        }
        finally {
            PollingHandler.handlers = originalHandlers;
        }

        Assert.strictEqual(rustplus.consecutiveFailedPolls, 0);
        Assert.strictEqual(rustplus.disconnects, 0);
    });
    /*
        A cycle that hangs (a request that is never answered, a Discord call waiting on a rate limit) froze the loop:
        isPolling stayed true and every further tick was skipped - measured 15 minutes without a poll and without one
        line in the log.
    */
    Test.it('releases a cycle that hangs longer than 60 s', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const rustplus = fakeRustplus(fakeClient(), { hang: true });
        const client = fakeClient();

        /* The cycle never finishes, so it is not awaited here - the timers are ticked instead. */
        PollingHandler.pollingHandler(rustplus, client);
        await Promise.resolve();

        Assert.strictEqual(rustplus.isPolling, true);

        t.mock.timers.tick(60 * 1000);

        Assert.strictEqual(rustplus.isPolling, false, 'the watchdog releases the flag');
        Assert.ok(rustplus.logs.some((line) => line.level === 'warn' && line.text.includes('runs longer than')));
    });

    Test.it('rebuilds the connection when the cycles keep hanging', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const rustplus = fakeRustplus(fakeClient(), { hang: true });
        const client = fakeClient({ testguild: rustplus });
        client.createRustplusInstance = () => { client.created = (client.created || 0) + 1; };

        PollingHandler.pollingHandler(rustplus, client);
        await Promise.resolve();
        t.mock.timers.tick(60 * 1000);

        /* The flag was released, the next tick starts a new cycle that hangs as well. */
        PollingHandler.pollingHandler(rustplus, client);
        await Promise.resolve();
        t.mock.timers.tick(60 * 1000);

        Assert.strictEqual(rustplus.disconnects, 1, 'the second overlong cycle rebuilds the connection');
    });

    /* The late answers of a released cycle must not run the handlers (twice the team announcements). */
    Test.it('a cycle released by the watchdog stops at its next await', async () => {
        const client = fakeClient();
        const rustplus = fakeRustplus(client, { valid: true });
        let release = null;
        rustplus.getTeamInfoAsync = () => new Promise((resolve) => { release = () => resolve({ teamInfo: {} }); });
        let handlers = 0;
        const original = PollingHandler.handlers;
        PollingHandler.handlers = async () => { handlers += 1; };

        try {
            rustplus.pollCycleId = 1;
            const cycle = PollingHandler.poll(rustplus, client);
            while (release === null) await Promise.resolve();

            /* The watchdog released it and a newer cycle started. */
            rustplus.pollCycleId = 2;
            release();

            Assert.strictEqual(await cycle, false);
            Assert.strictEqual(handlers, 0);
        }
        finally {
            PollingHandler.handlers = original;
        }
    });

    Test.it('a released cycle that ends late does not count for the health of the connection', async () => {
        const client = fakeClient({});
        const rustplus = fakeRustplus(client);
        client.rustplusInstances[rustplus.guildId] = rustplus;
        rustplus.consecutiveFailedPolls = 3;
        rustplus.getInfoAsync = async () => {
            /* A newer cycle started meanwhile. */
            rustplus.pollCycleId += 1;
            return { error: 'not_found' };
        };

        await PollingHandler.pollingHandler(rustplus, client);

        Assert.strictEqual(rustplus.consecutiveFailedPolls, 3);
    });
});
