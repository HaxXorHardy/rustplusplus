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
    One push listener per stored Rust+ login (not per guild: the notifications belong to the account, every guild of
    the account gets them - see util/rustplusPushNotifications.js).

    - start() registers every login (util/rustplusPush.js) and connects to FCM,
    - a new account token (renewal, /credentials login) registers the account with Facepunch again,
    - an hourly check renews registrations that expire and retries accounts whose registration failed,
    - everything is optional: a failure is logged and the bot keeps running on the notification history.
*/

const Config = require('../../config');
const RustPlusAuth = require('./rustplusAuth.js');
const RustPlusPush = require('./rustplusPush.js');
const RustPlusPushNotifications = require('./rustplusPushNotifications.js');
const TokenRecovery = require('./tokenRecovery.js');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/* A device whose FCM connection keeps failing is registered again (Google may have dropped it). */
const MAX_CONNECT_FAILURES = 3;

/*
    The receiver reconnects by itself after a dropped socket (1 s, 2 s, ... up to 15 s). Two cases it does not cover:
    a reconnect whose check-in at Google fails (the promise rejects inside its timer, the retries end) and a connection
    that died without a close (router reset: only the TCP keepalive notices, by default after two hours). The watchdog
    starts a connection again that has been down this long, and keeps trying at the same pace until it is back.
*/
const WATCHDOG_INTERVAL_MS = 60 * 1000;
const RESTART_AFTER_DOWN_MS = 5 * 60 * 1000;

/* Probe an idle connection after a minute instead of the OS default of two hours (Linux: then 9 probes, 75 s apart). */
const KEEPALIVE_IDLE_MS = 60 * 1000;

const listeners = new Map();    /* steamId -> { receiver, androidId, state: { downSince } } */
const restarts = new Map();     /* steamId -> time of the next attempt after a watchdog restart failed */
const starting = new Map();     /* steamId -> promise of a running startAccount() */
const connectFailures = new Map();
let checkTimer = null;
let watchdogTimer = null;
let unsubscribe = null;

function errorText(e) {
    return e && e.message ? e.message : `${e}`;
}

function isListening(steamId) {
    return listeners.has(`${steamId}`);
}

/* For /status: null when the account has no listener, else whether its FCM connection is up. */
function connectionState(steamId) {
    const entry = listeners.get(`${steamId}`);
    if (!entry) return null;

    return { up: !entry.state || entry.state.downSince === null, downSince: entry.state ? entry.state.downSince : null };
}

function stopAccount(steamId) {
    const entry = listeners.get(`${steamId}`);
    if (!entry) return;

    listeners.delete(`${steamId}`);

    try {
        entry.receiver.destroy();
    }
    catch (e) {
        /* Already closed. */
    }
}

async function onData(client, steamId, data, deps) {
    const notification = RustPlusPushNotifications.parse(data);
    if (notification === null) return;

    /* Firebase redelivers what was not acknowledged before a reconnect or a restart. */
    if (!RustPlusPush.markPersistentId(steamId, notification.persistentId)) return;

    try {
        await RustPlusPushNotifications.handle(client, steamId, notification, deps);
    }
    catch (e) {
        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: a notification of ${steamId} could not be handled: ${errorText(e)}`, 'warn');
    }
}

function secondsSince(ms) {
    return Math.round((Date.now() - ms) / 1000);
}

/*
    Logs drops and returns, tunes the keepalive and catches the reconnects of the receiver. Returns the state the
    watchdog reads: downSince is set while the connection is down.
*/
function watchConnection(client, steamId, receiver) {
    const state = { started: false, downSince: null };

    receiver.on('connect', () => {
        /* _socket is internal to the FCM client: only used when it looks as expected. */
        try {
            const socket = receiver._socket;
            if (socket && typeof socket.setKeepAlive === 'function') socket.setKeepAlive(true, KEEPALIVE_IDLE_MS);
        }
        catch (e) {
            /* The default keepalive stays. */
        }

        if (state.downSince !== null) {
            client.log(client.intlGet(null, 'infoCap'),
                `Rust+ push: the FCM connection of ${steamId} is back after ${secondsSince(state.downSince)} s.`);
        }
        state.downSince = null;
    });

    receiver.on('disconnect', () => {
        if (state.downSince !== null) return;

        state.downSince = Date.now();
        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: the FCM connection of ${steamId} dropped, it reconnects.`, 'warn');
    });

    /*
        The receiver calls connect() again from a timer after a drop. A failed check-in rejected there unhandled and
        ended the retries: caught now, the watchdog takes over. The first connect still throws to doStartAccount.
    */
    const connect = receiver.connect.bind(receiver);
    receiver.connect = () => connect().catch((e) => {
        if (!state.started) throw e;

        if (state.downSince === null) state.downSince = Date.now();
        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: reconnecting ${steamId} failed (${errorText(e)}), the watchdog starts it again.`, 'warn');
    });

    return state;
}

/* Start what has been down too long again, and retry the restarts that failed. deps.now for tests. */
async function checkConnections(client, deps = {}) {
    const now = deps.now ? deps.now() : Date.now();

    for (const [steamId, entry] of [...listeners.entries()]) {
        const downSince = entry.state ? entry.state.downSince : null;
        if (downSince === null || (now - downSince) < RESTART_AFTER_DOWN_MS) continue;

        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: the FCM connection of ${steamId} is down for ${Math.round((now - downSince) / 1000)} s, ` +
            'it is started again.', 'warn');

        stopAccount(steamId);
        restarts.set(steamId, now);
    }

    for (const [steamId, nextAttempt] of [...restarts.entries()]) {
        /* The hourly check or a new token started it meanwhile. */
        if (isListening(steamId)) {
            restarts.delete(steamId);
            continue;
        }
        if (nextAttempt > now) continue;

        const started = await startAccount(client, steamId, deps);
        if (started) restarts.delete(steamId);
        else restarts.set(steamId, now + RESTART_AFTER_DOWN_MS);
    }
}

async function doStartAccount(client, steamId, deps) {
    const log = (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug');

    let result = null;

    try {
        result = await RustPlusPush.ensureRegistered(steamId, Object.assign({ log: log }, deps));
    }
    catch (e) {
        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: ${steamId} could not be registered for push notifications (${errorText(e)}). ` +
            'Raid alarms and team logins of other servers are not reported, the rest keeps working. ' +
            'The next attempt is in an hour.', 'warn');
        return false;
    }

    if (result.registered) {
        client.log(client.intlGet(null, 'infoCap'), `Rust+ push: ${steamId} is registered with Facepunch.`);
    }

    const fcm = result.push.fcm;
    const running = listeners.get(`${steamId}`);

    /* The device did not change, only its registration with Facepunch: the connection to FCM stays. */
    if (running && running.androidId === fcm.androidId) return true;

    stopAccount(steamId);

    const pushReceiver = deps.pushReceiver || RustPlusPush.loadPushReceiver();
    const receiver = new pushReceiver.Client(fcm.androidId, fcm.securityToken,
        RustPlusPush.getPersistentIds(steamId));

    receiver.on('ON_DATA_RECEIVED', (data) => {
        onData(client, steamId, data, deps).catch(() => undefined);
    });

    const state = watchConnection(client, steamId, receiver);

    try {
        await receiver.connect();
        state.started = true;
    }
    catch (e) {
        const failures = (connectFailures.get(`${steamId}`) || 0) + 1;
        connectFailures.set(`${steamId}`, failures);

        try {
            receiver.destroy();
        }
        catch (destroyError) {
            /* Never connected. */
        }

        client.log(client.intlGet(null, 'warningCap'),
            `Rust+ push: the FCM connection of ${steamId} failed (${errorText(e)}, ${failures}/` +
            `${MAX_CONNECT_FAILURES}).`, 'warn');

        if (failures >= MAX_CONNECT_FAILURES) {
            /* Google does not know the device anymore: the next attempt registers a new one. */
            const push = RustPlusPush.readPush(steamId);
            if (push) {
                push.fcm = null;
                RustPlusPush.writePush(steamId, push);
            }
            connectFailures.delete(`${steamId}`);
        }

        return false;
    }

    connectFailures.delete(`${steamId}`);
    listeners.set(`${steamId}`, { receiver: receiver, androidId: fcm.androidId, state: state });

    client.log(client.intlGet(null, 'infoCap'), `Rust+ push: listening for the notifications of ${steamId}.`);

    return true;
}

/* Register (if needed) and listen. Concurrent calls for the same account share one run. */
function startAccount(client, steamId, deps = {}) {
    if (!Config.general.pushEnabled) return Promise.resolve(false);

    const key = `${steamId}`;
    if (starting.has(key)) return starting.get(key);

    const run = doStartAccount(client, key, deps).finally(() => starting.delete(key));
    starting.set(key, run);

    return run;
}

/* Every stored login: start what is missing, renew registrations that are due. */
async function checkAll(client, deps = {}) {
    const steamIds = RustPlusAuth.listSteamIds();

    for (const steamId of steamIds) {
        await startAccount(client, steamId, deps);
    }

    /* A login that was removed. */
    for (const steamId of [...listeners.keys()]) {
        if (!steamIds.includes(steamId)) stopAccount(steamId);
    }
}

async function start(client, deps = {}) {
    stop();

    if (!Config.general.pushEnabled) {
        client.log(client.intlGet(null, 'infoCap'),
            'Rust+ push notifications are turned off (RPP_PUSH_ENABLED=false), only the history is read.');
        return;
    }

    /* A new account token needs a new registration with Facepunch, the old one points at the replaced token. */
    unsubscribe = TokenRecovery.onTokenChanged((steamId) => {
        startAccount(client, steamId, deps).catch(() => undefined);
    });

    checkTimer = setInterval(() => {
        checkAll(client, deps).catch(() => undefined);
    }, CHECK_INTERVAL_MS);

    if (typeof checkTimer.unref === 'function') checkTimer.unref();

    watchdogTimer = setInterval(() => {
        checkConnections(client, deps).catch(() => undefined);
    }, WATCHDOG_INTERVAL_MS);

    if (typeof watchdogTimer.unref === 'function') watchdogTimer.unref();

    await checkAll(client, deps);
}

function stop() {
    if (checkTimer !== null) {
        clearInterval(checkTimer);
        checkTimer = null;
    }

    if (watchdogTimer !== null) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
    }

    if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
    }

    for (const steamId of [...listeners.keys()]) stopAccount(steamId);

    connectFailures.clear();
    restarts.clear();
}

module.exports = {
    CHECK_INTERVAL_MS: CHECK_INTERVAL_MS,
    MAX_CONNECT_FAILURES: MAX_CONNECT_FAILURES,
    RESTART_AFTER_DOWN_MS: RESTART_AFTER_DOWN_MS,
    KEEPALIVE_IDLE_MS: KEEPALIVE_IDLE_MS,
    isListening: isListening,
    connectionState: connectionState,
    checkConnections: checkConnections,
    startAccount: startAccount,
    stopAccount: stopAccount,
    checkAll: checkAll,
    start: start,
    stop: stop,
};
