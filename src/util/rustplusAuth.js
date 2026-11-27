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

const DEFAULT_AUTH_DIR = Path.join(__dirname, '..', '..', 'credentials', 'rustplusAuth');

let authDir = DEFAULT_AUTH_DIR;

/* The directory of the stored logins. */
function getAuthDir() {
    return authDir;
}

/* Only for the tests: they write into a temporary directory, never into the real credentials. null resets it. */
function setAuthDir(directory) {
    authDir = (directory === null || directory === undefined) ? DEFAULT_AUTH_DIR : `${directory}`;
}

/*
    A SteamID64 of an individual account. The steam id becomes a file name, so anything else (a path, "hoster", a value
    out of a forged token) is refused.
*/
const STEAM_ID_PATTERN = /^7656\d{13}$/;

function isValidSteamId(steamId) {
    return (typeof steamId === 'string' || typeof steamId === 'number') && STEAM_ID_PATTERN.test(`${steamId}`);
}

function getAuthFilePath(steamId) {
    if (!isValidSteamId(steamId)) throw new Error('Invalid steam id.');

    return Path.join(authDir, `${steamId}.json`);
}

function readAuth(steamId) {
    if (!isValidSteamId(steamId)) return null;

    const path = getAuthFilePath(steamId);

    try {
        if (!Fs.existsSync(path)) return null;

        const auth = JSON.parse(Fs.readFileSync(path, 'utf8'));
        return (typeof auth.token === 'string' && auth.token.length !== 0) ? auth : null;
    }
    catch (e) {
        return null;
    }
}

/*
    Counts the changes of a stored login in this process (write or remove). A token renewal takes a while: it compares
    the counter before it stores its result, so a login that was revoked (or replaced by a newer login) in the meantime
    is not written back.
*/
const generations = new Map();

function getAuthGeneration(steamId) {
    return generations.get(`${steamId}`) || 0;
}

function bumpAuthGeneration(steamId) {
    generations.set(`${steamId}`, getAuthGeneration(steamId) + 1);
}

function writeAuth(steamId, auth) {
    const path = getAuthFilePath(steamId);

    Fs.mkdirSync(authDir, { recursive: true });
    /* The account token is a credential: the file is not readable for other users of the host. */
    AtomicWriteFile(path, JSON.stringify(auth, null, 2), 'utf8', 0o600);
    bumpAuthGeneration(steamId);
}

/* Removes the stored login of an account (its owner removed it in Discord). */
function removeAuth(steamId) {
    if (!isValidSteamId(steamId)) return;

    /* Also when nothing is stored: a renewal that is running must not write the login back. */
    bumpAuthGeneration(steamId);
    try {
        Fs.unlinkSync(getAuthFilePath(steamId));
    }
    catch (e) {
        /* Nothing stored. */
    }
}

/*
    Every steam id with a stored login. A guild that has no server configured does not know which account it belongs
    to, these are the accounts that can be asked instead.
*/
function listSteamIds() {
    try {
        if (!Fs.existsSync(authDir)) return [];

        return Fs.readdirSync(authDir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => file.slice(0, -'.json'.length))
            .filter((steamId) => isValidSteamId(steamId) && readAuth(steamId) !== null);
    }
    catch (e) {
        return [];
    }
}

function normalizeName(name) {
    return `${name === undefined || name === null ? '' : name}`.trim().toLowerCase();
}

/*
    The pairing id (uuid) of a server. The login file lists the servers by name, but a renamed server (or two
    servers with the same name) is only told apart by the pairing token the bot already stored. A plain title string
    is still accepted.
*/
function resolveServerGuid(auth, server) {
    if (!auth || !Array.isArray(auth.servers)) return null;

    const isServer = (server !== null && typeof server === 'object');
    const playerToken = isServer ? server.playerToken : undefined;
    const serverTitle = isServer ? server.title : server;

    /* The pairing token is unique per server and does not change when the server is renamed. */
    if (playerToken !== undefined && playerToken !== null) {
        const byToken = auth.servers.find((e) => e && `${e.playerToken}` === `${playerToken}`);
        if (byToken && byToken.id) return `${byToken.id}`;
    }

    const exact = auth.servers.find((e) => e && e.name === serverTitle);
    if (exact) return exact.id || null;

    const normalized = normalizeName(serverTitle);
    const fuzzy = auth.servers.find((e) => e && normalizeName(e.name) === normalized);
    return fuzzy ? fuzzy.id || null : null;
}

/*
    The steam id the account token belongs to, taken from the token payload. The Rust+ token carries it as a claim, so
    a token that was copied out of the browser does not have to be accompanied by the steam id.
*/
function getTokenSteamId(token) {
    try {
        const payload = `${token}`.trim().split('.')[0];
        const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));

        /* A JSON number cannot hold a SteamID64 without losing digits, only the string form is taken. */
        return (data && typeof data.steamId === 'string' && isValidSteamId(data.steamId)) ? data.steamId : null;
    }
    catch (e) {
        return null;
    }
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
    getAuthDir: getAuthDir,
    setAuthDir: setAuthDir,
    isValidSteamId: isValidSteamId,
    getAuthFilePath: getAuthFilePath,
    getAuthGeneration: getAuthGeneration,
    readAuth: readAuth,
    writeAuth: writeAuth,
    removeAuth: removeAuth,
    listSteamIds: listSteamIds,
    resolveServerGuid: resolveServerGuid,
    getTokenSteamId: getTokenSteamId,
    getTokenExpiry: getTokenExpiry,
    isTokenExpired: isTokenExpired,
    isTokenExpiringSoon: isTokenExpiringSoon,
};

/* Kept for scripts/rustplusLogin.js, follows setAuthDir(). */
Object.defineProperty(module.exports, 'AUTH_DIR', { enumerable: true, get: getAuthDir });
