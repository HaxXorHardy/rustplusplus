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
            "servers": [{ "id": "<server uuid>", "name": "<server name>", "playerToken": 1623465021 }]
        }
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

function isTokenExpired(auth, nowSeconds = Math.floor(Date.now() / 1000)) {
    const expiresAt = (auth && Number.isFinite(auth.tokenExpiresAt)) ?
        auth.tokenExpiresAt : RustPlusTransport.getAuthTokenExpiry(auth ? auth.token : null);

    return (expiresAt === null) ? false : expiresAt <= nowSeconds;
}

/*
    Stores the pairing id of every known server of the instance, matched by the server name from the login file.
    Returns how many servers were matched.
*/
function applyServerGuids(instance, servers) {
    const auth = { servers: Array.isArray(servers) ? servers : [] };
    let matched = 0;

    for (const serverId in instance.serverList) {
        const server = instance.serverList[serverId];
        const guid = resolveServerGuid(auth, server.title);

        if (guid !== null) {
            server.guid = guid;
            matched++;
        }
    }

    return matched;
}

module.exports = {
    AUTH_DIR: AUTH_DIR,
    getAuthFilePath: getAuthFilePath,
    readAuth: readAuth,
    writeAuth: writeAuth,
    resolveServerGuid: resolveServerGuid,
    isTokenExpired: isTokenExpired,
    applyServerGuids: applyServerGuids,
};
