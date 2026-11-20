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
    Registers the bot as a device of the Rust+ app, so Facepunch sends it the push notifications of the account (raid
    alarms, team logins, smart alarms, pairings). The same four steps the Rust+ app and the rustplusplus credential
    application do - only the first one needs a person, and the bot already did it with /credentials login:

    1. the Rust+ account token (Steam login, util/rustplusLogin.js),
    2. a registration with Google as an Android device of the Rust+ app -> android id, security token, FCM token,
    3. an Expo push token for that FCM token,
    4. POST /api/push/register: Facepunch sends the notifications of the account to that Expo token.

    The FCM credentials and the Expo token do not depend on the account token and are made once. Step 4 is repeated
    whenever the account token changes (a renewal) and before the registration expires.

    Stored per steam account in credentials/rustplusPush/<steamId>.json (the account token is not copied there, only a
    hash of it, to know whether the registration belongs to the current token).
*/

const Axios = require('axios');
const Crypto = require('crypto');
const Fs = require('fs');
const Path = require('path');

const AtomicWriteFile = require('./atomicWriteFile.js');
const RustPlusAuth = require('./rustplusAuth.js');
const RustPlusLoginPages = require('./rustplusLoginPages.js');
const RustPlusTransport = require('./rustplusTransport.js');

let PUSH_DIR = Path.join(__dirname, '..', '..', 'credentials', 'rustplusPush');

/* For tests: keep the files in a temporary directory. */
function setPushDir(dir) {
    PUSH_DIR = dir;
}

/* The Firebase project of the Rust+ Android app (public values of the app, the same in every client). */
const RUSTPLUS_FCM = {
    apiKey: 'AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY',
    projectId: 'rust-companion-app',
    gcmSenderId: '976529667804',
    gmsAppId: '1:976529667804:android:d6f1ddeb4403b338fea619',
    androidPackageName: 'com.facepunch.rust.companion',
    androidPackageCert: 'E28D05345FB78A7A1A63D70F4A302DBF426CA5AD',
};

const EXPO_PUSH_TOKEN_URL = 'https://exp.host/--/api/v2/push/getExpoPushToken';
const EXPO_PROJECT_ID = '49451aca-a822-41e6-ad59-955718d0ff9c';
const EXPO_APP_ID = 'com.facepunch.rust.companion';

const PUSH_REGISTER_URL = 'https://companion-rust.facepunch.com/api/push/register';
const PUSH_KIND_EXPO = 3;

/* The registration of step 4 is renewed this long before it expires. */
const REGISTRATION_RENEW_BEFORE_SECONDS = 24 * 3600;

/* The notification ids that were handled are remembered, Firebase redelivers unacknowledged ones on a reconnect. */
const MAX_PERSISTENT_IDS = 100;

function getPushFilePath(steamId) {
    return Path.join(PUSH_DIR, `${steamId}.json`);
}

function readPush(steamId) {
    try {
        const path = getPushFilePath(steamId);
        if (!Fs.existsSync(path)) return null;

        const data = JSON.parse(Fs.readFileSync(path, 'utf8'));

        return (data && typeof data === 'object') ? data : null;
    }
    catch (e) {
        return null;
    }
}

function writePush(steamId, data) {
    /* The security token is a credential: the file is not readable for other users of the host. */
    AtomicWriteFile(getPushFilePath(steamId), JSON.stringify(data, null, 2), 'utf8', 0o600);
}

function removePush(steamId) {
    try {
        Fs.unlinkSync(getPushFilePath(steamId));
    }
    catch (e) {
        /* Nothing stored. */
    }
}

/* A short fingerprint of the account token: tells whether the registration was made with the current token. */
function tokenHash(token) {
    return Crypto.createHash('sha256').update(`${token}`).digest('hex').slice(0, 16);
}

function isUuid(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function loadPushReceiver() {
    /* Loaded on first use: a bot without push (RPP_PUSH_ENABLED=false) does not need it. */
    return require('./fcm/index.js');
}

/* Step 2: an Android device of the Rust+ app at Google. */
async function registerFcm(pushReceiver = loadPushReceiver()) {
    const credentials = await pushReceiver.AndroidFCM.register(RUSTPLUS_FCM.apiKey, RUSTPLUS_FCM.projectId,
        RUSTPLUS_FCM.gcmSenderId, RUSTPLUS_FCM.gmsAppId, RUSTPLUS_FCM.androidPackageName,
        RUSTPLUS_FCM.androidPackageCert);

    if (!credentials || !credentials.gcm || !credentials.fcm || !credentials.fcm.token) {
        throw new Error('The FCM registration returned no credentials.');
    }

    return {
        androidId: `${credentials.gcm.androidId}`,
        securityToken: `${credentials.gcm.securityToken}`,
        fcmToken: `${credentials.fcm.token}`,
    };
}

/* Step 3: the Expo push token of that device. */
async function fetchExpoPushToken(deviceId, fcmToken, http = Axios) {
    const response = await http.post(EXPO_PUSH_TOKEN_URL, {
        type: 'fcm',
        deviceId: deviceId,
        development: false,
        appId: EXPO_APP_ID,
        deviceToken: fcmToken,
        projectId: EXPO_PROJECT_ID,
    }, {
        timeout: 30000,
        validateStatus: () => true,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
    });

    const token = response && response.data && response.data.data ? response.data.data.expoPushToken : null;

    if (response.status !== 200 || typeof token !== 'string' || token === '') {
        /* Expo names the problem ({ errors: [{ message }] }), the status alone did not tell a wrong id apart. */
        const errors = response && response.data && Array.isArray(response.data.errors) ? response.data.errors : [];
        const detail = errors.map((e) => e && e.message).filter(Boolean).join('; ');
        const error = new Error(`The Expo push token request failed with status ${response.status}` +
            `${detail ? ` (${detail})` : ''}.`);
        error.status = response.status;
        throw error;
    }

    return token;
}

/*
    Step 4: Facepunch sends the notifications of the account to the Expo token. A registration with the same device id
    replaces the previous one, so the device id stays the same for the lifetime of the push file.

    The answer carries a token as well. Only its expiry is used - it is the lifetime of the registration, the account
    token of the bot stays the one of the Steam login.
*/
async function registerWithFacepunch(authToken, deviceId, expoPushToken, http = Axios) {
    const response = await http.post(PUSH_REGISTER_URL, {
        AuthToken: authToken,
        DeviceId: deviceId,
        PushKind: PUSH_KIND_EXPO,
        PushToken: expoPushToken,
    }, {
        timeout: 30000,
        validateStatus: () => true,
        headers: {
            'user-agent': RustPlusLoginPages.USER_AGENT,
            accept: 'application/json',
            'content-type': 'application/json',
        },
    });

    if (response.status !== 200) {
        const error = new Error(`The Rust+ push registration failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
    }

    const token = response.data && typeof response.data.token === 'string' ? response.data.token : null;

    return {
        expiresAt: token === null ? null : RustPlusTransport.getAuthTokenExpiry(token),
        returnedToken: token,
    };
}

/* Is step 4 due: never made, made with another account token, or about to expire? */
function isRegistrationDue(push, auth, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!push || !push.registration) return true;
    if (push.registration.tokenHash !== tokenHash(auth.token)) return true;

    const expiresAt = push.registration.expiresAt;
    if (Number.isFinite(expiresAt) && (expiresAt - nowSeconds) <= REGISTRATION_RENEW_BEFORE_SECONDS) return true;

    return false;
}

/*
    Make sure the account is registered for push notifications. Returns the stored push data and whether something was
    (re)registered. deps: { pushReceiver, http, log, now } for tests.
*/
async function ensureRegistered(steamId, deps = {}) {
    const log = deps.log || (() => undefined);
    const http = deps.http || Axios;

    const auth = RustPlusAuth.readAuth(`${steamId}`);
    if (auth === null) throw new Error('No stored Rust+ login for this account.');

    let push = readPush(steamId) || {};
    let changed = false;

    /*
        Expo accepts only a bare UUID as device id ("deviceId": Invalid UUID, status 400). 1.42.0 stored
        "rustplusplus:<uuid>", such an id is replaced together with everything registered for it.
    */
    if (!isUuid(push.deviceId)) {
        push.deviceId = Crypto.randomUUID();
        push.expoPushToken = null;
        push.registration = null;
        changed = true;
    }

    if (!push.fcm || !push.fcm.androidId || !push.fcm.securityToken || !push.fcm.fcmToken) {
        log(`Rust+ push: registering a new FCM device for ${steamId}`);
        push.fcm = await registerFcm(deps.pushReceiver);
        push.expoPushToken = null;
        push.registration = null;
        push.persistentIds = [];

        /* Kept right away: a failing step 3 must not register yet another Google device on the next try. */
        writePush(steamId, push);
        changed = false;
    }

    if (!push.expoPushToken) {
        log(`Rust+ push: requesting an Expo push token for ${steamId}`);
        push.expoPushToken = await fetchExpoPushToken(push.deviceId, push.fcm.fcmToken, http);
        push.registration = null;
        changed = true;
    }

    /* Store what is done so far: a failing step 4 must not throw away the FCM device. */
    if (changed) writePush(steamId, push);

    let registered = false;

    if (isRegistrationDue(push, auth, deps.now)) {
        log(`Rust+ push: registering ${steamId} with Facepunch`);

        const result = await registerWithFacepunch(auth.token, push.deviceId, push.expoPushToken, http);

        push = Object.assign(readPush(steamId) || push, {
            registration: {
                tokenHash: tokenHash(auth.token),
                expiresAt: result.expiresAt,
                registeredAt: new Date().toISOString(),
            },
        });

        writePush(steamId, push);
        registered = true;
    }

    return { push: push, registered: registered };
}

/* Firebase notification ids that were handled already (a reconnect redelivers unacknowledged ones). */
function getPersistentIds(steamId) {
    const push = readPush(steamId);

    return (push && Array.isArray(push.persistentIds)) ? push.persistentIds.filter((id) => typeof id === 'string') : [];
}

/* Remember a handled id. Returns false when it was handled before. */
function markPersistentId(steamId, persistentId) {
    if (typeof persistentId !== 'string' || persistentId === '') return true;

    const push = readPush(steamId);
    if (push === null) return true;

    const ids = Array.isArray(push.persistentIds) ? push.persistentIds : [];
    if (ids.includes(persistentId)) return false;

    ids.push(persistentId);
    if (ids.length > MAX_PERSISTENT_IDS) ids.splice(0, ids.length - MAX_PERSISTENT_IDS);

    push.persistentIds = ids;

    try {
        writePush(steamId, push);
    }
    catch (e) {
        /* Not remembered across restarts, the notification is still handled once in this session. */
    }

    return true;
}

module.exports = {
    setPushDir: setPushDir,
    RUSTPLUS_FCM: RUSTPLUS_FCM,
    REGISTRATION_RENEW_BEFORE_SECONDS: REGISTRATION_RENEW_BEFORE_SECONDS,
    getPushFilePath: getPushFilePath,
    readPush: readPush,
    writePush: writePush,
    removePush: removePush,
    tokenHash: tokenHash,
    loadPushReceiver: loadPushReceiver,
    registerFcm: registerFcm,
    fetchExpoPushToken: fetchExpoPushToken,
    registerWithFacepunch: registerWithFacepunch,
    isRegistrationDue: isRegistrationDue,
    ensureRegistered: ensureRegistered,
    getPersistentIds: getPersistentIds,
    markPersistentId: markPersistentId,
};
