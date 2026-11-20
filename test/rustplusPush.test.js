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
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Test = require('node:test');

const RustPlusAuth = require('../src/util/rustplusAuth.js');
const RustPlusPush = require('../src/util/rustplusPush.js');
const RustPlusPushNotifications = require('../src/util/rustplusPushNotifications.js');
const RustPlusPushListener = require('../src/util/rustplusPushListener.js');
const TokenRecovery = require('../src/util/tokenRecovery.js');

const STEAM_ID = '76561198000000400';
const SERVER_ID = '06b8fbcf-3eed-45fc-9678-66a3b5b35973';

/* A token whose payload carries an expiry, like the ones of Facepunch. */
function jwt(exp) {
    return `${Buffer.from(JSON.stringify({ exp: exp })).toString('base64')}.signature`;
}

function useTempPushDir(t) {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rustplus-push-'));
    RustPlusPush.setPushDir(dir);

    t.after(() => {
        Fs.rmSync(dir, { recursive: true, force: true });
    });

    return dir;
}

function stubAuth(t, auth) {
    const original = RustPlusAuth.readAuth;
    RustPlusAuth.readAuth = () => auth;
    t.after(() => { RustPlusAuth.readAuth = original; });
}

/* Google, Expo and Facepunch as fakes that record what they were asked. */
function fakeServices(options = {}) {
    const calls = { fcm: 0, expo: [], facepunch: [] };

    return {
        calls: calls,
        pushReceiver: {
            AndroidFCM: {
                register: async () => {
                    calls.fcm += 1;
                    return { gcm: { androidId: `android-${calls.fcm}`, securityToken: 'secret' },
                        fcm: { token: 'fcm-token' } };
                },
            },
        },
        http: {
            post: async (url, body) => {
                if (url.includes('exp.host')) {
                    calls.expo.push(body);

                    /* Like the real Expo (verified live): only a bare UUID is a valid device id. */
                    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.deviceId)) {
                        return { status: 400, data: { errors: [{ code: 'VALIDATION_ERROR',
                            message: '"deviceId": Invalid UUID.' }] } };
                    }

                    return { status: 200, data: { data: { expoPushToken: 'ExponentPushToken[abc]' } } };
                }

                calls.facepunch.push(body);
                if (options.facepunchStatus && options.facepunchStatus !== 200) {
                    return { status: options.facepunchStatus, data: {} };
                }

                return { status: 200, data: { token: jwt(options.registrationExpiry || 2_000_000_000) } };
            },
        },
    };
}

Test.describe('RustPlusPush.ensureRegistered', () => {
    Test.it('runs the three steps once and stores the device', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'account-token' });

        const services = fakeServices();
        const result = await RustPlusPush.ensureRegistered(STEAM_ID, services);

        Assert.strictEqual(result.registered, true);
        Assert.strictEqual(services.calls.fcm, 1);
        Assert.strictEqual(services.calls.expo[0].deviceToken, 'fcm-token');
        Assert.strictEqual(services.calls.expo[0].appId, 'com.facepunch.rust.companion');
        Assert.deepStrictEqual(services.calls.facepunch, [{
            AuthToken: 'account-token',
            DeviceId: result.push.deviceId,
            PushKind: 3,
            PushToken: 'ExponentPushToken[abc]',
        }]);

        const stored = RustPlusPush.readPush(STEAM_ID);
        Assert.strictEqual(stored.fcm.androidId, 'android-1');
        Assert.strictEqual(stored.registration.expiresAt, 2_000_000_000);
        Assert.ok(!JSON.stringify(stored).includes('account-token'), 'the account token is not copied');

        /* Nothing is due on the next check. */
        const again = await RustPlusPush.ensureRegistered(STEAM_ID, services);
        Assert.strictEqual(again.registered, false);
        Assert.strictEqual(services.calls.fcm, 1);
        Assert.strictEqual(services.calls.facepunch.length, 1);
    });

    Test.it('registers again with Facepunch after the account token changed, the device stays', async (t) => {
        useTempPushDir(t);
        const auth = { steamId: STEAM_ID, token: 'old-token' };
        stubAuth(t, auth);

        const services = fakeServices();
        const first = await RustPlusPush.ensureRegistered(STEAM_ID, services);

        auth.token = 'new-token';
        const second = await RustPlusPush.ensureRegistered(STEAM_ID, services);

        Assert.strictEqual(second.registered, true);
        Assert.strictEqual(services.calls.fcm, 1);
        Assert.strictEqual(services.calls.facepunch[1].AuthToken, 'new-token');
        Assert.strictEqual(services.calls.facepunch[1].DeviceId, first.push.deviceId);
    });

    Test.it('renews a registration that expires within a day', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });

        const soon = Math.floor(Date.now() / 1000) + 3600;
        const services = fakeServices({ registrationExpiry: soon });

        await RustPlusPush.ensureRegistered(STEAM_ID, services);
        const again = await RustPlusPush.ensureRegistered(STEAM_ID, services);

        Assert.strictEqual(again.registered, true);
    });

    Test.it('keeps the FCM device when Facepunch refuses the registration', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });

        const services = fakeServices({ facepunchStatus: 403 });

        await Assert.rejects(RustPlusPush.ensureRegistered(STEAM_ID, services), /status 403/);

        const stored = RustPlusPush.readPush(STEAM_ID);
        Assert.strictEqual(stored.fcm.androidId, 'android-1');
        Assert.strictEqual(stored.expoPushToken, 'ExponentPushToken[abc]');
        Assert.strictEqual(stored.registration, null);
    });

    Test.it('replaces the prefixed device id of 1.42.0 and keeps the FCM device', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });

        RustPlusPush.writePush(STEAM_ID, {
            deviceId: 'rustplusplus:6f1c2a4e-1111-4222-8333-944455556666',
            fcm: { androidId: 'android-old', securityToken: 'secret', fcmToken: 'fcm-old' },
            expoPushToken: null,
        });

        const services = fakeServices();
        const result = await RustPlusPush.ensureRegistered(STEAM_ID, services);

        Assert.strictEqual(result.registered, true);
        Assert.match(result.push.deviceId, /^[0-9a-f-]{36}$/);
        Assert.strictEqual(services.calls.fcm, 0, 'the stored Google device is reused');
        Assert.strictEqual(services.calls.expo[0].deviceToken, 'fcm-old');
    });

    Test.it('keeps the new FCM device and names the reason when Expo refuses', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });

        const services = fakeServices();
        const original = services.http.post;
        services.http.post = async (url, body) => url.includes('exp.host') ?
            { status: 400, data: { errors: [{ message: 'something is off' }] } } : original(url, body);

        await Assert.rejects(RustPlusPush.ensureRegistered(STEAM_ID, services), /status 400 \(something is off\)/);
        await Assert.rejects(RustPlusPush.ensureRegistered(STEAM_ID, services), /status 400/);

        Assert.strictEqual(services.calls.fcm, 1, 'no second Google device for the retry');
        Assert.strictEqual(RustPlusPush.readPush(STEAM_ID).fcm.androidId, 'android-1');
    });

    Test.it('remembers handled notification ids', (t) => {
        useTempPushDir(t);
        RustPlusPush.writePush(STEAM_ID, { deviceId: 'd' });

        Assert.strictEqual(RustPlusPush.markPersistentId(STEAM_ID, 'id-1'), true);
        Assert.strictEqual(RustPlusPush.markPersistentId(STEAM_ID, 'id-1'), false);
        Assert.deepStrictEqual(RustPlusPush.getPersistentIds(STEAM_ID), ['id-1']);
    });
});

/* A notification as the FCM client (src/util/fcm) delivers it. */
function notification(channelId, title, message, body, persistentId = 'p-1') {
    return {
        persistentId: persistentId,
        appData: [
            { key: 'channelId', value: channelId },
            { key: 'title', value: title },
            { key: 'message', value: message },
            { key: 'body', value: JSON.stringify(body) },
        ],
    };
}

function fakeClient(instance, rustplus = null) {
    const client = {
        logs: [],
        saved: 0,
        instances: { guild: {} },
        rustplusInstances: rustplus ? { guild: rustplus } : {},
        intlGet: (guildId, key) => key,
        log: (cap, text) => client.logs.push(text),
        getInstance: () => instance,
        setInstance: () => { client.saved += 1; },
    };

    return client;
}

function serverInstance() {
    return {
        activeServer: `relay-${SERVER_ID}`,
        channelId: { activity: 'activity-channel' },
        serverList: {
            [`relay-${SERVER_ID}`]: {
                title: "Captain's Quarters",
                guid: SERVER_ID,
                steamId: STEAM_ID,
                alarms: { 123: { name: 'Base', message: 'raid', lastTrigger: null } },
            },
        },
    };
}

Test.describe('RustPlusPushNotifications', () => {
    Test.it('reads the fields of a notification', () => {
        const parsed = RustPlusPushNotifications.parse(notification('alarm', 'You\'re getting raided!', 'msg',
            { id: SERVER_ID, name: 'Server' }));

        Assert.strictEqual(parsed.channelId, 'alarm');
        Assert.strictEqual(parsed.body.id, SERVER_ID);
        Assert.strictEqual(RustPlusPushNotifications.classify(parsed), 'raidAlarm');
    });

    Test.it('tells the kinds apart', () => {
        const kind = (channelId, title, body) =>
            RustPlusPushNotifications.classify(RustPlusPushNotifications.parse(notification(channelId, title, '', body)));

        Assert.strictEqual(kind('alarm', 'Base', { type: 'alarm', entityId: 1 }), 'smartAlarm');
        Assert.strictEqual(kind('team', 'Bob is online', { type: 'login' }), 'teamLogin');
        Assert.strictEqual(kind('pairing', 'Server', { type: 'server' }), 'pairing');
        Assert.strictEqual(kind('player', 'You were killed', { type: 'death' }), 'death');
        Assert.strictEqual(kind('news', 'News', { type: 'news' }), 'other');
    });

    Test.it('finds the server by its pairing id', () => {
        Assert.strictEqual(RustPlusPushNotifications.findServerKey(serverInstance(), { id: SERVER_ID }),
            `relay-${SERVER_ID}`);
        Assert.strictEqual(RustPlusPushNotifications.findServerKey(serverInstance(), { id: 'other' }), null);
    });

    Test.it('applies a pairing straight from the push, without waiting', async () => {
        const client = fakeClient(serverInstance());
        const runs = [];
        const scheduled = [];

        client.refreshPairingHistory = async (options) => { runs.push(options); };

        const body = { type: 'entity', id: SERVER_ID, playerToken: '-123', entityId: '456', entityType: '1',
            entityName: 'Smart Switch' };
        await RustPlusPushNotifications.handle(client, STEAM_ID,
            RustPlusPushNotifications.parse(notification('pairing', 'Server', '', body)),
            { schedule: (fn) => scheduled.push(fn) });

        Assert.strictEqual(scheduled.length, 0);
        Assert.deepStrictEqual(runs, [{ pushPairing: { steamId: STEAM_ID, body: body } }]);
    });

    Test.it('reads the history when the pairing push carries no pairing data', async () => {
        const client = fakeClient(serverInstance());
        const runs = [];

        client.refreshPairingHistory = async (options) => { runs.push(options); };

        await RustPlusPushNotifications.handle(client, STEAM_ID,
            RustPlusPushNotifications.parse(notification('pairing', 'Server', '', { type: 'entity', id: SERVER_ID })),
            { schedule: (fn) => fn() });

        Assert.deepStrictEqual(runs, [{ steamIds: [STEAM_ID], freshAccountState: true }]);
    });

    Test.it('leaves smart alarms and team logins of the connected server to the socket', async () => {
        const instance = serverInstance();
        const client = fakeClient(instance, { serverId: `relay-${SERVER_ID}`, isOperational: true });

        const alarm = await RustPlusPushNotifications.handle(client, STEAM_ID, RustPlusPushNotifications.parse(
            notification('alarm', 'Base', 'raid', { type: 'alarm', id: SERVER_ID, entityId: 123 })));
        const login = await RustPlusPushNotifications.handle(client, STEAM_ID, RustPlusPushNotifications.parse(
            notification('team', 'Bob', '', { type: 'login', id: SERVER_ID, targetId: '' })));

        Assert.strictEqual(alarm[0].handled, false);
        Assert.strictEqual(login[0].handled, false);
        Assert.strictEqual(instance.serverList[`relay-${SERVER_ID}`].alarms[123].lastTrigger, null);
    });

    Test.it('ignores a notification of a server the guild does not know', async () => {
        const client = fakeClient(serverInstance());

        const result = await RustPlusPushNotifications.handle(client, STEAM_ID, RustPlusPushNotifications.parse(
            notification('alarm', 'You\'re getting raided!', 'x', { id: 'unknown-server' })));

        Assert.deepStrictEqual(result, [{ kind: 'raidAlarm', guildId: 'guild', handled: false }]);
    });

    Test.it('logs a notification it does not know in full', async () => {
        const client = fakeClient(serverInstance());

        await RustPlusPushNotifications.handle(client, STEAM_ID, RustPlusPushNotifications.parse(
            notification('news', 'Devblog', 'text', { type: 'news', url: 'https://rust.facepunch.com' })));

        Assert.ok(client.logs.some((text) => text.includes('unhandled notification') && text.includes('Devblog')));
    });
});

Test.describe('RustPlusPushListener', () => {
    function fakeReceiverModule(options = {}) {
        const receivers = [];

        class Client {
            constructor(androidId, securityToken, persistentIds) {
                this.androidId = androidId;
                this.persistentIds = persistentIds;
                this.handlers = {};
                this.destroyed = false;
                receivers.push(this);
            }
            on(event, handler) { this.handlers[event] = handler; }
            async connect() { if (options.connectError) throw new Error(options.connectError); }
            destroy() { this.destroyed = true; }
        }

        return { receivers: receivers, Client: Client };
    }

    Test.it('registers, connects and hands notifications to the handler once', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });
        t.after(() => RustPlusPushListener.stop());

        const services = fakeServices();
        const module_ = fakeReceiverModule();
        services.pushReceiver.Client = module_.Client;

        const client = fakeClient(serverInstance());
        const runs = [];
        client.refreshPairingHistory = async (options) => { runs.push(options); };

        Assert.strictEqual(await RustPlusPushListener.startAccount(client, STEAM_ID,
            Object.assign({ schedule: (fn) => fn() }, services)), true);
        Assert.strictEqual(RustPlusPushListener.isListening(STEAM_ID), true);

        const data = notification('pairing', 'Server', '', { type: 'server', id: SERVER_ID }, 'n-1');
        module_.receivers[0].handlers.ON_DATA_RECEIVED(data);
        module_.receivers[0].handlers.ON_DATA_RECEIVED(data);   /* redelivered */
        await new Promise((resolve) => setImmediate(resolve));

        Assert.strictEqual(runs.length, 1);
    });

    Test.it('keeps the FCM connection when only the account token changed', async (t) => {
        useTempPushDir(t);
        const auth = { steamId: STEAM_ID, token: 'old' };
        stubAuth(t, auth);
        t.after(() => RustPlusPushListener.stop());

        const services = fakeServices();
        const module_ = fakeReceiverModule();
        services.pushReceiver.Client = module_.Client;

        const client = fakeClient(serverInstance());

        await RustPlusPushListener.startAccount(client, STEAM_ID, services);
        auth.token = 'new';
        await RustPlusPushListener.startAccount(client, STEAM_ID, services);

        Assert.strictEqual(module_.receivers.length, 1);
        Assert.strictEqual(services.calls.facepunch.length, 2);
    });

    Test.it('registers a new device after repeated connection failures', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });
        t.after(() => RustPlusPushListener.stop());

        const services = fakeServices();
        services.pushReceiver.Client = fakeReceiverModule({ connectError: 'auth failed' }).Client;

        const client = fakeClient(serverInstance());

        for (let i = 0; i < RustPlusPushListener.MAX_CONNECT_FAILURES; i++) {
            Assert.strictEqual(await RustPlusPushListener.startAccount(client, STEAM_ID, services), false);
        }

        Assert.strictEqual(RustPlusPush.readPush(STEAM_ID).fcm, null);

        await RustPlusPushListener.startAccount(client, STEAM_ID, services);
        Assert.strictEqual(services.calls.fcm, 2);
    });

    Test.it('logs a drop and the return, and tunes the keepalive', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });
        t.after(() => RustPlusPushListener.stop());

        const services = fakeServices();
        const module_ = fakeReceiverModule();
        services.pushReceiver.Client = module_.Client;
        const client = fakeClient(serverInstance());

        await RustPlusPushListener.startAccount(client, STEAM_ID, services);
        const receiver = module_.receivers[0];

        const keepAlive = [];
        receiver._socket = { setKeepAlive: (on, delay) => keepAlive.push([on, delay]) };
        receiver.handlers.connect();
        Assert.deepStrictEqual(keepAlive, [[true, RustPlusPushListener.KEEPALIVE_IDLE_MS]]);
        Assert.ok(!client.logs.some((text) => text.includes('is back')), 'the first connect is no return');

        receiver.handlers.disconnect();
        receiver.handlers.disconnect();
        receiver.handlers.connect();

        Assert.strictEqual(client.logs.filter((text) => text.includes('dropped, it reconnects')).length, 1);
        Assert.ok(client.logs.some((text) => text.includes('is back after')));
    });

    Test.it('catches a failed reconnect instead of rejecting unhandled', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });
        t.after(() => RustPlusPushListener.stop());

        const services = fakeServices();
        const options = {};
        const module_ = fakeReceiverModule(options);
        services.pushReceiver.Client = module_.Client;
        const client = fakeClient(serverInstance());

        await RustPlusPushListener.startAccount(client, STEAM_ID, services);

        /* What the receiver's retry timer does after a drop, with the check-in failing. */
        options.connectError = 'checkin failed';
        await Assert.doesNotReject(module_.receivers[0].connect());
        Assert.ok(client.logs.some((text) => text.includes('reconnecting') && text.includes('checkin failed')));
    });

    Test.it('the watchdog starts a connection again that is down too long, and retries a failed restart', async (t) => {
        useTempPushDir(t);
        stubAuth(t, { steamId: STEAM_ID, token: 'token' });
        t.after(() => RustPlusPushListener.stop());

        const services = fakeServices();
        const options = {};
        const module_ = fakeReceiverModule(options);
        services.pushReceiver.Client = module_.Client;
        const client = fakeClient(serverInstance());

        await RustPlusPushListener.startAccount(client, STEAM_ID, services);
        module_.receivers[0].handlers.disconnect();

        const start = Date.now();
        const limit = RustPlusPushListener.RESTART_AFTER_DOWN_MS;

        /* Down for a minute: the receiver's own retries get their chance. */
        await RustPlusPushListener.checkConnections(client, Object.assign({ now: () => start + 60 * 1000 }, services));
        Assert.strictEqual(module_.receivers.length, 1);

        /* Down past the limit, and Google does not answer: torn down, the restart fails. */
        options.connectError = 'offline';
        await RustPlusPushListener.checkConnections(client, Object.assign({ now: () => start + limit + 1 }, services));
        Assert.strictEqual(module_.receivers[0].destroyed, true);
        Assert.strictEqual(module_.receivers.length, 2);
        Assert.strictEqual(RustPlusPushListener.isListening(STEAM_ID), false);

        /* Not again before the next slot. */
        await RustPlusPushListener.checkConnections(client, Object.assign({ now: () => start + limit + 60 * 1000 }, services));
        Assert.strictEqual(module_.receivers.length, 2);

        /* Back online: the next slot connects. */
        options.connectError = null;
        await RustPlusPushListener.checkConnections(client, Object.assign({ now: () => start + 2 * limit + 2 }, services));
        Assert.strictEqual(module_.receivers.length, 3);
        Assert.strictEqual(RustPlusPushListener.isListening(STEAM_ID), true);
    });

    Test.it('a new account token reaches the subscribers', () => {
        const seen = [];
        const unsubscribe = TokenRecovery.onTokenChanged((steamId) => seen.push(steamId));

        TokenRecovery.notifyTokenChanged(STEAM_ID);
        unsubscribe();
        TokenRecovery.notifyTokenChanged(STEAM_ID);

        Assert.deepStrictEqual(seen, [STEAM_ID]);
    });
});
