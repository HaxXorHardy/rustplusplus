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
    The relay authenticates a socket once, with the token of the handshake. Every new Rust+ login mints a new account
    token and Facepunch then answers every request of the old socket with not_found - the bot used to keep such a socket
    for hours (one ERROR per request, no polling, no camera watch). These tests pin the rebuild that replaces it and
    the renewal that triggers it.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const RustPlus = require('../src/structures/RustPlus.js');

const GUILD_ID = 'testguild';
const STEAM_ID = '76561198000000400';

/* Only the translations and the reconnect counters are needed, the instances below are built by hand. */
Client.client = {
    intlGet: (guildId, key) => key,
    rustplusReconnectAttempts: {},
    getInstance: () => null,
};

function fakeRustPlus(overrides = {}) {
    const rustplus = Object.create(RustPlus.prototype);

    rustplus.guildId = GUILD_ID;
    rustplus.playerId = STEAM_ID;
    rustplus.isDeleted = false;
    rustplus.lastConnectionRebuildMs = 0;
    rustplus.logs = [];
    rustplus.log = (title, text, level) => rustplus.logs.push({ level: level, text: text });
    rustplus.connectCalls = 0;
    rustplus.connect = () => { rustplus.connectCalls += 1; };
    rustplus.websocket = null;

    Object.assign(rustplus, overrides);

    return rustplus;
}

function fakeSocket() {
    const socket = { closed: 0, close: () => { socket.closed += 1; } };

    return socket;
}

Test.describe('RustPlus.rebuildConnection', () => {
    Test.it('closes the socket so the reconnect uses the stored token', () => {
        const socket = fakeSocket();
        const rustplus = fakeRustPlus({ websocket: socket });

        Client.client.rustplusReconnectAttempts[GUILD_ID] = 3;

        Assert.strictEqual(rustplus.rebuildConnection('the account token was renewed'), true);
        Assert.strictEqual(socket.closed, 1);

        /* The next instance starts with a fresh backoff instead of the expired one of this connection. */
        Assert.strictEqual(Client.client.rustplusReconnectAttempts[GUILD_ID], 0);
        Assert.strictEqual(rustplus.logs.length, 1);
        Assert.ok(rustplus.logs[0].text.includes('the account token was renewed'));
    });

    Test.it('rebuilds only once for the burst of answers of one dead socket', () => {
        const socket = fakeSocket();
        const rustplus = fakeRustPlus({ websocket: socket });

        rustplus.rebuildConnection('first');
        Assert.strictEqual(rustplus.rebuildConnection('second'), false);

        Assert.strictEqual(socket.closed, 1);
        Assert.strictEqual(rustplus.logs.length, 1);
    });

    Test.it('connects directly when there is no socket to close', () => {
        const rustplus = fakeRustPlus();

        Assert.strictEqual(rustplus.rebuildConnection('no socket'), true);
        Assert.strictEqual(rustplus.connectCalls, 1);
    });

    Test.it('does nothing for a deleted instance', () => {
        const socket = fakeSocket();
        const rustplus = fakeRustPlus({ websocket: socket, isDeleted: true });

        Assert.strictEqual(rustplus.rebuildConnection('deleted'), false);
        Assert.strictEqual(socket.closed, 0);
    });
});

Test.describe('RustPlus.rebuildConnection (terminate)', () => {
    /* A graceful close() waits for the close frame of a dead relay and hung in CLOSING. */
    Test.it('terminates the socket instead of closing it gracefully', () => {
        const socket = fakeSocket();
        socket.terminated = 0;
        socket.terminate = () => { socket.terminated += 1; };

        const rustplus = fakeRustPlus({ websocket: socket });

        Assert.strictEqual(rustplus.rebuildConnection('terminate', { force: true }), true);
        Assert.strictEqual(socket.terminated, 1);
        Assert.strictEqual(socket.closed, 0);
        Assert.strictEqual(rustplus.connectCalls, 0);
    });
});

Test.describe('RustPlus.isResponseValid', () => {
    Test.it('logs a gone device as debug when the caller expects it', async () => {
        const rustplus = fakeRustPlus();

        Assert.strictEqual(await rustplus.isResponseValid({ error: 'not_found' }, { expectNotFound: true }), false);

        Assert.strictEqual(rustplus.logs.length, 1);
        Assert.strictEqual(rustplus.logs[0].level, 'debug');
    });

    Test.it('keeps an unexpected not_found an error', async () => {
        const rustplus = fakeRustPlus();

        Assert.strictEqual(await rustplus.isResponseValid({ error: 'not_found' }), false);
        Assert.strictEqual(rustplus.logs[0].level, 'error');

        /* The line names the caller, that is how a not_found of a specific round is found in the log. */
        Assert.match(rustplus.logs[0].text, /\(rustplusRebuild\.test\.js:\d+\)$/);
    });

    Test.it('logs a poll timeout as a warning, other timeouts as errors', async () => {
        const rustplus = fakeRustPlus();
        const timeout = () => new Error('Timeout reached while waiting for response');

        Assert.strictEqual(await rustplus.isResponseValid(timeout(), { timeoutIsWarning: true }), false);
        Assert.strictEqual(await rustplus.isResponseValid(timeout()), false);
        Assert.strictEqual(await rustplus.isResponseValid(new Error('socket hang up'), { timeoutIsWarning: true }),
            false);

        Assert.deepStrictEqual(rustplus.logs.map((line) => line.level), ['warn', 'error', 'error']);
        Assert.match(rustplus.logs[0].text, /^responseTimeout/);
    });

    Test.it('logs a request that its closed socket answered as debug', async () => {
        const rustplus = fakeRustPlus();
        const error = new Error('The relay socket closed before the server answered.');
        error.code = 'ERELAYCLOSED';

        Assert.strictEqual(await rustplus.isResponseValid(error), false);
        Assert.strictEqual(rustplus.logs[0].level, 'debug');
    });

    /* A device that answers wrong_type is a different problem, a device round must not hide it. */
    Test.it('keeps another error an error in a device round', async () => {
        const rustplus = fakeRustPlus();

        await rustplus.isResponseValid({ error: 'wrong_type' }, { expectNotFound: true });

        Assert.strictEqual(rustplus.logs[0].level, 'error');
    });
});

Test.describe('RustPlus.rebuildConnection after a renewal', () => {
    Test.it('ignores the throttle when the token was renewed', () => {
        const socket = fakeSocket();
        const rustplus = fakeRustPlus({ websocket: socket, lastConnectionRebuildMs: Date.now() });

        Assert.strictEqual(rustplus.rebuildConnection('burst'), false);
        Assert.strictEqual(rustplus.rebuildConnection('the account token was renewed', { force: true }), true);
        Assert.strictEqual(socket.closed, 1);
    });

    Test.it('leaves a connect alone that waits for this renewal', () => {
        const rustplus = fakeRustPlus({ awaitingTokenRenewal: true });

        Assert.strictEqual(rustplus.rebuildConnection('the account token was renewed', { force: true }), false);
        Assert.strictEqual(rustplus.connectCalls, 0, 'the waiting connect uses the new token anyway');
    });
});

Test.describe('RustPlus.hasStaleAuthToken', () => {
    const RustPlusAuth = require('../src/util/rustplusAuth.js');

    function stubReadAuth(t, auth) {
        const original = RustPlusAuth.readAuth;
        RustPlusAuth.readAuth = () => auth;
        t.after(() => { RustPlusAuth.readAuth = original; });
    }

    Test.it('is true when the stored token is newer than the one of the socket', (t) => {
        stubReadAuth(t, { token: 'new-token' });

        Assert.strictEqual(fakeRustPlus({ authToken: 'old-token' }).hasStaleAuthToken(), true);
    });

    Test.it('is false while the socket uses the stored token', (t) => {
        stubReadAuth(t, { token: 'token' });

        Assert.strictEqual(fakeRustPlus({ authToken: 'token' }).hasStaleAuthToken(), false);
    });

    Test.it('is false without a login', (t) => {
        stubReadAuth(t, null);

        Assert.strictEqual(fakeRustPlus({ authToken: null }).hasStaleAuthToken(), false);
    });
});
