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
    WebSocket transport of the Rust+ app: an authenticated wss connection per server, addressed by the server id
    (pairing uuid) with the account token sent as websocket subprotocol.

    The rustplus.js library can only build the direct and proxy endpoints Facepunch removed, so the connection is
    opened here and wired to the same events the library emits. Everything above the transport (sendRequestAsync,
    the protobuf messages, all handlers) therefore keeps working unchanged.
*/

const Path = require('path');
const Protobuf = require('protobufjs');
const WebSocket = require('ws');

const Config = require('../../config');
const RustPlusTransport = require('./rustplusTransport.js');

/* The protobuf description of the Rust+ protocol ships with the rustplus.js library. */
const PROTO_PATH = Path.join(Path.dirname(require.resolve('@liamcottle/rustplus.js')), 'rustplus.proto');

/* A socket that does not answer a ping within this interval is dropped and reconnected. */
const HEARTBEAT_INTERVAL_MS = 30000;

/* The proto file is parsed once instead of on every connect. */
let protoRootPromise = null;

function loadProtoRoot() {
    if (protoRootPromise === null) {
        protoRootPromise = Protobuf.load(PROTO_PATH).catch((e) => {
            protoRootPromise = null;
            throw e;
        });
    }

    return protoRootPromise;
}

/* The relay answers a rejection with a text frame, it never reaches the protobuf decoder. */
function logTextFrame(rustplus, data) {
    const text = `${data}`.slice(0, 300);

    if (rustplus && typeof rustplus.log === 'function') {
        rustplus.log('Relay', `The relay sent a text frame instead of a message: ${text}`, 'warn');
    }
}

/*
    The relay closes idle sockets without telling us. A missed pong means the connection is dead, so the reconnect runs
    right away instead of waiting for the next request to time out.
*/
function startHeartbeat(rustplus, websocket) {
    let alive = true;

    websocket.on('pong', () => { alive = true; });

    const timer = setInterval(() => {
        if (websocket.readyState !== WebSocket.OPEN) return;

        if (!alive) {
            /* terminate() fires close, which runs the reconnect of the instance. */
            websocket.terminate();
            return;
        }

        alive = false;
        websocket.ping();
    }, HEARTBEAT_INTERVAL_MS);

    if (typeof timer.unref === 'function') timer.unref();

    rustplus.relayHeartbeatTimer = timer;
}

function stopHeartbeat(rustplus) {
    if (rustplus.relayHeartbeatTimer) {
        clearInterval(rustplus.relayHeartbeatTimer);
        rustplus.relayHeartbeatTimer = null;
    }
}

function connectAuthenticatedSocket(rustplus, serverGuid, authToken) {
    loadProtoRoot().then((root) => {
        if (rustplus.websocket) {
            rustplus.disconnect();
        }

        rustplus.AppRequest = root.lookupType('rustplus.AppRequest');
        rustplus.AppMessage = root.lookupType('rustplus.AppMessage');

        rustplus.emit('connecting');

        /* Same handshake as the Rust+ web app: subprotocols, origin and the build timestamp of the app. */
        const buildVersion = RustPlusTransport.resolveBuildVersion(Config.general.rustplusBuildVersion);
        const websocket = new WebSocket(RustPlusTransport.buildSocketUrl(serverGuid, buildVersion),
            RustPlusTransport.buildSocketProtocols(authToken), { origin: RustPlusTransport.SOCKET_ORIGIN });

        rustplus.websocket = websocket;

        websocket.on('open', () => {
            startHeartbeat(rustplus, websocket);
            rustplus.emit('connected');
        });

        websocket.on('error', (e) => rustplus.emit('error', e));

        /* A handshake that is answered without an upgrade (expired token, unknown server) never becomes a socket. */
        websocket.on('unexpected-response', (request, response) => {
            response.resume();

            const error = new Error(`The relay rejected the handshake with HTTP ${response.statusCode} ` +
                `${response.statusMessage === undefined ? '' : response.statusMessage}`.trim());
            error.code = 'ERELAYREJECTED';

            rustplus.emit('error', error);
        });

        websocket.on('message', (data, isBinary) => {
            /* Only binary frames are protobuf, a text frame is a plain-text rejection of the relay. */
            if (!isBinary) {
                logTextFrame(rustplus, data);
                return;
            }

            let message = null;
            try {
                message = rustplus.AppMessage.decode(data);
            }
            catch (e) {
                rustplus.emit('error', e);
                return;
            }

            if (message.response && message.response.seq && rustplus.seqCallbacks[message.response.seq]) {
                const callback = rustplus.seqCallbacks[message.response.seq];
                const result = callback(message);

                delete rustplus.seqCallbacks[message.response.seq];

                /* A callback that returns true handled the message, do not emit it. */
                if (result) return;
            }

            rustplus.emit('message', message);
        });

        websocket.on('close', () => {
            stopHeartbeat(rustplus);
            rustplus.emit('disconnected');
        });
    }).catch((e) => rustplus.emit('error', e));
}

module.exports = {
    PROTO_PATH: PROTO_PATH,
    HEARTBEAT_INTERVAL_MS: HEARTBEAT_INTERVAL_MS,
    connectAuthenticatedSocket: connectAuthenticatedSocket,
};
