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
    Issue #7: the relay closed the socket, 'disconnected' removed the instance and scheduled the reconnect. A storage
    monitor read that was still scheduled on the removed instance failed with "Not connected" and reconnected it, while
    the token renewal built the new instance right away. The removed instance's socket survived, logged "RUSTPLUS
    OPERATIONAL" and stopped silently before the polling: a guild that looked connected for two hours and did nothing.
    These tests pin the retirement of removed instances and the guards of the connect flow.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const RustPlus = require('../src/structures/RustPlus.js');
const Connected = require('../src/rustplusEvents/connected.js');
const Disconnected = require('../src/rustplusEvents/disconnected.js');

const GUILD_ID = 'zombieguild';
const SERVER_ID = '1.2.3.4-28082';

function fakeClient() {
    return {
        intlGet: (guildId, key) => key,
        getInstance: () => ({ serverList: { [SERVER_ID]: {} } }),
        rustplusInstances: {},
        activeRustplusInstances: {},
        rustplusReconnecting: {},
        rustplusReconnectTimers: {},
        rustplusReconnectAttempts: {},
        rustplusLiteReconnectTimers: {},
        createRustplusInstance: () => undefined,
    };
}

/* A rustplus instance without the constructor, which would create a logger and touch the runtime storage. */
function fakeRustPlus(overrides = {}) {
    const rustplus = Object.create(RustPlus.prototype);

    rustplus.guildId = GUILD_ID;
    rustplus.serverId = SERVER_ID;
    rustplus.server = '1.2.3.4';
    rustplus.port = '28082';
    rustplus.playerId = null;
    rustplus.playerToken = 1;
    rustplus.isDeleted = false;
    rustplus.authRetryTimer = null;
    rustplus.authRetryAttempt = 0;
    rustplus.operationalWatchdog = null;
    rustplus.transportReconnectScheduled = false;
    rustplus.leaderRustPlusInstance = null;
    rustplus.mapMarkers = null;
    rustplus.timers = {};
    rustplus.lastConnectionRebuildMs = 0;
    rustplus.awaitingTokenRenewal = false;
    rustplus.logs = [];
    rustplus.log = (title, text, level) => rustplus.logs.push({ title: title, text: text, level: level });
    rustplus.connectCalls = 0;
    rustplus.connect = () => { rustplus.connectCalls += 1; };
    rustplus.disconnectCalls = 0;
    rustplus.disconnect = () => { rustplus.disconnectCalls += 1; rustplus.websocket = null; };
    rustplus.websocket = null;
    rustplus.mapRequests = 0;
    rustplus.getMapAsync = async () => { rustplus.mapRequests += 1; return { map: {} }; };
    rustplus.isResponseValid = async () => true;

    Object.assign(rustplus, overrides);

    return rustplus;
}

Test.describe('a removed instance (issue #7)', () => {
    Test.it('does not reconnect when a late request finds its socket closed', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const removed = fakeRustPlus();

        Assert.throws(() => removed.sendRequest({}, () => undefined), /Not connected to the Rust\+ relay/);
        t.mock.timers.tick(5000);

        Assert.strictEqual(removed.connectCalls, 0);
    });

    Test.it('does not reconnect when it is replaced while the reconnect waits', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const old = fakeRustPlus();
        Client.client.rustplusInstances[GUILD_ID] = old;

        Assert.throws(() => old.sendRequest({}, () => undefined));

        /* The token renewal builds the new instance before the 2 s are over. */
        Client.client.rustplusInstances[GUILD_ID] = fakeRustPlus();
        t.mock.timers.tick(5000);

        Assert.strictEqual(old.connectCalls, 0);
    });

    Test.it('still reconnects the connection of the guild when a request finds the socket closed', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const rustplus = fakeRustPlus();
        Client.client.rustplusInstances[GUILD_ID] = rustplus;

        Assert.throws(() => rustplus.sendRequest({}, () => undefined));
        t.mock.timers.tick(2000);

        Assert.strictEqual(rustplus.connectCalls, 1);
    });

    Test.it('is retired by its disconnected event, the reconnect is a new instance', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const client = Client.client;
        const rustplus = fakeRustPlus();
        client.rustplusInstances[GUILD_ID] = rustplus;
        client.activeRustplusInstances[GUILD_ID] = true;

        await Disconnected.execute(rustplus, client);

        Assert.strictEqual(rustplus.isDeleted, true);
        Assert.strictEqual(client.rustplusInstances[GUILD_ID], undefined);
        Assert.ok(client.rustplusReconnectTimers[GUILD_ID], 'the reconnect is scheduled');

        /* The storage monitor read that was scheduled before the close. */
        Assert.throws(() => rustplus.sendRequest({}, () => undefined));
        t.mock.timers.tick(5000);

        Assert.strictEqual(rustplus.connectCalls, 0);
    });

    Test.it('never connects again once retired', () => {
        Client.client = fakeClient();
        const rustplus = fakeRustPlus();
        rustplus.retire();

        /* The real connect(), not the counter of fakeRustPlus. */
        Assert.strictEqual(RustPlus.prototype.connect.call(rustplus), undefined);
        Assert.strictEqual(rustplus.isDeleted, true);
    });

    Test.it('does not remove its successor from the guild when it is deleted', () => {
        Client.client = fakeClient();
        const old = fakeRustPlus();
        const successor = fakeRustPlus();
        Client.client.rustplusInstances[GUILD_ID] = successor;

        Assert.strictEqual(old.deleteThisRustplusInstance(), false);
        Assert.strictEqual(Client.client.rustplusInstances[GUILD_ID], successor);
        Assert.strictEqual(old.isDeleted, true);
        Assert.strictEqual(old.disconnectCalls, 1);
    });
});

Test.describe('the connect flow (issue #7)', () => {
    Test.it('closes the socket of an instance that is not registered and never logs RUSTPLUS OPERATIONAL', async () => {
        Client.client = fakeClient();
        const zombie = fakeRustPlus();

        await Connected.execute(zombie, Client.client);

        Assert.strictEqual(zombie.disconnectCalls, 1);
        Assert.strictEqual(zombie.isDeleted, true);
        Assert.strictEqual(zombie.mapRequests, 0);
        Assert.ok(!zombie.logs.some((entry) => entry.text === 'rustplusOperational'));
    });

    Test.it('closes the socket of a replaced instance without touching the current one', async () => {
        Client.client = fakeClient();
        const current = fakeRustPlus();
        const replaced = fakeRustPlus();
        Client.client.rustplusInstances[GUILD_ID] = current;

        await Connected.execute(replaced, Client.client);

        Assert.strictEqual(replaced.disconnectCalls, 1);
        Assert.strictEqual(Client.client.rustplusInstances[GUILD_ID], current);
        Assert.strictEqual(current.isDeleted, false);
    });

    Test.it('drops an instance that was replaced while the map request waited', async () => {
        Client.client = fakeClient();
        const rustplus = fakeRustPlus();
        Client.client.rustplusInstances[GUILD_ID] = rustplus;

        rustplus.getMapAsync = async () => {
            Client.client.rustplusInstances[GUILD_ID] = fakeRustPlus();
            return { map: {} };
        };

        await Connected.execute(rustplus, Client.client);

        Assert.strictEqual(rustplus.disconnectCalls, 1);
        Assert.strictEqual(rustplus.isDeleted, true);
        Assert.ok(!rustplus.logs.some((entry) => entry.text === 'rustplusOperational'));
    });
});

Test.describe('the first poll watchdog (issue #7)', () => {
    Test.it('rebuilds a connection that never polled', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const socket = { closed: 0, close: () => { socket.closed += 1; } };
        const rustplus = fakeRustPlus({ websocket: socket });
        Client.client.rustplusInstances[GUILD_ID] = rustplus;

        Connected.startFirstPollWatchdog(Client.client, rustplus);
        t.mock.timers.tick(Connected.FIRST_POLL_WATCHDOG_MS);

        Assert.strictEqual(socket.closed, 1);
        Assert.ok(rustplus.logs.some((entry) => entry.level === 'warn' && /No poll cycle ran/.test(entry.text)));
    });

    Test.it('leaves a connection alone that polls', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const socket = { closed: 0, close: () => { socket.closed += 1; } };
        const rustplus = fakeRustPlus({ websocket: socket });
        Client.client.rustplusInstances[GUILD_ID] = rustplus;

        Connected.startFirstPollWatchdog(Client.client, rustplus);
        rustplus.pollCycleId = 1;
        t.mock.timers.tick(Connected.FIRST_POLL_WATCHDOG_MS);

        Assert.strictEqual(socket.closed, 0);
    });

    Test.it('closes the socket of a connection that is not the one of the guild anymore', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const rustplus = fakeRustPlus();
        Client.client.rustplusInstances[GUILD_ID] = rustplus;

        Connected.startFirstPollWatchdog(Client.client, rustplus);
        delete Client.client.rustplusInstances[GUILD_ID];
        t.mock.timers.tick(Connected.FIRST_POLL_WATCHDOG_MS);

        Assert.strictEqual(rustplus.disconnectCalls, 1);
        Assert.strictEqual(rustplus.isDeleted, true);
    });

    Test.it('stops with the retirement of the instance', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const socket = { closed: 0, close: () => { socket.closed += 1; } };
        const rustplus = fakeRustPlus({ websocket: socket });
        Client.client.rustplusInstances[GUILD_ID] = rustplus;

        Connected.startFirstPollWatchdog(Client.client, rustplus);
        rustplus.retire();
        t.mock.timers.tick(Connected.FIRST_POLL_WATCHDOG_MS);

        Assert.strictEqual(socket.closed, 0);
        Assert.strictEqual(rustplus.operationalWatchdog, null);
    });
});

Test.describe('RustPlus.scheduleTransportReconnect (socket state)', () => {
    /* A replaced CONNECTING/CLOSING socket closed late and was ignored: the disconnect cleanup never ran. */
    Test.it('leaves a socket alone that is still connecting or already closing', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        for (const readyState of [0, 2]) {
            Client.client = fakeClient();
            const rustplus = fakeRustPlus({ websocket: { readyState: readyState } });
            Client.client.rustplusInstances[GUILD_ID] = rustplus;

            Assert.throws(() => rustplus.sendRequest({}, () => undefined), /Not connected to the Rust\+ relay/);
            t.mock.timers.tick(5000);

            Assert.strictEqual(rustplus.connectCalls, 0, `readyState ${readyState}`);
            Assert.strictEqual(rustplus.transportReconnectScheduled, false);
        }
    });

    Test.it('does not replace a socket that was opened while the reconnect waited', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        Client.client = fakeClient();
        const socket = { readyState: 3 };
        const rustplus = fakeRustPlus({ websocket: socket });
        Client.client.rustplusInstances[GUILD_ID] = rustplus;

        Assert.throws(() => rustplus.sendRequest({}, () => undefined));
        socket.readyState = 1;
        t.mock.timers.tick(2000);

        Assert.strictEqual(rustplus.connectCalls, 0);
    });
});
