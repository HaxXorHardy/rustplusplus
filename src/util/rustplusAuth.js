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
    Storage for the Facepunch/Rust+ account token of a steam account.

    The token is created by the Steam login of the Rust+ web app (see scripts/rustplusLogin.js) and is required
    for the authenticated websocket the Rust+ app uses. One file per steam account:

        credentials/rustplusAuth/<steamId>.json
        {
            "steamId": "76561198000000000",
            "token": "<base64 payload>.<signature>",
            "tokenExpiresAt": 1795255624,
            "updatedAt": "2026-11-07T09:00:00.000Z",
            "steamRefreshToken": "<Steam JWT, used to renew the token without a login>",
            "servers": [{ "id": "<server uuid>", "name": "<server name>", "playerToken": 1623465021 }]
        }

    The token lives ~14 days. When it is about to expire the bot renews it with `steamRefreshToken` (no password,
    no Steam Guard) - see util/rustplusLogin.js and RPP_RUSTPLUS_TOKEN_RENEW_BEFORE.
*/

const Fs = require('fs');
const Path = require('path');

const AtomicWriteFile = require('./atomicWriteFile.js');
const RustPlusTransport = require('./rustplusTransport.js');

const AUTH_DIR = Path.join(__dirname, '..', '..', 'credentials', 'rustplusAuth');

function getAuthFilePath(steamId) {
    return Path.join(AUTH_DIR, `${steamId}.json`);
}

function readAuth(steamId) {
    const path = getAuthFilePath(steamId);

    try {
        if (!steamId || !Fs.existsSync(path)) return null;

        const auth = JSON.parse(Fs.readFileSync(path, 'utf8'));
        return (typeof auth.token === 'string' && auth.token.length !== 0) ? auth : null;
    }
    catch (e) {
        return null;
    }
}

function writeAuth(steamId, auth) {
    Fs.mkdirSync(AUTH_DIR, { recursive: true });
    AtomicWriteFile(getAuthFilePath(steamId), JSON.stringify(auth, null, 2));
}

/*
    Every steam id with a stored login. A guild that has no server configured does not know which account it belongs
    to, these are the accounts that can be asked instead.
*/
function listSteamIds() {
    try {
        if (!Fs.existsSync(AUTH_DIR)) return [];

        return Fs.readdirSync(AUTH_DIR)
            .filter((file) => file.endsWith('.json'))
            .map((file) => file.slice(0, -'.json'.length))
            .filter((steamId) => readAuth(steamId) !== null);
    }
    catch (e) {
        return [];
    }
}

function normalizeName(name) {
    return `${name === undefined || name === null ? '' : name}`.trim().toLowerCase();
}

/* The pairing id (uuid) of a server, the Rust+ web app lists it next to the server name. */
function resolveServerGuid(auth, serverTitle) {
    if (!auth || !Array.isArray(auth.servers)) return null;

    const exact = auth.servers.find((e) => e.name === serverTitle);
    if (exact) return exact.id || null;

    const normalized = normalizeName(serverTitle);
    const fuzzy = auth.servers.find((e) => normalizeName(e.name) === normalized);
    return fuzzy ? fuzzy.id || null : null;
}

/* Expiry of the stored token (unix seconds), taken from the file or from the token payload. */
function getTokenExpiry(auth) {
    if (auth && Number.isFinite(auth.tokenExpiresAt)) return auth.tokenExpiresAt;
    return RustPlusTransport.getAuthTokenExpiry(auth ? auth.token : null);
}

function isTokenExpired(auth, nowSeconds = Math.floor(Date.now() / 1000)) {
    const expiresAt = getTokenExpiry(auth);

    return (expiresAt === null) ? false : expiresAt <= nowSeconds;
}

/*
    Should the token be renewed now? True when it expires within `renewBeforeSeconds` (an expired token is always
    due). Unknown expiries are left alone, there is nothing to plan with.
*/
function isTokenExpiringSoon(auth, renewBeforeSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!auth || typeof auth.token !== 'string') return false;

    const expiresAt = getTokenExpiry(auth);
    if (expiresAt === null) return false;

    return (expiresAt - nowSeconds) <= renewBeforeSeconds;
}

module.exports = {
    AUTH_DIR: AUTH_DIR,
    getAuthFilePath: getAuthFilePath,
    readAuth: readAuth,
    writeAuth: writeAuth,
    listSteamIds: listSteamIds,
    resolveServerGuid: resolveServerGuid,
    getTokenExpiry: getTokenExpiry,
    isTokenExpired: isTokenExpired,
    isTokenExpiringSoon: isTokenExpiringSoon,
};
