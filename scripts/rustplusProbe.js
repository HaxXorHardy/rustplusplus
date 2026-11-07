#!/usr/bin/env node
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
    Standalone diagnostic for the Rust+ websocket transports of a server.

    It only opens (and immediately closes) the websocket, no player token is needed and nothing is sent to the
    game server. That makes it possible to tell apart:

    - the server/app port is wrong or the server is offline  -> the direct connection fails,
    - Facepunch does not relay the connection                -> the proxy answers with an HTTP error.

    Usage:
        node scripts/rustplusProbe.js [--guild=<guildId>] [--server=<ip-appPort>]
        node scripts/rustplusProbe.js --ip=<ip> --port=<appPort> [--timeout=<ms>] [--json]

    --guild    Instance file (guild id) to use, defaults to the only file in the instances folder.
    --server   Server id (ip-appPort) from that instance file, defaults to activeServer.
    --ip       Server ip, overrides the value from the instance file.
    --port     Rust+ app port, overrides the value from the instance file.
    --timeout  Timeout per connection attempt in milliseconds, defaults to 10000.
    --json     Print the results as JSON (for scripts).
*/

const Fs = require('fs');
const Path = require('path');

const PROXY_HOST = 'companion-rust.facepunch.com';

/* Build timestamp of the Rust+ web app (app.playrust.com), the "v" query parameter of the socket URL. */
const APP_BUILD_VERSION = '1792502454122';

function loadWebSocket() {
    try {
        return require('ws');
    }
    catch (e) {
        console.error('[transport-probe] The "ws" package is missing, run "npm install" first.');
        process.exit(1);
    }
}

function printHelp() {
    console.log('Usage: node scripts/rustplusProbe.js [--guild=<guildId>] [--server=<ip-appPort>] ' +
        '[--ip=<ip> --port=<appPort>] [--timeout=<ms>] [--json]');
    console.log('       node scripts/rustplusProbe.js --socket-id=<serverId> ' +
        '(--auth-token=<token> | --auth-token-b64=<value>) [--build-version=<ms>] [--json]');
    console.log('');
    console.log('  --socket-id / --auth-token  Probe the new authenticated Rust+ websocket that the web app');
    console.log('                              (app.playrust.com) uses. --auth-token takes the raw player token,');
    console.log('                              --auth-token-b64 the already base64url encoded subprotocol value.');
    console.log('                              See FAQ.md for how to read both values in the browser.');
}

function parseArgs(argv) {
    const options = {
        guildId: null,
        serverId: null,
        ip: null,
        port: null,
        socketId: null,
        authToken: null,
        authTokenB64: null,
        buildVersion: APP_BUILD_VERSION,
        timeoutMs: 10000,
        json: false,
        help: false,
    };

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--json') {
            options.json = true;
            continue;
        }
        if (arg.startsWith('--guild=')) {
            options.guildId = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--server=')) {
            options.serverId = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--ip=')) {
            options.ip = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--port=')) {
            options.port = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--socket-id=')) {
            options.socketId = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--auth-token=')) {
            options.authToken = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--auth-token-b64=')) {
            options.authTokenB64 = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--build-version=')) {
            options.buildVersion = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--timeout=')) {
            const value = Number.parseInt(arg.split('=').slice(1).join('='), 10);
            if (!Number.isNaN(value) && value > 0) options.timeoutMs = value;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

function listInstanceFiles() {
    const instancesDirectory = Path.join(__dirname, '..', 'instances');
    if (!Fs.existsSync(instancesDirectory)) return [];

    return Fs.readdirSync(instancesDirectory)
        .filter((e) => e.endsWith('.json') && !e.endsWith('.tmp'))
        .map((e) => e.slice(0, -'.json'.length));
}

function readInstance(guildId) {
    return JSON.parse(Fs.readFileSync(Path.join(__dirname, '..', 'instances', `${guildId}.json`), 'utf8'));
}

/* Resolves the target from the instance file, like the bot does for its active server. */
function resolveTarget(options) {
    if (options.ip !== null && options.port !== null) {
        return { ip: options.ip, port: options.port, source: '--ip/--port' };
    }

    const guildId = options.guildId !== null ? options.guildId : listInstanceFiles()[0];
    if (!guildId) {
        throw new Error('No instance file found, use --ip=<ip> --port=<appPort>.');
    }

    const instance = readInstance(guildId);
    const serverId = options.serverId !== null ? options.serverId : instance.activeServer;
    if (!serverId) {
        throw new Error(`No active server in instance ${guildId}, use --server=<ip-appPort> or --ip/--port.`);
    }

    const server = instance.serverList[serverId];
    if (!server) {
        throw new Error(`Server ${serverId} does not exist in instance ${guildId}.`);
    }

    return {
        ip: options.ip !== null ? options.ip : server.serverIp,
        port: options.port !== null ? options.port : server.appPort,
        source: `${guildId}/${serverId}`,
    };
}

/* Opens the websocket and reports the first event (open, HTTP answer, error, timeout). */
function probe(WebSocket, label, url, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        let settled = false;
        let socket = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            try { if (socket) socket.terminate(); } catch (e) { /* already closed */ }
            resolve(Object.assign({ label, url, ms: Date.now() - started }, result));
        };

        try {
            socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
        }
        catch (e) {
            return finish({ event: 'error', description: e.message });
        }

        socket.on('open', () => finish({ event: 'open', description: 'websocket established' }));
        socket.on('unexpected-response', (request, response) => finish({
            event: 'http',
            status: response.statusCode,
            description: `${response.statusCode} ${response.statusMessage}`,
        }));
        socket.on('error', (e) => finish({ event: 'error', code: e.code, description: e.message }));
        socket.on('close', (code, reason) => finish({ event: 'close', code: code, description: `${reason}` }));

        setTimeout(() => finish({ event: 'timeout', description: `no answer within ${timeoutMs} ms` }),
            timeoutMs + 500);
    });
}

function describeResult(result) {
    if (result.event === 'open') return 'OK';
    if (result.event === 'http') return `HTTP ${result.description}`;
    if (result.event === 'timeout') return `TIMEOUT (${result.description})`;
    if (result.code) return `${result.code} (${result.description})`;
    return result.description;
}

function printResults(target, results) {
    const width = Math.max(...results.map((e) => e.url.length));

    console.log(`[transport-probe] Rust+ websocket transports for ${target.ip}:${target.port} (${target.source})`);
    console.log('');

    for (const result of results) {
        console.log(`  ${result.label.padEnd(7)} ${result.url.padEnd(width)}  ` +
            `${describeResult(result).padEnd(32)} ${result.ms} ms`);
    }

    console.log('');
    const working = results.filter((e) => e.event === 'open');

    if (working.length !== 0) {
        console.log(`  Only the ${working.map((e) => e.label).join(' and ')} transport worked, ` +
            `use RPP_RUSTPLUS_TRANSPORT=${working[0].label}.`);
        return;
    }

    console.log('  No transport could be established.');
    console.log('');

    const direct = results.find((e) => e.label === 'direct');
    if (direct && direct.code === 'ECONNRESET') {
        console.log('  direct: the server accepted the connection and dropped it again. Rust removed the support');
        console.log('          for direct Rust+ connections (commit rustplus_remove_direct), or the app port is');
        console.log('          wrong / changed - check it in the server settings.');
    }
    else if (direct) {
        console.log('  direct: the app port does not answer, the server is offline or the port is blocked.');
    }

    const proxy = results.find((e) => e.label === 'proxy');
    if (proxy && proxy.status === 418) {
        console.log('  proxy:  Facepunch answered HTTP 418 for the relay endpoint. The endpoint answers that for');
        console.log('          every target (a plain GET returns it as well), so the relay is currently disabled.');
    }
    else if (proxy) {
        console.log('  proxy:  the Facepunch relay did not accept the connection.');
    }

    console.log('');
    console.log('  The bot keeps retrying and switches transports automatically (RPP_RUSTPLUS_TRANSPORT, auto).');
}

/*
    The websocket of the Rust+ web app (app.playrust.com): wss://<host>/socket/<serverId>?v=<build>. The player
    auth token is sent as the second websocket subprotocol (base64url encoded), the first one is the protocol name.
*/
function probeSocket(WebSocket, options) {
    const url = `wss://${PROXY_HOST}/socket/${options.socketId}?v=${options.buildVersion}`;
    const token = options.authTokenB64 !== null ?
        options.authTokenB64 : Buffer.from(`${options.authToken}`, 'utf8').toString('base64url');

    return new Promise((resolve) => {
        const started = Date.now();
        let settled = false;
        let socket = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            try { if (socket) socket.terminate(); } catch (e) { /* already closed */ }
            resolve(Object.assign({ label: 'socket', url, ms: Date.now() - started }, result));
        };

        try {
            socket = new WebSocket(url, ['rustplus.auth.v1', token], { handshakeTimeout: options.timeoutMs });
        }
        catch (e) {
            return finish({ event: 'error', description: e.message });
        }

        socket.on('open', () => finish({
            event: 'open',
            description: `subprotocol=${socket.protocol || 'none'}`,
        }));
        socket.on('unexpected-response', (request, response) => finish({
            event: 'http',
            status: response.statusCode,
            description: `${response.statusCode} ${response.statusMessage}`,
        }));
        socket.on('error', (e) => finish({ event: 'error', code: e.code, description: e.message }));
        socket.on('close', (code, reason) => finish({ event: 'close', code: code, description: `${reason}` }));
        setTimeout(() => finish({ event: 'timeout', description: `no answer within ${options.timeoutMs} ms` }),
            options.timeoutMs + 500);
    });
}

function printSocketResult(result) {
    console.log('[transport-probe] authenticated Rust+ websocket (the transport the web app uses)');
    console.log('');
    console.log(`  ${result.url}`);
    console.log(`  result: ${describeResult(result)}  (${result.ms} ms)`);
    console.log('');

    if (result.event === 'open') {
        console.log('  The endpoint accepted the connection, the transport works.');
        return;
    }

    if (result.status === 404) {
        console.log('  HTTP 404: Facepunch does not know that server id. Use the id of a server that is listed in');
        console.log('  the web app (the pairing id), not the ip:port.');
        return;
    }

    console.log('  The endpoint did not accept the connection. Most likely the auth token is not the one the web');
    console.log('  app uses (second subprotocol value, see FAQ.md).');
}

async function main() {
    let options = null;
    try {
        options = parseArgs(process.argv.slice(2));
    }
    catch (e) {
        console.error(`[transport-probe] ${e.message}`);
        printHelp();
        process.exit(1);
    }

    if (options.help) {
        printHelp();
        return;
    }

    const WebSocket = loadWebSocket();

    /* The authenticated socket of the web app is probed on its own, it does not need an ip/app port. */
    if (options.socketId !== null && (options.authToken !== null || options.authTokenB64 !== null)) {
        const result = await probeSocket(WebSocket, options);

        if (options.json) {
            console.log(JSON.stringify({ target: { socketId: options.socketId }, results: [result] }, null, 2));
        }
        else {
            printSocketResult(result);
        }

        process.exit(result.event === 'open' ? 0 : 1);
    }

    let target = null;
    try {
        target = resolveTarget(options);
    }
    catch (e) {
        console.error(`[transport-probe] ${e.message}`);
        process.exit(1);
    }

    const results = [
        await probe(WebSocket, 'direct', `ws://${target.ip}:${target.port}`, options.timeoutMs),
        await probe(WebSocket, 'proxy', `wss://${PROXY_HOST}/game/${target.ip}/${target.port}`, options.timeoutMs),
    ];

    if (options.json) {
        console.log(JSON.stringify({ target: target, results: results }, null, 2));
    }
    else {
        printResults(target, results);
    }

    process.exit(results.some((e) => e.event === 'open') ? 0 : 1);
}

main();
