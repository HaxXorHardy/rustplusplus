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
const Test = require('node:test');

const RustPlusSocket = require('../src/util/rustplusSocket.js');

/*
    Stands in for the ws socket. terminate() mirrors ws: a socket that is aborted during the handshake emits 'error'
    and then 'close', which is what starts the reconnect of the instance.
*/
class FakeWebSocket {
    static instances = [];

    constructor(url, protocols, options) {
        this.url = url;
        this.protocols = protocols;
        this.options = options;
        this.readyState = FakeWebSocket.CONNECTING;
        this.terminated = 0;
        this.handlers = new Object();

        FakeWebSocket.instances.push(this);
    }

    on(event, handler) {
        this.handlers[event] = handler;
    }

    emit(event, ...args) {
        if (this.handlers[event]) this.handlers[event](...args);
    }

    terminate() {
        this.terminated += 1;

        if (this.readyState === FakeWebSocket.CLOSED) return;

        const wasConnecting = this.readyState === FakeWebSocket.CONNECTING;
        this.readyState = FakeWebSocket.CLOSED;

        if (wasConnecting) this.emit('error', new Error('WebSocket was closed before the connection was established'));

        this.emit('close', 1006, '');
    }
}

FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

/* A rejection is answered with a plain HTTP response instead of the upgrade, drained like ws does it. */
function rejection(statusCode, statusMessage) {
    return {
        statusCode: statusCode,
        statusMessage: statusMessage,
        resume: () => undefined,
    };
}

function fakeRustplus() {
    const rustplus = {
        events: [],
        logs: [],
        websocket: null,
        relayConnectTimer: null,
        relayHeartbeatTimer: null,
        relayConnectedAtMs: null,
        relayHeartbeatMissed: false,
        disconnect: () => { rustplus.websocket = null; },
        log: (cap, text, level) => { rustplus.logs.push({ cap: cap, text: text, level: level }); },
        emit: (event, ...args) => {
            rustplus.events.push({ event, args });
            return true;
        },
    };

    return rustplus;
}

/* The protobuf file is loaded before the socket is built, so the instance appears a few microtasks later. */
async function waitForSocket() {
    for (let i = 0; i < 200; i++) {
        const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
        if (socket !== undefined) return socket;

        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    throw new Error('The websocket was not created.');
}

function eventNames(rustplus) {
    return rustplus.events.map((entry) => entry.event);
}

function errors(rustplus) {
    return rustplus.events.filter((entry) => entry.event === 'error').map((entry) => entry.args[0]);
}

async function connect(rustplus, connectTimeoutMs = RustPlusSocket.CONNECT_TIMEOUT_MS) {
    FakeWebSocket.instances = [];

    RustPlusSocket.connectAuthenticatedSocket(rustplus, 'server-guid', 'auth-token', {
        WebSocketImpl: FakeWebSocket,
        connectTimeoutMs: connectTimeoutMs,
    });

    return await waitForSocket();
}

Test.describe('Rust+ authenticated socket', () => {
    Test.it('closes the socket and reports the rejection when the relay answers with an HTTP error', async () => {
        const rustplus = fakeRustplus();
        const socket = await connect(rustplus);

        socket.emit('unexpected-response', { abort: () => undefined }, rejection(502, 'Bad Gateway'));

        const reported = errors(rustplus);

        /* Exactly one error: the teardown error of ws is not reported a second time. */
        Assert.strictEqual(reported.length, 1);
        Assert.strictEqual(reported[0].code, 'ERELAYREJECTED');
        Assert.strictEqual(reported[0].message, 'The relay rejected the handshake with HTTP 502 Bad Gateway.');

        /*
            The rejection is only survivable because the socket is closed: 'close' emits 'disconnected', which the
            instance uses to schedule its reconnect.
        */
        Assert.strictEqual(socket.terminated, 1);
        Assert.deepStrictEqual(eventNames(rustplus), ['connecting', 'error', 'disconnected']);
    });

    Test.it('closes a handshake that the relay never answers', async () => {
        const rustplus = fakeRustplus();
        const socket = await connect(rustplus, 20);

        await new Promise((resolve) => setTimeout(resolve, 80));

        const reported = errors(rustplus);

        Assert.strictEqual(reported.length, 1);
        Assert.strictEqual(reported[0].code, 'ERELAYTIMEOUT');
        Assert.strictEqual(socket.terminated, 1);
        Assert.deepStrictEqual(eventNames(rustplus), ['connecting', 'error', 'disconnected']);
    });

    Test.it('keeps a socket that completes the handshake', async () => {
        const rustplus = fakeRustplus();
        const socket = await connect(rustplus, 20);

        socket.readyState = FakeWebSocket.OPEN;
        socket.emit('open');

        await new Promise((resolve) => setTimeout(resolve, 60));

        /* The connect timer is gone, the connection is not aborted by it. */
        Assert.strictEqual(rustplus.relayConnectTimer, null);
        Assert.strictEqual(socket.terminated, 0);
        Assert.deepStrictEqual(eventNames(rustplus), ['connecting', 'connected']);

        clearInterval(rustplus.relayHeartbeatTimer);

        /* A socket that the relay closes is still reported, that is what starts the reconnect. */
        socket.readyState = FakeWebSocket.CLOSED;
        socket.emit('close', 1006, '');

        Assert.deepStrictEqual(eventNames(rustplus), ['connecting', 'connected', 'disconnected']);
    });
});

Test.describe('Rust+ socket close diagnostics', () => {
    Test.it('names the close code and the uptime of a closed socket', async () => {
        const rustplus = fakeRustplus();
        const socket = await connect(rustplus);

        socket.emit('open');
        rustplus.relayConnectedAtMs = Date.now() - 5000;

        socket.emit('close', 1006, '');

        const line = rustplus.logs[rustplus.logs.length - 1];

        Assert.strictEqual(line.cap, 'DISCONNECTED');
        Assert.strictEqual(line.level, 'warn');
        Assert.ok(line.text.includes('code 1006'), line.text);
        Assert.ok(line.text.includes('after 5s'), line.text);
        Assert.deepStrictEqual(eventNames(rustplus).slice(-1), ['disconnected']);
    });

    Test.it('answers the open requests at once when the socket closes', async () => {
        const rustplus = fakeRustplus();
        const answers = [];
        rustplus.seqCallbacks = [];
        rustplus.seqCallbacks[7] = (message) => answers.push(message);

        const socket = await connect(rustplus);
        socket.emit('open');
        socket.emit('close', 1006, '');

        Assert.strictEqual(answers.length, 1);
        Assert.strictEqual(answers[0].response.seq, 7);
        Assert.ok(answers[0].response.error instanceof Error);
        Assert.strictEqual(answers[0].response.error.code, RustPlusSocket.RELAY_CLOSED_CODE);
        Assert.deepStrictEqual(Object.keys(rustplus.seqCallbacks), []);
    });

    Test.it('ends the requests of a socket that a new connect replaces, and its late close leaves the new one alone',
        async () => {
            const rustplus = fakeRustplus();
            const answers = [];
            rustplus.seqCallbacks = [];
            rustplus.seqCallbacks[3] = (message) => answers.push(message);

            const oldSocket = await connect(rustplus);
            oldSocket.emit('open');
            Assert.ok(rustplus.relayHeartbeatTimer, 'the old socket runs its heartbeat');

            /* A connect over the running socket (auth retry, transport reconnect) replaces it. */
            const newSocket = await connect(rustplus);
            Assert.notStrictEqual(newSocket, oldSocket);
            Assert.strictEqual(rustplus.websocket, newSocket);
            Assert.strictEqual(answers.length, 1, 'the request of the old socket is answered at once');
            Assert.strictEqual(answers[0].response.error.code, RustPlusSocket.RELAY_CLOSED_CODE);
            Assert.strictEqual(rustplus.relayHeartbeatTimer, null, 'the heartbeat of the old socket is stopped');

            const connectTimer = rustplus.relayConnectTimer;
            Assert.ok(connectTimer, 'the new socket waits for its handshake');
            rustplus.seqCallbacks[9] = (message) => answers.push(message);
            const before = eventNames(rustplus).length;

            /* The old socket closes only now. */
            oldSocket.emit('close', 1006, '');

            Assert.strictEqual(rustplus.relayConnectTimer, connectTimer, 'the handshake timeout of the new socket stays');
            Assert.strictEqual(typeof rustplus.seqCallbacks[9], 'function', 'the request of the new socket stays open');
            Assert.deepStrictEqual(eventNames(rustplus).slice(before), [], 'no disconnected for the new connection');
            Assert.ok(rustplus.logs.some((entry) => entry.text.includes('A replaced relay socket was closed')));

            newSocket.emit('open');
            newSocket.emit('close', 1006, '');
            Assert.strictEqual(answers.length, 2, 'the new socket ends its own requests when it closes');
            Assert.ok(eventNames(rustplus).includes('disconnected'));
        });

    Test.it('says when the heartbeat closed the socket', async () => {
        const rustplus = fakeRustplus();
        const socket = await connect(rustplus);

        socket.emit('open');
        rustplus.relayHeartbeatMissed = true;

        socket.emit('close', 1006, '');

        const line = rustplus.logs[rustplus.logs.length - 1];

        Assert.ok(line.text.includes('the heartbeat was not answered'), line.text);
    });

    Test.it('keeps the reason of the relay and cuts it', () => {
        Assert.strictEqual(RustPlusSocket.describeClose(1001, ''), 'code 1001');
        Assert.strictEqual(RustPlusSocket.describeClose(1001, 'Server shutting down'),
            'code 1001: Server shutting down');
        Assert.strictEqual(RustPlusSocket.describeClose(4001, 'x'.repeat(200)).length, 'code 4001: '.length + 120);
        Assert.strictEqual(RustPlusSocket.describeClose(1006, undefined), 'code 1006');
    });

    Test.it('formats the uptime of a socket', () => {
        const now = 10_000_000;

        Assert.strictEqual(RustPlusSocket.describeUptime(null, now), null);
        Assert.strictEqual(RustPlusSocket.describeUptime(now - 42_000, now), '42s');
        Assert.strictEqual(RustPlusSocket.describeUptime(now - (7 * 60 + 30) * 1000, now), '7m 30s');
        Assert.strictEqual(RustPlusSocket.describeUptime(now - (2 * 3600 + 5 * 60) * 1000, now), '2h 5m');
    });
});
