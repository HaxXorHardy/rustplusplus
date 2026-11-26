const Test = require('node:test');
const Assert = require('node:assert');
const EventEmitter = require('events');
const Path = require('path');
const Protobuf = require('protobufjs');

const AndroidFcm = require('../src/util/fcm/androidFcm.js');
const McsClient = require('../src/util/fcm/mcsClient.js');
const Fcm = require('../src/util/fcm/index.js');
const { McsParser, TAGS, MCS_VERSION, lookupType, readVarint32, encodeVarint32 } =
    require('../src/util/fcm/mcsParser.js');

const checkinRoot = Protobuf.loadSync(Path.join(__dirname, '..', 'src', 'util', 'fcm', 'proto', 'checkin.proto'));
const CheckinRequest = checkinRoot.lookupType('checkin_proto.AndroidCheckinRequest');
const CheckinResponse = checkinRoot.lookupType('checkin_proto.AndroidCheckinResponse');

const ANDROID_ID = '5017926461380829733';
const SECURITY_TOKEN = '12345678901234567890';

function frame(tag, typeName, payload) {
    const bytes = payload ? Buffer.from(lookupType(typeName).encode(lookupType(typeName).create(payload)).finish())
        : Buffer.alloc(0);
    return Buffer.concat([Buffer.from([tag]), encodeVarint32(bytes.length), bytes]);
}

function dataMessage(persistentId, appData = [{ key: 'title', value: 'Raid' }]) {
    return frame(TAGS.dataMessageStanza, 'DataMessageStanza', {
        from: '976529667804', category: 'com.facepunch.rust.companion', persistentId: persistentId, appData: appData,
    });
}

function loginResponse() {
    return frame(TAGS.loginResponse, 'LoginResponse', { id: 'chrome-63.0.3234.0' });
}

function checkinAnswer(androidId, securityToken) {
    const Long = Protobuf.util.Long;
    return Buffer.from(CheckinResponse.encode(CheckinResponse.create({
        statsOk: true,
        androidId: Long.fromString(androidId, true),
        securityToken: Long.fromString(securityToken, true),
    })).finish());
}

/* Google as a fake: records the requests, answers from a list (last answer repeats). */
function fakeHttp(answers) {
    const calls = [];
    return {
        calls: calls,
        post: async (url, body, options) => {
            calls.push({ url: url, body: body, options: options });
            const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
            if (answer instanceof Error) throw answer;
            return typeof answer === 'function' ? answer(url, body, options) : answer;
        },
    };
}

const noWait = { wait: async () => undefined };

Test.describe('fcm/mcsParser', () => {
    Test.it('reads and writes varint32 sizes', () => {
        for (const value of [0, 1, 127, 128, 300, 4096, 2 ** 28]) {
            const bytes = encodeVarint32(value);
            Assert.deepStrictEqual(readVarint32(bytes, 0), { value: value, length: bytes.length });
        }
        Assert.strictEqual(readVarint32(Buffer.from([0x80]), 0), null);
        Assert.throws(() => readVarint32(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), 0), /Invalid/);
    });

    Test.it('parses the version byte once, then messages split across chunks', () => {
        const stream = Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse(), dataMessage('0:1'),
            dataMessage('0:2')]);
        const parser = new McsParser();
        const messages = [];

        for (let i = 0; i < stream.length; i += 3) {
            messages.push(...parser.push(stream.subarray(i, i + 3)));
        }

        Assert.deepStrictEqual(messages.map((m) => m.tag),
            [TAGS.loginResponse, TAGS.dataMessageStanza, TAGS.dataMessageStanza]);
        Assert.strictEqual(messages[1].object.persistentId, '0:1');
        Assert.deepStrictEqual(messages[2].object.appData, [{ key: 'title', value: 'Raid' }]);
    });

    Test.it('handles empty messages (heartbeat) and a multi-byte size', () => {
        const longValue = 'x'.repeat(300);
        const stream = Buffer.concat([Buffer.from([MCS_VERSION]), Buffer.from([TAGS.heartbeatPing, 0]),
            dataMessage('0:3', [{ key: 'body', value: longValue }])]);

        const messages = new McsParser().push(stream);

        Assert.deepStrictEqual(messages[0], { tag: TAGS.heartbeatPing, object: {} });
        Assert.strictEqual(messages[1].object.appData[0].value, longValue);
    });

    Test.it('joins the chunks of a large message only once it is complete', (t) => {
        const longValue = 'y'.repeat(3000);
        const stream = Buffer.concat([Buffer.from([MCS_VERSION]), dataMessage('0:4', [{ key: 'body', value: longValue }]),
            Buffer.from([TAGS.heartbeatPing])]);
        const parser = new McsParser();
        const concat = t.mock.method(Buffer, 'concat');
        const messages = [];

        for (let i = 0; i < stream.length; i += 100) messages.push(...parser.push(stream.subarray(i, i + 100)));

        Assert.strictEqual(messages.length, 1);
        Assert.strictEqual(messages[0].object.appData[0].value, longValue);
        Assert.ok(concat.mock.callCount() <= 3, `Buffer.concat ran ${concat.mock.callCount()} times`);

        /* The started heartbeat waits for its size byte. */
        Assert.strictEqual(parser.length, 1);
        Assert.deepStrictEqual(parser.push(Buffer.from([0])), [{ tag: TAGS.heartbeatPing, object: {} }]);
    });

    Test.it('rejects an old version, an unknown tag and an oversized message', () => {
        Assert.throws(() => new McsParser().push(Buffer.from([30, TAGS.loginResponse, 0])), /version 30/);
        Assert.throws(() => new McsParser().push(Buffer.from([MCS_VERSION, 99, 0])), /Unknown MCS tag 99/);
        Assert.throws(() => new McsParser().push(Buffer.concat([Buffer.from([MCS_VERSION, TAGS.dataMessageStanza]),
            encodeVarint32(5 * 1024 * 1024)])), /too large/);
    });
});

Test.describe('fcm/androidFcm', () => {
    Test.it('encodes the check-in of a known device and decodes the answer', async () => {
        const http = fakeHttp([{ status: 200, data: checkinAnswer(ANDROID_ID, SECURITY_TOKEN) }]);

        const result = await AndroidFcm.checkIn(ANDROID_ID, SECURITY_TOKEN, { http: http });

        Assert.strictEqual(result.androidId, ANDROID_ID);
        Assert.strictEqual(result.securityToken, SECURITY_TOKEN);
        Assert.strictEqual(http.calls[0].url, 'https://android.clients.google.com/checkin');
        Assert.strictEqual(http.calls[0].options.responseType, 'arraybuffer');
        Assert.strictEqual(http.calls[0].options.headers['Content-Type'], 'application/x-protobuf');

        const sent = CheckinRequest.toObject(CheckinRequest.decode(http.calls[0].body), { longs: String });
        Assert.strictEqual(sent.id, ANDROID_ID);
        Assert.strictEqual(sent.securityToken, SECURITY_TOKEN);
        Assert.strictEqual(sent.version, 3);
        Assert.strictEqual(sent.checkin.chromeBuild.chromeVersion, '63.0.3234.0');
    });

    Test.it('creates a new device when called without ids', async () => {
        const http = fakeHttp([{ status: 200, data: checkinAnswer(ANDROID_ID, SECURITY_TOKEN) }]);
        await AndroidFcm.checkIn(undefined, undefined, { http: http });

        const sent = CheckinRequest.toObject(CheckinRequest.decode(http.calls[0].body), { longs: String });
        Assert.strictEqual(sent.id, undefined);
        Assert.strictEqual(sent.securityToken, undefined);
    });

    Test.it('tries network errors and 5xx again, but not more than three times', async () => {
        const http = fakeHttp([new Error('ECONNRESET'), { status: 503, data: Buffer.alloc(0) },
            { status: 200, data: checkinAnswer(ANDROID_ID, SECURITY_TOKEN) }]);
        Assert.strictEqual((await AndroidFcm.checkIn(ANDROID_ID, SECURITY_TOKEN,
            Object.assign({ http: http }, noWait))).androidId, ANDROID_ID);
        Assert.strictEqual(http.calls.length, 3);

        const failing = fakeHttp([new Error('ETIMEDOUT')]);
        await Assert.rejects(AndroidFcm.checkIn(ANDROID_ID, SECURITY_TOKEN, Object.assign({ http: failing }, noWait)),
            /ETIMEDOUT/);
        Assert.strictEqual(failing.calls.length, 3);
    });

    Test.it('does not try a 4xx again', async () => {
        const http = fakeHttp([{ status: 401, data: Buffer.alloc(0) }]);
        await Assert.rejects(AndroidFcm.checkIn(ANDROID_ID, SECURITY_TOKEN, Object.assign({ http: http }, noWait)),
            /HTTP 401/);
        Assert.strictEqual(http.calls.length, 1);
    });

    Test.it('registers a new device in three steps', async () => {
        const http = fakeHttp([(url) => {
            if (url.includes('firebaseinstallations')) return { status: 200, data: { authToken: { token: 'fis' } } };
            if (url.endsWith('/checkin')) return { status: 200, data: checkinAnswer(ANDROID_ID, SECURITY_TOKEN) };
            return { status: 200, data: 'token=fcm-token-1' };
        }]);

        const result = await AndroidFcm.register('api-key', 'rust-companion-app', '976529667804', '1:976:android:x',
            'com.facepunch.rust.companion', 'E28D05345FB78A7A1A63D70F4A302DBF426CA5AD', Object.assign({ http: http },
                noWait));

        Assert.deepStrictEqual(result, { gcm: { androidId: ANDROID_ID, securityToken: SECURITY_TOKEN },
            fcm: { token: 'fcm-token-1' } });

        const [install, checkin, register] = http.calls;
        Assert.strictEqual(install.url,
            'https://firebaseinstallations.googleapis.com/v1/projects/rust-companion-app/installations');
        Assert.strictEqual(install.options.headers['x-goog-api-key'], 'api-key');
        Assert.strictEqual(install.body.appId, '1:976:android:x');
        Assert.match(install.body.fid, /^[c-f][A-Za-z0-9+/]{22}$/);
        Assert.strictEqual(CheckinRequest.toObject(CheckinRequest.decode(checkin.body)).id, undefined);
        Assert.strictEqual(register.url, 'https://android.clients.google.com/c2dm/register3');
        Assert.strictEqual(register.options.headers.Authorization, `AidLogin ${ANDROID_ID}:${SECURITY_TOKEN}`);

        const form = new URLSearchParams(register.body);
        Assert.strictEqual(form.get('device'), ANDROID_ID);
        Assert.strictEqual(form.get('sender'), '976529667804');
        Assert.strictEqual(form.get('X-Goog-Firebase-Installations-Auth'), 'fis');
    });

    Test.it('repeats register3 on "Error=" and gives up after six answers', async () => {
        const answers = [{ status: 200, data: 'Error=PHONE_REGISTRATION_ERROR' }, { status: 200, data: 'token=t2' }];
        const http = fakeHttp(answers);
        Assert.strictEqual(await AndroidFcm.registerRequest(ANDROID_ID, SECURITY_TOKEN, 'fis', 's', 'a', 'p', 'c',
            Object.assign({ http: http }, noWait)), 't2');

        const failing = fakeHttp([{ status: 200, data: 'Error=PHONE_REGISTRATION_ERROR' }]);
        await Assert.rejects(AndroidFcm.registerRequest(ANDROID_ID, SECURITY_TOKEN, 'fis', 's', 'a', 'p', 'c',
            Object.assign({ http: failing }, noWait)), /PHONE_REGISTRATION_ERROR/);
        Assert.strictEqual(failing.calls.length, 6);
    });

    Test.it('fails when the installation has no auth token', async () => {
        const http = fakeHttp([{ status: 200, data: {} }]);
        await Assert.rejects(AndroidFcm.installRequest('k', 'p', 'a', 'pkg', 'cert', { http: http }), /no auth token/);
    });

    Test.it('generates Firebase installation ids with the 0b0111 header', () => {
        for (let i = 0; i < 50; i++) {
            const fid = AndroidFcm.generateFirebaseFid();
            Assert.strictEqual(Buffer.from(fid, 'base64')[0] >> 4, 0b0111);
            Assert.ok(!fid.includes('='));
        }
    });
});

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.written = [];
        this.destroyed = false;
        this.keepAlive = null;
    }
    setKeepAlive(enabled) { this.keepAlive = enabled; }
    write(buffer) { this.written.push(buffer); }
    destroy() { this.destroyed = true; }
}

function clientWithFakes(t, options = {}) {
    const sockets = [];
    const checkIns = [];
    const client = new McsClient(ANDROID_ID, SECURITY_TOKEN, options.persistentIds || ['0:old'], {
        checkIn: async (androidId, securityToken) => {
            checkIns.push([androidId, securityToken]);
            if (options.checkInError) throw new Error(options.checkInError);
        },
        connectSocket: (socketOptions) => {
            const socket = new FakeSocket();
            socket.options = socketOptions;
            sockets.push(socket);
            return socket;
        },
    });
    t.after(() => client.destroy());

    return { client: client, sockets: sockets, checkIns: checkIns };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/*
    connect() only settles with the login: starts it and waits until the socket is open. { result } ends with
    'connected' or the error.
*/
async function startConnect(client) {
    const result = client.connect().then(() => 'connected', (e) => e);
    await flush();
    return { result: result };
}

Test.describe('fcm/mcsClient', () => {
    Test.it('is what rustplusPush loads', () => {
        Assert.strictEqual(Fcm.Client, McsClient);
        Assert.strictEqual(Fcm.AndroidFCM.register, AndroidFcm.register);
    });

    Test.it('checks in, connects to mtalk and sends the login with the persistent ids', async (t) => {
        const { client, sockets, checkIns } = clientWithFakes(t);
        const events = [];
        client.on('connect', () => events.push('connect'));

        await startConnect(client);
        sockets[0].emit('secureConnect');
        /* TLS alone is not a connection: 'connect' waits for the accepted login. */
        Assert.deepStrictEqual(events, []);

        const login = sockets[0].written[0];
        sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse()]));

        Assert.deepStrictEqual(checkIns, [[ANDROID_ID, SECURITY_TOKEN]]);
        Assert.deepStrictEqual(sockets[0].options, { host: 'mtalk.google.com', port: 5228,
            servername: 'mtalk.google.com' });
        Assert.strictEqual(sockets[0].keepAlive, true);
        Assert.strictEqual(client._socket, sockets[0]);
        Assert.deepStrictEqual(events, ['connect']);

        Assert.deepStrictEqual([...login.subarray(0, 2)], [MCS_VERSION, TAGS.loginRequest]);
        const request = lookupType('LoginRequest').decodeDelimited(login.subarray(2));
        Assert.strictEqual(request.deviceId, `android-${BigInt(ANDROID_ID).toString(16)}`);
        Assert.strictEqual(request.authToken, SECURITY_TOKEN);
        Assert.strictEqual(request.user, ANDROID_ID);
        Assert.deepStrictEqual(request.receivedPersistentId, ['0:old']);
    });

    Test.it('emits each data message once', async (t) => {
        const { client, sockets } = clientWithFakes(t);
        const received = [];
        client.on('ON_DATA_RECEIVED', (data) => received.push(data));

        await startConnect(client);
        sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse(), dataMessage('0:1')]));
        sockets[0].emit('data', dataMessage('0:1'));
        sockets[0].emit('data', dataMessage('0:2'));

        Assert.deepStrictEqual(received.map((d) => d.persistentId), ['0:1', '0:2']);
        Assert.deepStrictEqual(received[0].appData, [{ key: 'title', value: 'Raid' }]);
    });

    Test.it('keeps only the newest persistent ids of a long connection', async (t) => {
        const { client, sockets } = clientWithFakes(t);
        const max = McsClient.MAX_PERSISTENT_IDS;

        await startConnect(client);
        sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse()]));
        for (let i = 0; i < max + 10; i++) sockets[0].emit('data', dataMessage(`0:${i}`));

        Assert.strictEqual(client._persistentIds.size, max);
        Assert.ok(!client._persistentIds.has('0:0'));
        Assert.ok(client._persistentIds.has(`0:${max + 9}`));
    });

    Test.it('reconnects after a drop and after a broken stream, and stops on destroy', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { client, sockets, checkIns } = clientWithFakes(t);
        const events = [];
        client.on('disconnect', () => events.push('disconnect'));

        await startConnect(client);
        sockets[0].emit('close');
        Assert.strictEqual(sockets[0].destroyed, true);
        Assert.deepStrictEqual(events, ['disconnect']);

        t.mock.timers.tick(1000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(checkIns.length, 2);
        Assert.strictEqual(sockets.length, 2);

        sockets[1].emit('data', Buffer.from([MCS_VERSION, 99, 0]));
        Assert.strictEqual(sockets[1].destroyed, true);
        Assert.deepStrictEqual(events, ['disconnect', 'disconnect']);

        client.destroy();
        t.mock.timers.tick(60000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(sockets.length, 2);
    });

    Test.it('backs off after a rejected login instead of retrying every second', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { client, sockets } = clientWithFakes(t);
        const events = [];
        client.on('connect', () => events.push('connect'));
        client.on('disconnect', () => events.push('disconnect'));
        const rejected = () => Buffer.concat([Buffer.from([MCS_VERSION]),
            frame(TAGS.loginResponse, 'LoginResponse', { id: 'x', error: { code: 401 } })]);

        await startConnect(client);
        sockets[0].emit('secureConnect');
        sockets[0].emit('data', rejected());
        Assert.deepStrictEqual(events, ['disconnect']);
        Assert.strictEqual(client._heartbeatTimer, null);
        /* The ids were not delivered by a rejected login. */
        Assert.deepStrictEqual([...client._persistentIds], ['0:old']);

        t.mock.timers.tick(1000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(sockets.length, 2);
        sockets[1].emit('secureConnect');
        sockets[1].emit('data', rejected());

        /* The second retry waits 2 s: TLS did not reset the backoff. */
        t.mock.timers.tick(1000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(sockets.length, 2);
        t.mock.timers.tick(1000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(sockets.length, 3);

        sockets[2].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse()]));
        Assert.deepStrictEqual(events, ['disconnect', 'disconnect', 'connect']);
        Assert.strictEqual(client._retryCount, 0);
        client.destroy();
    });

    Test.it('drops the connection on a stream error from the server', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { client, sockets } = clientWithFakes(t);
        const events = [];
        client.on('disconnect', () => events.push('disconnect'));

        await startConnect(client);
        sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse(),
            frame(TAGS.close, 'Close', {})]));
        Assert.deepStrictEqual(events, ['disconnect']);
        Assert.strictEqual(sockets[0].destroyed, true);
        client.destroy();
    });

    Test.it('rejects the first connect when the check-in fails', async (t) => {
        const { client, sockets } = clientWithFakes(t, { checkInError: 'HTTP 401' });
        await Assert.rejects(client.connect(), /HTTP 401/);
        Assert.strictEqual(sockets.length, 0);
    });

    Test.it('settles connect() with the login: accepted, rejected, timed out or destroyed', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

        const accepted = clientWithFakes(t);
        const first = await startConnect(accepted.client);
        accepted.sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse()]));
        Assert.strictEqual(await first.result, 'connected');

        const rejected = clientWithFakes(t);
        const second = await startConnect(rejected.client);
        rejected.sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]),
            frame(TAGS.loginResponse, 'LoginResponse', { id: 'x', error: { code: 401 } })]));
        const error = await second.result;
        Assert.strictEqual(error.mcsLogin, true);
        Assert.match(error.message, /rejected \(code 401\)/);

        const silent = clientWithFakes(t);
        const third = await startConnect(silent.client);
        t.mock.timers.tick(McsClient.LOGIN_TIMEOUT_MS);
        Assert.match((await third.result).message, /timed out/);

        const destroyed = clientWithFakes(t);
        const fourth = await startConnect(destroyed.client);
        destroyed.client.destroy();
        Assert.strictEqual(await fourth.result, 'connected');
        Assert.strictEqual(destroyed.sockets[0].destroyed, true);
    });

    Test.it('opens no socket when the login request cannot be built', async (t) => {
        const { client, sockets } = clientWithFakes(t);
        client._androidId = 'not-a-number';

        await Assert.rejects(client.connect());
        Assert.strictEqual(sockets.length, 0);
        Assert.strictEqual(client._socket, null);
    });

    Test.it('answers the pings of the server', async (t) => {
        const { client, sockets } = clientWithFakes(t);

        await startConnect(client);
        sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse(),
            frame(TAGS.heartbeatPing, 'HeartbeatPing', null)]));

        Assert.strictEqual(sockets[0].written.length, 2);
        Assert.deepStrictEqual([...sockets[0].written[1]], [TAGS.heartbeatAck, 0]);
    });

    Test.it('pings after the login and drops a connection that stopped answering', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
        const { client, sockets } = clientWithFakes(t);
        const events = [];
        client.on('disconnect', () => events.push('disconnect'));

        await startConnect(client);
        t.mock.timers.tick(McsClient.LOGIN_TIMEOUT_MS - 1);
        Assert.strictEqual(sockets[0].written.length, 1, 'no ping before the login');

        sockets[0].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse()]));
        t.mock.timers.tick(McsClient.HEARTBEAT_INTERVAL_MS);
        Assert.deepStrictEqual([...sockets[0].written[1]], [TAGS.heartbeatPing, 0]);

        /* Answered: the next ping goes out, the connection stays. */
        sockets[0].emit('data', frame(TAGS.heartbeatAck, 'HeartbeatAck', null));
        t.mock.timers.tick(McsClient.HEARTBEAT_INTERVAL_MS);
        Assert.strictEqual(sockets[0].written.length, 3);
        Assert.deepStrictEqual(events, []);

        /* Not answered: dropped at the next ping, and it reconnects. */
        t.mock.timers.tick(McsClient.HEARTBEAT_INTERVAL_MS);
        Assert.strictEqual(sockets[0].destroyed, true);
        Assert.strictEqual(sockets[0].written.length, 3);
        Assert.deepStrictEqual(events, ['disconnect']);

        t.mock.timers.tick(1000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(sockets.length, 2);
    });

    Test.it('drops a connection that never answers the login, and keeps one that did', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
        const { client, sockets } = clientWithFakes(t);
        const events = [];
        client.on('disconnect', () => events.push('disconnect'));

        await startConnect(client);
        t.mock.timers.tick(McsClient.LOGIN_TIMEOUT_MS - 1);
        Assert.deepStrictEqual(events, []);

        t.mock.timers.tick(1);
        Assert.strictEqual(sockets[0].destroyed, true);
        Assert.deepStrictEqual(events, ['disconnect']);

        t.mock.timers.tick(1000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(sockets.length, 2);

        /* Answered in time: the login timer is gone. */
        sockets[1].emit('data', Buffer.concat([Buffer.from([MCS_VERSION]), loginResponse()]));
        t.mock.timers.tick(McsClient.LOGIN_TIMEOUT_MS * 2);
        Assert.strictEqual(sockets[1].destroyed, false);
        Assert.deepStrictEqual(events, ['disconnect']);

        client.destroy();
    });

    Test.it('keeps retrying when a reconnect check-in fails', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const options = {};
        const { client, sockets, checkIns } = clientWithFakes(t, options);

        await startConnect(client);
        options.checkInError = 'offline';
        sockets[0].emit('close');

        t.mock.timers.tick(1000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(checkIns.length, 2);

        delete options.checkInError;
        t.mock.timers.tick(2000);
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(checkIns.length, 3);
        Assert.strictEqual(sockets.length, 2);
    });
});
