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

Test.describe('RustPlus.checkAuthTokenRenewal', () => {
    Test.it('rebuilds the connection after the token was renewed', async (t) => {
        const RustPlusAuth = require('../src/util/rustplusAuth.js');
        const RustPlusLogin = require('../src/util/rustplusLogin.js');

        const originalReadAuth = RustPlusAuth.readAuth;
        const originalRenewAuth = RustPlusLogin.renewAuth;

        RustPlusAuth.readAuth = () => ({
            steamId: STEAM_ID,
            token: 'old-token',
            steamRefreshToken: 'refresh-token',
            tokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
            servers: [],
        });

        RustPlusLogin.renewAuth = async () => ({ steamId: STEAM_ID, token: 'new-token', servers: [] });

        t.after(() => {
            RustPlusAuth.readAuth = originalReadAuth;
            RustPlusLogin.renewAuth = originalRenewAuth;
        });

        const reasons = [];
        const rustplus = fakeRustPlus({
            authToken: 'old-token',
            applyRenewedAccountState: () => undefined,
            rebuildConnection: (reason) => reasons.push(reason),
        });

        await rustplus.checkAuthTokenRenewal();

        Assert.strictEqual(rustplus.authToken, 'new-token');
        Assert.deepStrictEqual(reasons, ['the account token was renewed in the background']);
    });

    Test.it('does not rebuild when there was nothing to renew', async (t) => {
        const RustPlusAuth = require('../src/util/rustplusAuth.js');
        const originalReadAuth = RustPlusAuth.readAuth;

        /* A token that is valid for weeks is not renewed. */
        RustPlusAuth.readAuth = () => ({
            steamId: STEAM_ID,
            token: 'old-token',
            steamRefreshToken: 'refresh-token',
            tokenExpiresAt: Math.floor(Date.now() / 1000) + (30 * 24 * 3600),
            servers: [],
        });

        t.after(() => {
            RustPlusAuth.readAuth = originalReadAuth;
        });

        const reasons = [];
        const rustplus = fakeRustPlus({
            authToken: 'old-token',
            rebuildConnection: (reason) => reasons.push(reason),
        });

        await rustplus.checkAuthTokenRenewal();

        Assert.strictEqual(rustplus.authToken, 'old-token');
        Assert.deepStrictEqual(reasons, []);
    });
});
