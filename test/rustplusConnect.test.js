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