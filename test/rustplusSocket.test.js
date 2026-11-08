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
        websocket: null,
        relayConnectTimer: null,
        relayHeartbeatTimer: null,
        disconnect: () => { rustplus.websocket = null; },
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
