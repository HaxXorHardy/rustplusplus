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
    The relay socket needs the account token. A server entry that is keyed by its pairing id (`relay-<uuid>`) has no
    address, and the library transports would build `ws://relay:<uuid>` - which throws inside the WebSocket
    constructor and ends the process through an unhandled rejection. These tests pin the guards of both instances.
*/
const Assert = require('node:assert');
const Test = require('node:test');

const RustPlusLib = require('@liamcottle/rustplus.js');

const Client = require('../src/structures/clientRegistry.js');
const RustPlus = require('../src/structures/RustPlus.js');
const RustPlusLite = require('../src/structures/RustPlusLite.js');
const RustPlusSocket = require('../src/util/rustplusSocket.js');

const STEAM_ID = '76561198000000400';
const GUID = '6f2a1c3d-4b5e-4978-8a9b-0c1d2e3f4a5b';

/* Only the translations are needed, the instances below are built by hand instead of the constructor. */
Client.client = { intlGet: (guildId, key) => key };
/* Replaces the library transport, which would open a real websocket, and counts its use. */
function stubLibraryConnect(t, result) {
    const original = RustPlusLib.prototype.connect;
    const calls = { count: 0 };

    RustPlusLib.prototype.connect = function () {
        calls.count += 1;
        return result;
    };

    t.after(() => { RustPlusLib.prototype.connect = original; });

    return calls;
}

/* Replaces the authenticated socket, which would need a real relay connection. */
function stubAuthenticatedSocket(t) {
    const original = RustPlusSocket.connectAuthenticatedSocket;
    const calls = [];

    RustPlusSocket.connectAuthenticatedSocket = function (rustplus, serverGuid, authToken) {
        calls.push({ serverGuid: serverGuid, authToken: authToken });
        return 'authenticated';
    };

    t.after(() => { RustPlusSocket.connectAuthenticatedSocket = original; });

    return calls;
}
/* A rustplus instance without the constructor, which would create a logger and touch the runtime storage. */
function fakeInstance(fields) {
    const instance = Object.assign({
        server: 'relay',
        port: GUID,
        serverId: `relay-${GUID}`,
        serverGuid: GUID,
        authToken: null,
        playerId: STEAM_ID,
        guildId: '1474484924093432003',
        isDeleted: false,
        authRetryAttempt: 0,
        authRetryTimer: null,
        renewDue: false,
        logged: [],
        retries: [],
    }, fields);

    instance.log = function (title, text, level) { this.logged.push({ text: text, level: level }); };
    instance.scheduleAuthRetry = function (reason) { this.retries.push(reason); };
    instance.cancelAuthRetry = function () { this.retriesCancelled = true; };
    instance.shouldRenewAuthToken = function () { return this.renewDue; };

    return instance;
}
Test.describe('RustPlus.connect (relay entries)', () => {
    Test.it('does not build a direct websocket for a server keyed by its pairing id', (t) => {
        const library = stubLibraryConnect(t, 'library');

        const rustplus = fakeInstance();
        const result = RustPlus.prototype.connect.call(rustplus);

        Assert.strictEqual(result, undefined);
        Assert.strictEqual(library.count, 0);
        Assert.strictEqual(rustplus.retries.length, 1);
        Assert.ok(rustplus.logged.some((entry) => entry.level === 'error'));
    });
    Test.it('keeps the library transport for a server with an address', (t) => {
        const library = stubLibraryConnect(t, 'library');

        const rustplus = fakeInstance({
            server: '91.229.114.90',
            port: '28082',
            serverId: '91.229.114.90-28082',
            serverGuid: null,
        });

        const result = RustPlus.prototype.connect.call(rustplus);

        Assert.strictEqual(result, 'library');
        Assert.strictEqual(library.count, 1);
        Assert.deepStrictEqual(rustplus.retries, []);
    });
Test.describe('RustPlusLite.connect (relay entries)', () => {
    Test.it('does not build a direct websocket for a leader without a login', (t) => {
        const library = stubLibraryConnect(t, 'library');

        /* No login for the leader, resolveAuthenticatedTransport() finds no stored token. */
        const rustplusLite = fakeInstance({ resolveAuthenticatedTransport: () => false });
        const result = RustPlusLite.prototype.connect.call(rustplusLite);

        Assert.strictEqual(result, undefined);
        Assert.strictEqual(library.count, 0);
        Assert.ok(rustplusLite.logged.some((entry) => entry.level === 'warn'));
    });
});
    Test.it('uses the authenticated socket with the stored token', (t) => {
        const library = stubLibraryConnect(t, 'library');
        const socket = stubAuthenticatedSocket(t);

        const rustplus = fakeInstance({ authToken: 'account-token' });
        const result = RustPlus.prototype.connect.call(rustplus);

        Assert.strictEqual(result, 'authenticated');
        Assert.strictEqual(library.count, 0);
        Assert.deepStrictEqual(socket, [{ serverGuid: GUID, authToken: 'account-token' }]);
        Assert.strictEqual(rustplus.retriesCancelled, true);
    });
});
Test.describe("RustPlus.checkAuthTokenRenewal", () => {
    const RustPlusLogin = require("../src/util/rustplusLogin.js");

    function stubRenewAuth(t, implementation) {
        const original = RustPlusLogin.renewAuth;
        const calls = [];

        RustPlusLogin.renewAuth = async (steamId, log) => {
            calls.push(steamId);
            return implementation(steamId, log);
        };

        t.after(() => { RustPlusLogin.renewAuth = original; });

        return calls;
    }

    function fakeRenewing(fields) {
        const instance = fakeInstance(Object.assign({
            authToken: "old-token",
            lastTokenRenewalCheckMs: 0,
            lastTokenRenewalAttemptMs: 0,
            renewDue: true,
            applied: [],
        }, fields));

        instance.applyRenewedAccountState = function (auth) { this.applied.push(auth.token); };

        return instance;
    }

    Test.it("renews the token in the background when it is due", async (t) => {
        const calls = stubRenewAuth(t, async () => ({ token: "new-token", servers: [] }));

        const rustplus = fakeRenewing();
        await RustPlus.prototype.checkAuthTokenRenewal.call(rustplus);

        Assert.deepStrictEqual(calls, [STEAM_ID]);
        Assert.strictEqual(rustplus.authToken, "new-token");
        Assert.deepStrictEqual(rustplus.applied, ["new-token"]);
        Assert.ok(rustplus.logged.some((entry) => entry.text.includes("renewed in the background")));
    });

    Test.it("checks at most once per interval", async (t) => {
        const calls = stubRenewAuth(t, async () => ({ token: "new-token", servers: [] }));

        const rustplus = fakeRenewing();
        await RustPlus.prototype.checkAuthTokenRenewal.call(rustplus);
        await RustPlus.prototype.checkAuthTokenRenewal.call(rustplus);

        Assert.strictEqual(calls.length, 1);
    });

    Test.it("does nothing while the token is fresh", async (t) => {
        const calls = stubRenewAuth(t, async () => ({ token: "new-token", servers: [] }));

        const rustplus = fakeRenewing({ renewDue: false });
        await RustPlus.prototype.checkAuthTokenRenewal.call(rustplus);

        Assert.deepStrictEqual(calls, []);
        Assert.strictEqual(rustplus.authToken, "old-token");
    });

    Test.it("logs a failed renewal instead of throwing", async (t) => {
        stubRenewAuth(t, async () => { throw new Error("steam says no"); });

        const rustplus = fakeRenewing();
        await RustPlus.prototype.checkAuthTokenRenewal.call(rustplus);

        Assert.strictEqual(rustplus.authToken, "old-token");
        Assert.ok(rustplus.logged.some((entry) => entry.level === "warn" && entry.text.includes("steam says no")));
    });
});

/*
    An entry that carries neither an address nor a usable login (an instance file of an older version, or a pairing
    that only brought the pairing id) must never reach the library transport: it would build
    `new WebSocket('ws://undefined:undefined')`, which throws and ends the process as an unhandled rejection.
*/
Test.describe('RustPlus.connect (missing address)', () => {
    Test.it('never builds a websocket without an address', (t) => {
        const library = stubLibraryConnect(t, 'library');

        const rustplus = fakeInstance({
            server: undefined,
            port: undefined,
            serverId: 'undefined-undefined',
            serverGuid: null,
            authToken: null,
        });

        const result = RustPlus.prototype.connect.call(rustplus);

        Assert.strictEqual(result, undefined);
        Assert.strictEqual(library.count, 0);
        Assert.ok(rustplus.logged.some((entry) => entry.level === 'error'));
        Assert.deepStrictEqual(rustplus.retries, ['The address of the server is unknown.']);
    });
});

Test.describe('RustPlusLite.connect (missing address)', () => {
    Test.it('never builds a websocket without an address', (t) => {
        const library = stubLibraryConnect(t, 'library');

        const rustplusLite = fakeInstance({
            server: undefined,
            port: undefined,
            serverGuid: null,
            resolveAuthenticatedTransport: () => false,
        });

        const result = RustPlusLite.prototype.connect.call(rustplusLite);

        Assert.strictEqual(result, undefined);
        Assert.strictEqual(library.count, 0);
        Assert.ok(rustplusLite.logged.some((entry) => entry.level === 'warn'));
    });
});
