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
    The Rust+ websocket is reached in one of two ways:

    - direct: ws://<server>:<appPort>
    - Facepunch proxy: wss://companion-rust.facepunch.com/game/<server>/<appPort>

    The direct connection is what rustplusplus always used. It fails when the app port is not reachable from the
    outside (NAT, hosting provider proxy) or when Facepunch disables direct connections. The proxy is the endpoint
    the Rust+ app falls back to in that case, so the bot tries the direct connection first and switches to the
    proxy when the direct attempts keep failing.
*/

const MODES = {
    AUTO: 'auto',
    DIRECT: 'direct',
    PROXY: 'proxy',
};

/* Direct connection attempts that may fail in a row before the Facepunch proxy is used. */
const DIRECT_FAILURES_BEFORE_PROXY = 3;

/* Errors that mean 'the endpoint could not be reached'. */
const CONNECTION_FAILURE_CODES = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
];

/* Accepts the configured value: 'auto' (default), 'direct'/'false' and 'proxy'/'true'. */
function normalizeMode(mode) {
    const value = `${mode === undefined || mode === null ? '' : mode}`.trim().toLowerCase();

    if (value === MODES.PROXY || value === 'true') return MODES.PROXY;
    if (value === MODES.DIRECT || value === 'false') return MODES.DIRECT;
    return MODES.AUTO;
}

/* In auto mode the proxy is only used after a few failed direct attempts. */
function shouldUseFacepunchProxy(mode, directFailures) {
    const normalized = normalizeMode(mode);

    if (normalized === MODES.PROXY) return true;
    if (normalized === MODES.DIRECT) return false;

    return directFailures >= DIRECT_FAILURES_BEFORE_PROXY;
}

function isConnectionFailure(error) {
    return CONNECTION_FAILURE_CODES.includes(error ? error.code : undefined);
}

/*
    A server that was paired without an ip/port is keyed by its pairing id (`relay-<uuid>`, see util/rustplusSync.js)
    and is only reachable through the authenticated socket. The library transports can only build
    `ws://<server>:<port>` or the proxy path, and `ws://relay:<uuid>` is not a valid URL: the WebSocket constructor
    throws inside the library, which ends the process through an unhandled rejection.
*/
const RELAY_SERVER_IP = 'relay';

function isRelayAddress(server) {
    return `${server === undefined || server === null ? '' : server}`.trim().toLowerCase() === RELAY_SERVER_IP;
}

/* Human readable endpoint for the log, mirrors what the rustplus.js library connects to. */
function describeEndpoint(server, port, useFacepunchProxy) {
    return useFacepunchProxy ?
        `Facepunch proxy companion-rust.facepunch.com/game/${server}/${port}` :
        `direct ws://${server}:${port}`;
}

/*
    The transport the Rust+ app itself uses since Facepunch removed the direct connections: an authenticated
    websocket per server, addressed by the pairing id (uuid) instead of ip:port.
*/
const SOCKET_HOST = 'companion-rust.facepunch.com';
const SOCKET_PROTOCOL = 'rustplus.auth.v1';
const SOCKET_ORIGIN = 'https://app.playrust.com';   /* origin the Rust+ web app sends with the handshake */
const SOCKET_BUILD_VERSION = '1792502454122';   /* build timestamp of app.playrust.com (2026-10-20T13:20:54Z) */

function buildSocketUrl(serverGuid, buildVersion = SOCKET_BUILD_VERSION) {
    return `wss://${SOCKET_HOST}/socket/${serverGuid}?v=${buildVersion}`;
}

/* The token is sent as the second websocket subprotocol, base64url encoded (no padding). */
function buildSocketProtocols(authToken) {
    return [SOCKET_PROTOCOL, Buffer.from(`${authToken}`, 'utf8').toString('base64url')];
}

/* The auth token is "<base64 json payload>.<signature>", the expiry is part of the payload. */
function getAuthTokenExpiry(authToken) {
    try {
        const payload = `${authToken}`.split('.')[0];
        const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        return Number.isFinite(data.exp) ? data.exp : null;
    }
    catch (e) {
        return null;
    }
}

function describeSocketEndpoint(serverGuid, buildVersion = SOCKET_BUILD_VERSION) {
    return `authenticated wss://${SOCKET_HOST}/socket/${serverGuid}?v=${buildVersion}`;
}

module.exports = {
    MODES: MODES,
    DIRECT_FAILURES_BEFORE_PROXY: DIRECT_FAILURES_BEFORE_PROXY,
    RELAY_SERVER_IP: RELAY_SERVER_IP,
    SOCKET_PROTOCOL: SOCKET_PROTOCOL,
    SOCKET_ORIGIN: SOCKET_ORIGIN,
    SOCKET_BUILD_VERSION: SOCKET_BUILD_VERSION,
    normalizeMode: normalizeMode,
    shouldUseFacepunchProxy: shouldUseFacepunchProxy,
    isConnectionFailure: isConnectionFailure,
    isRelayAddress: isRelayAddress,
    describeEndpoint: describeEndpoint,
    buildSocketUrl: buildSocketUrl,
    buildSocketProtocols: buildSocketProtocols,
    getAuthTokenExpiry: getAuthTokenExpiry,
    describeSocketEndpoint: describeSocketEndpoint,
};
