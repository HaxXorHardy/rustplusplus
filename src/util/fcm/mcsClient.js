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
    Keeps the connection of a GCM device to Google's Mobile Connection Server and emits its data messages. Same
    interface and behaviour as Client of @liamcottle/push-receiver 0.0.4 (MIT, Copyright (c) 2017 Matthieu Lemoine):
    events 'connect', 'disconnect' and 'ON_DATA_RECEIVED' (the DataMessageStanza object), reconnects after a drop
    with a growing pause (1 s .. 15 s), _socket is the TLS socket. The check-in before each connect uses axios.

    Rust+ notifications are plain data messages, so the unused web push decryption of the original is left out
    (its check never matched: it looked for a key in the appData array with the "in" operator).

    Heartbeats (not in the original): the login turns adaptive heartbeats off, so the server expects the client to
    ping. Without pings Google closed the connection about every 28 minutes. After the login the client pings every
    HEARTBEAT_INTERVAL_MS and answers the pings of the server; a ping with nothing received since the previous one
    means the connection is dead, it is dropped and reconnects.
*/

const EventEmitter = require('events');
const Protobuf = require('protobufjs');
const Tls = require('tls');

const AndroidFcm = require('./androidFcm.js');
const { McsParser, TAGS, MCS_VERSION, lookupType } = require('./mcsParser.js');

const HOST = 'mtalk.google.com';
const PORT = 5228;
const MAX_RETRY_SECONDS = 15;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 30 * 1000;
/* The ids of the data messages since the last login: duplicates are not emitted, the login acknowledges them. */
const MAX_PERSISTENT_IDS = 500;

class McsClient extends EventEmitter {
    /* deps: { checkIn, connectSocket } for tests. */
    constructor(androidId, securityToken, persistentIds, deps = {}) {
        super();
        this._androidId = `${androidId}`;
        this._securityToken = `${securityToken}`;
        this._persistentIds = new Set(Array.isArray(persistentIds) ? persistentIds.slice(-MAX_PERSISTENT_IDS) : []);
        this._checkIn = deps.checkIn || AndroidFcm.checkIn;
        this._connectSocket = deps.connectSocket || ((options) => Tls.connect(options));
        this._retryCount = 0;
        this._retryTimeout = null;
        this._destroyed = false;
        this._socket = null;
        this._parser = null;
        this._heartbeatTimer = null;
        this._loginTimer = null;
        this._receivedSincePing = true;
        this._pendingLogin = null;
    }

    /*
        Resolves once Google accepted the login. Rejects when the check-in fails, or when the login is rejected, times
        out or the connection closes before it (error.mcsLogin) - the client plans its own retry in that case as after
        any drop, the caller learns of it to count failures (a device Google dropped only shows at the login).
        Resolves without a connection when destroy() comes first.
    */
    async connect() {
        this._destroyed = false;
        clearTimeout(this._retryTimeout);
        this._retryTimeout = null;

        await this._checkIn(this._androidId, this._securityToken);
        if (this._destroyed) return;

        await new Promise((resolve, reject) => {
            this._settleLogin(new Error('A newer connect() replaced this one.'));
            this._pendingLogin = { resolve: resolve, reject: reject };
            this._open();
        });
    }

    destroy() {
        this._destroyed = true;
        this._teardown();
        this._settleLogin(null);
    }

    /* Ends the promise of a connect() that waits for its login: resolved without an error, else rejected. */
    _settleLogin(error) {
        const pending = this._pendingLogin;
        if (!pending) return;

        this._pendingLogin = null;
        if (error) pending.reject(error);
        else pending.resolve();
    }

    _open() {
        this._teardown();

        /* Built before the socket opens: a throw here must not leave a connection behind. */
        const login = this._loginBuffer();

        const socket = this._connectSocket({ host: HOST, port: PORT, servername: HOST });
        this._socket = socket;
        this._parser = new McsParser();

        if (typeof socket.setKeepAlive === 'function') socket.setKeepAlive(true);

        /*
            'connect' and the reset of the backoff wait for an accepted login (see _onMessage): Google accepts TLS and
            then rejects a stale security token, and a reset here would retry such a login every second forever.
        */
        socket.on('data', (chunk) => this._onData(socket, chunk));
        socket.on('close', () => {
            if (this._socket !== socket) return;
            this._drop();
        });
        socket.on('error', () => {
            /* 'close' follows and reconnects. */
        });

        socket.write(login);

        /*
            The heartbeat only starts with the login response: a connection that never answers the login would stay
            silent for as long as TCP keeps it, so it gets LOGIN_TIMEOUT_MS and is then dropped and reconnected.
        */
        this._loginTimer = setTimeout(() => {
            this._loginTimer = null;
            if (this._socket === socket) this._drop('The MCS login timed out.');
        }, LOGIN_TIMEOUT_MS);

        if (typeof this._loginTimer.unref === 'function') this._loginTimer.unref();
    }

    _onData(socket, chunk) {
        if (this._socket !== socket) return;

        let messages;
        try {
            messages = this._parser.push(chunk);
        }
        catch (e) {
            this._drop();
            return;
        }

        for (const message of messages) {
            if (this._socket !== socket) return;
            this._receivedSincePing = true;
            this._onMessage(message);
        }
    }

    _onMessage({ tag, object }) {
        if (tag === TAGS.loginResponse) {
            clearTimeout(this._loginTimer);
            this._loginTimer = null;

            /* "Null if login was ok" (mcs.proto): a rejected login keeps the ids and backs off like any drop. */
            if (object && object.error) {
                const code = object.error.code !== undefined ? ` (code ${object.error.code})` : '';
                this._drop(`The MCS login was rejected${code}.`);
                return;
            }

            /* The ids went to the server with the login; it does not send these messages again. */
            this._persistentIds = new Set();
            this._retryCount = 0;
            this._startHeartbeat();
            this.emit('connect');
            this._settleLogin(null);
        }
        else if (tag === TAGS.close || tag === TAGS.streamErrorStanza) {
            /* The server ends the stream; waiting for the socket close would only delay the reconnect. */
            this._drop();
        }
        else if (tag === TAGS.heartbeatPing) {
            this._send(TAGS.heartbeatAck, 'HeartbeatAck', {});
        }
        else if (tag === TAGS.dataMessageStanza) {
            if (object.persistentId) {
                if (this._persistentIds.has(object.persistentId)) return;

                /* Kept to the newest MAX_PERSISTENT_IDS: a connection that lasts for weeks must not grow without end. */
                this._persistentIds.add(object.persistentId);
                if (this._persistentIds.size > MAX_PERSISTENT_IDS) {
                    this._persistentIds.delete(this._persistentIds.values().next().value);
                }
            }
            this.emit('ON_DATA_RECEIVED', object);
        }
    }

    _loginBuffer() {
        const LoginRequest = lookupType('LoginRequest');
        const hexAndroidId = Protobuf.util.Long.fromString(this._androidId).toString(16);
        const request = {
            adaptiveHeartbeat: false,
            authService: 2,
            authToken: this._securityToken,
            id: 'chrome-63.0.3234.0',
            domain: 'mcs.android.com',
            deviceId: `android-${hexAndroidId}`,
            networkType: 1,
            resource: this._androidId,
            user: this._androidId,
            useRmq2: true,
            setting: [{ name: 'new_vc', value: '1' }],
            clientEvent: [],
            receivedPersistentId: [...this._persistentIds],
        };

        const error = LoginRequest.verify(request);
        if (error) throw new Error(`Invalid MCS login request: ${error}`);

        return Buffer.concat([
            Buffer.from([MCS_VERSION, TAGS.loginRequest]),
            LoginRequest.encodeDelimited(LoginRequest.create(request)).finish(),
        ]);
    }

    /* A message after the login: tag, then the length-delimited protobuf (the version byte only starts the stream). */
    _send(tag, typeName, payload) {
        if (!this._socket) return;

        const Type = lookupType(typeName);
        this._socket.write(Buffer.concat([
            Buffer.from([tag]),
            Type.encodeDelimited(Type.create(payload)).finish(),
        ]));
    }

    _startHeartbeat() {
        clearInterval(this._heartbeatTimer);
        this._receivedSincePing = true;

        this._heartbeatTimer = setInterval(() => {
            if (!this._receivedSincePing) {
                this._drop();
                return;
            }

            this._receivedSincePing = false;
            this._send(TAGS.heartbeatPing, 'HeartbeatPing', {});
        }, HEARTBEAT_INTERVAL_MS);

        if (typeof this._heartbeatTimer.unref === 'function') this._heartbeatTimer.unref();
    }

    _drop(reason = 'The MCS connection closed before the login.') {
        this._teardown();
        if (this._destroyed) return;

        this.emit('disconnect');

        const seconds = Math.min(++this._retryCount, MAX_RETRY_SECONDS);
        this._retryTimeout = setTimeout(() => {
            /* this.connect may be wrapped by the caller; a failed check-in tries again later. */
            Promise.resolve()
                .then(() => this.connect())
                .catch(() => {
                    if (!this._destroyed && this._socket === null && this._retryTimeout === null) this._drop();
                });
        }, seconds * 1000);

        /* A connect() still waiting for its login fails; the retry above stays unless the caller destroys the client. */
        if (this._pendingLogin) {
            const error = new Error(reason);
            error.mcsLogin = true;
            this._settleLogin(error);
        }
    }

    _teardown() {
        clearTimeout(this._retryTimeout);
        this._retryTimeout = null;
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
        clearTimeout(this._loginTimer);
        this._loginTimer = null;

        const socket = this._socket;
        this._socket = null;
        this._parser = null;

        if (socket) {
            socket.removeAllListeners();
            socket.on('error', () => undefined);
            socket.destroy();
        }
    }
}

McsClient.HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
McsClient.LOGIN_TIMEOUT_MS = LOGIN_TIMEOUT_MS;
McsClient.MAX_PERSISTENT_IDS = MAX_PERSISTENT_IDS;

module.exports = McsClient;
