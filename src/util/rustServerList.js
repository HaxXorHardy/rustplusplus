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
    The address of a Rust server, taken from the server list of the game (api.facepunch.com/api/public/serverlist).

    Neither the account state of Rust+ nor its notification history carries the address of a relay paired server, so
    the connect string of a server entry stays empty. The server list of the game knows every listed server with its
    hostname, ip and port - and it is what the game itself shows in the server browser.

    The endpoint ignores every query parameter and always answers with the whole list (about 3 MB, more than 10000
    servers), so it is fetched at most once per SERVER_LIST_TTL_MS and reduced to the addresses the bot needs.
*/

const Axios = require('axios');

const SERVER_LIST_URL = 'https://api.facepunch.com/api/public/serverlist';
const SERVER_LIST_TTL_MS = 6 * 60 * 60 * 1000; /* 6 hours */
const SERVER_LIST_RETRY_MS = 10 * 60 * 1000; /* 10 minutes */
const SERVER_LIST_TIMEOUT_MS = 30000;
const USER_AGENT = 'Mozilla/5.0 (compatible; rustplusplus; +https://github.com/HaxXorHardy/rustplusplus)';

/* { at, addresses: Map<hostname, 'ip:port'>, pending: Promise|null } */
const cache = { at: 0, addresses: null, pending: null };

/*
    The in-game name of a server differs from the stored one in case and whitespace often enough.
*/
function normalizeHostname(hostname) {
    if (typeof (hostname) !== 'string') return null;

    const normalized = hostname.replace(/\s+/g, ' ').trim().toLowerCase();
    return normalized === '' ? null : normalized;
}

/*
    The servers of the list as { hostname -> 'ip:port' }.
*/
function buildAddressMap(servers) {
    const addresses = new Map();

    for (const server of Array.isArray(servers) ? servers : []) {
        if (!server) continue;

        const hostname = normalizeHostname(server.hostname);
        const ip = (typeof (server.ip) === 'string') ? server.ip.trim() : null;
        const port = Number.isFinite(server.port) ? server.port : null;

        if (!hostname || !ip || port === null) continue;
        if (addresses.has(hostname)) continue;

        addresses.set(hostname, `${ip}:${port}`);
    }

    return addresses;
}

/*
    The server list of the game, null when it could not be read.
*/
async function fetchServerList() {
    const response = await Axios.get(SERVER_LIST_URL, {
        timeout: SERVER_LIST_TIMEOUT_MS,
        validateStatus: () => true,
        headers: {
            'user-agent': USER_AGENT,
            accept: 'application/json',
        },
    });

    if (response.status !== 200) return null;

    const servers = response.data ? response.data.Servers : null;
    return Array.isArray(servers) ? servers : null;
}

/*
    The cached addresses, fetched again when they are older than the TTL. A failed fetch is retried sooner than a
    successful one, but never on every call.
*/
async function ensureAddresses(fetchList) {
    const now = Date.now();

    /*
        A successful fetch keeps the map for the whole TTL, a failed one moves its timestamp back so the next attempt
        starts after the retry window instead of on the next call.
    */
    if ((now - cache.at) < SERVER_LIST_TTL_MS) return cache.addresses;
    if (cache.pending) return await cache.pending;

    cache.pending = (async () => {
        let addresses = null;

        try {
            addresses = buildAddressMap(await fetchList());
        }
        catch (e) {
            addresses = null;
        }

        if (addresses !== null) {
            cache.addresses = addresses;
            cache.at = Date.now();
        }
        else {
            /* Keep what is there, but ask again soon instead of waiting a whole TTL. */
            cache.at = Date.now() - SERVER_LIST_TTL_MS + SERVER_LIST_RETRY_MS;
        }

        return cache.addresses;
    })();

    try {
        return await cache.pending;
    }
    finally {
        cache.pending = null;
    }
}

/*
    The address ('ip:port') of the server with that name, null when the list does not know it.
    @param {string} hostname The name of the server as the game lists it.
    @param {object} options Optional fetch function (used by the tests).
    @return {string|null}
*/
async function getAddress(hostname, options = {}) {
    const normalized = normalizeHostname(hostname);
    if (!normalized) return null;

    const addresses = await ensureAddresses(options.fetch || fetchServerList);
    if (!addresses) return null;

    return addresses.get(normalized) || null;
}

/*
    The connect command ('connect ip:port') of the server with that name, null when the address is unknown.
    @param {string} hostname The name of the server as the game lists it.
    @param {object} options Optional fetch function (used by the tests).
    @return {string|null}
*/
async function getConnectCommand(hostname, options = {}) {
    const address = await getAddress(hostname, options);

    return address !== null ? `connect ${address}` : null;
}

/* Forget the cached list, the tests use it to start from scratch. */
function resetCache() {
    cache.at = 0;
    cache.addresses = null;
    cache.pending = null;
}

module.exports = {
    SERVER_LIST_TTL_MS: SERVER_LIST_TTL_MS,
    SERVER_LIST_RETRY_MS: SERVER_LIST_RETRY_MS,
    normalizeHostname: normalizeHostname,
    buildAddressMap: buildAddressMap,
    fetchServerList: fetchServerList,
    getAddress: getAddress,
    getConnectCommand: getConnectCommand,
    resetCache: resetCache,
};
