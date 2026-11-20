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
    Registers an Android device of an app at Google (Firebase installation, GCM check-in, c2dm register3) and
    returns its FCM token. Same requests as AndroidFCM of @liamcottle/push-receiver 0.0.4 (MIT, Copyright (c) 2017
    Matthieu Lemoine), which needed the deprecated "request" package; this uses axios and has bounded retries.
*/

const Axios = require('axios');
const Crypto = require('crypto');
const Path = require('path');
const Protobuf = require('protobufjs');

const CHECKIN_URL = 'https://android.clients.google.com/checkin';
const REGISTER_URL = 'https://android.clients.google.com/c2dm/register3';
const INSTALLATIONS_URL = 'https://firebaseinstallations.googleapis.com/v1/projects';

const FIREBASE_CLIENT = 'android-min-sdk/23 fire-core/20.0.0 device-name/a21snnxx device-brand/samsung ' +
    'device-model/a21s android-installer/com.android.vending fire-android/30 fire-installations/17.0.0 ' +
    'fire-fcm/22.0.0 android-platform/ kotlin/1.9.23 android-target-sdk/34';
const USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 11; SM-A217F Build/RP1A.200720.012)';

const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;
const RETRY_STEP_MS = 5000;
const MAX_REGISTER_ATTEMPTS = 6;
const REGISTER_RETRY_MS = 1000;

let checkinTypes = null;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCheckinTypes() {
    if (!checkinTypes) {
        const root = Protobuf.loadSync(Path.join(__dirname, 'proto', 'checkin.proto'));
        checkinTypes = {
            request: root.lookupType('checkin_proto.AndroidCheckinRequest'),
            response: root.lookupType('checkin_proto.AndroidCheckinResponse'),
        };
    }

    return checkinTypes;
}

function isTransient(error) {
    const status = error && error.status;
    return status === undefined || status === 429 || status >= 500;
}

/* POST with a timeout; non-2xx answers throw with .status. Network errors and 429/5xx are tried again. */
async function post(http, url, body, options, deps = {}) {
    const attempts = deps.maxAttempts || MAX_ATTEMPTS;
    const sleep = deps.wait || wait;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await http.post(url, body, Object.assign({
                timeout: REQUEST_TIMEOUT_MS,
                validateStatus: () => true,
            }, options));

            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`${url} answered with HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }

            return response.data;
        }
        catch (e) {
            lastError = e;
            if (attempt === attempts || !isTransient(e)) break;
            await sleep(attempt * RETRY_STEP_MS);
        }
    }

    throw lastError;
}

function textOf(data) {
    return Buffer.isBuffer(data) ? data.toString('utf8') : `${data}`;
}

function checkinRequestBuffer(androidId, securityToken) {
    const { request } = loadCheckinTypes();
    const Long = Protobuf.util.Long;

    const payload = {
        userSerialNumber: 0,
        checkin: {
            type: 3,
            chromeBuild: { platform: 2, chromeVersion: '63.0.3234.0', channel: 1 },
        },
        version: 3,
        id: androidId ? Long.fromString(`${androidId}`) : undefined,
        securityToken: securityToken ? Long.fromString(`${securityToken}`, true) : undefined,
    };

    const error = request.verify(payload);
    if (error) throw new Error(`Invalid check-in request: ${error}`);

    return Buffer.from(request.encode(request.create(payload)).finish());
}

/* GCM check-in: without ids a new device is created, with ids the existing one is confirmed. */
async function checkIn(androidId, securityToken, deps = {}) {
    const http = deps.http || Axios;
    const data = await post(http, CHECKIN_URL, checkinRequestBuffer(androidId, securityToken), {
        headers: { 'Content-Type': 'application/x-protobuf' },
        responseType: 'arraybuffer',
    }, deps);

    const { response } = loadCheckinTypes();
    const message = response.decode(Buffer.from(data));
    const object = response.toObject(message, { longs: String, enums: String, bytes: String });

    if (!object.androidId || !object.securityToken) {
        throw new Error('The GCM check-in returned no device.');
    }

    return object;
}

/* A Firebase installation id: 17 random bytes, the first four bits 0b0111, base64 without padding. */
function generateFirebaseFid() {
    const buffer = Crypto.randomBytes(17);
    buffer[0] = 0b01110000 | (buffer[0] & 0b00001111);
    return buffer.toString('base64').replace(/=/g, '');
}

async function installRequest(apiKey, projectId, gmsAppId, androidPackage, androidCert, deps = {}) {
    const http = deps.http || Axios;
    const data = await post(http, `${INSTALLATIONS_URL}/${projectId}/installations`, {
        fid: generateFirebaseFid(),
        appId: gmsAppId,
        authVersion: 'FIS_v2',
        sdkVersion: 'a:17.0.0',
    }, {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Android-Package': androidPackage,
            'X-Android-Cert': androidCert,
            'x-firebase-client': FIREBASE_CLIENT,
            'x-firebase-client-log-type': '3',
            'x-goog-api-key': apiKey,
            'User-Agent': USER_AGENT,
        },
    }, deps);

    const token = data && data.authToken && data.authToken.token;
    if (!token) throw new Error('The Firebase installation returned no auth token.');

    return token;
}

async function registerRequest(androidId, securityToken, installationAuthToken, gcmSenderId, gmsAppId,
    androidPackage, androidCert, deps = {}) {
    const http = deps.http || Axios;
    const sleep = deps.wait || wait;
    const form = new URLSearchParams({
        'device': `${androidId}`,
        'app': androidPackage,
        'cert': androidCert,
        'app_ver': '1',
        'X-subtype': gcmSenderId,
        'X-app_ver': '1',
        'X-osv': '29',
        'X-cliv': 'fiid-21.1.1',
        'X-gmsv': '220217001',
        'X-scope': '*',
        'X-Goog-Firebase-Installations-Auth': installationAuthToken,
        'X-gms_app_id': gmsAppId,
        'X-Firebase-Client': FIREBASE_CLIENT,
        'X-Firebase-Client-Log-Type': '1',
        'X-app_ver_name': '1',
        'target_ver': '31',
        'sender': gcmSenderId,
    }).toString();

    let text = '';
    for (let attempt = 1; attempt <= MAX_REGISTER_ATTEMPTS; attempt++) {
        text = textOf(await post(http, REGISTER_URL, form, {
            headers: {
                'Authorization': `AidLogin ${androidId}:${securityToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            responseType: 'text',
            transformResponse: [(raw) => raw],
        }, deps));

        /* Answers "token=<fcm token>" or "Error=<reason>" (PHONE_REGISTRATION_ERROR comes and goes). */
        if (!text.includes('Error')) break;
        if (attempt === MAX_REGISTER_ATTEMPTS) throw new Error(`The GCM registration failed: ${text.trim()}`);
        await sleep(REGISTER_RETRY_MS);
    }

    const match = /^token=(.+)$/m.exec(text.trim());
    if (!match) throw new Error('The GCM registration returned no token.');

    return match[1];
}

/* Creates a new device of the app and returns { gcm: { androidId, securityToken }, fcm: { token } }. */
async function register(apiKey, projectId, gcmSenderId, gmsAppId, androidPackage, androidCert, deps = {}) {
    const installationAuthToken = await installRequest(apiKey, projectId, gmsAppId, androidPackage, androidCert,
        deps);
    const device = await checkIn(undefined, undefined, deps);
    const token = await registerRequest(device.androidId, device.securityToken, installationAuthToken, gcmSenderId,
        gmsAppId, androidPackage, androidCert, deps);

    return {
        gcm: { androidId: device.androidId, securityToken: device.securityToken },
        fcm: { token: token },
    };
}

module.exports = {
    register,
    checkIn,
    installRequest,
    registerRequest,
    generateFirebaseFid,
    checkinRequestBuffer,
};
