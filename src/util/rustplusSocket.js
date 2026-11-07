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

const RustPlusTransport = require('./rustplusTransport.js');

/* The protobuf description of the Rust+ protocol ships with the rustplus.js library. */
const PROTO_PATH = Path.join(Path.dirname(require.resolve('@liamcottle/rustplus.js')), 'rustplus.proto');

function connectAuthenticatedSocket(rustplus, serverGuid, authToken) {
    Protobuf.load(PROTO_PATH).then((root) => {
        if (rustplus.websocket) {
            rustplus.disconnect();
        }

        rustplus.AppRequest = root.lookupType('rustplus.AppRequest');
        rustplus.AppMessage = root.lookupType('rustplus.AppMessage');

        rustplus.emit('connecting');

        /* Same handshake as the Rust+ web app: subprotocols, origin and the build timestamp of the app. */
        rustplus.websocket = new WebSocket(RustPlusTransport.buildSocketUrl(serverGuid),
            RustPlusTransport.buildSocketProtocols(authToken), { origin: RustPlusTransport.SOCKET_ORIGIN });

        rustplus.websocket.on('open', () => rustplus.emit('connected'));

        rustplus.websocket.on('error', (e) => rustplus.emit('error', e));

        rustplus.websocket.on('message', (data, isBinary) => {
            /* The relay may answer with a text frame (e.g. a plain-text rejection), only binary frames are protobuf. */
            if (!isBinary) return;

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

        rustplus.websocket.on('close', () => rustplus.emit('disconnected'));
    }).catch((e) => rustplus.emit('error', e));
}

module.exports = {
    PROTO_PATH: PROTO_PATH,
    connectAuthenticatedSocket: connectAuthenticatedSocket,
};
