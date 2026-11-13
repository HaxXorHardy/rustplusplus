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
    Standalone diagnostic for the camera API of the Rust+ protocol (cameraSubscribe / cameraRays / cameraInput).

    It connects directly to a paired rust server (the credentials are read from the rustplusplus instance file and the
    stored account login), subscribes to one camera and reports what the server really sends: the subscribe info with
    its control flags, the frame rate, the size of the ray data and the entities (players and trees) that the camera
    sees. With --png the library renders one frame to a PNG, so it can be compared with what the Rust+ app shows.

    It does not use the running bot and it does not change anything on the server: it subscribes, looks, unsubscribes.

    Usage:
        node scripts/cameraProbe.js --camera=cam69 [--seconds=20] [--png] [--guild=<guildId>]
                                    [--server=<id>] [--timeout=<ms>]

    --camera   Camera code to subscribe to (e.g. DOME1, OILRIG1L1 or the code of an own camera).
    --seconds  How long the frames are collected, defaults to 20.
    --png      Also render one frame to temp/camera-<code>-<timestamp>.png.
    --guild    Instance file (guild id) to use, defaults to the only file in the instances folder.
    --server   Server id from that instance file, defaults to activeServer.
    --timeout  Timeout per request in milliseconds, defaults to 10000.

    Note: the probe opens its own relay socket with the same account token as the bot, so the bot may reconnect once
    while the probe runs.
*/

const Fs = require('fs');
const Path = require('path');

const RustPlusLib = require('@liamcottle/rustplus.js');
const RustPlusAuth = require('../src/util/rustplusAuth.js');
const RustPlusSocket = require('../src/util/rustplusSocket.js');

/* Camera.ControlFlags of the library, spelled out so the log is readable. */
const CONTROL_FLAGS = {
    MOVEMENT: 1,
    MOUSE: 2,
    SPRINT_AND_DUCK: 4,
    FIRE: 8,
    RELOAD: 16,
    CROSSHAIR: 32,
};

const ENTITY_TYPES = ['Reserved', 'Tree', 'Player'];

function printHelp() {
    console.log('Usage: node scripts/cameraProbe.js --camera=<code> [--seconds=20] [--png] [--guild=<guildId>] ' +
        '[--server=<id>] [--timeout=<ms>]');
}

function parseArgs(argv) {
    const options = {
        camera: null,
        seconds: 20,
        png: false,
        guildId: null,
        serverId: null,
        playerToken: null,
        timeoutMs: 10000,
        help: false,
    };

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--png') options.png = true;
        else if (arg.startsWith('--camera=')) options.camera = arg.slice('--camera='.length);
        else if (arg.startsWith('--seconds=')) options.seconds = Number(arg.slice('--seconds='.length));
        else if (arg.startsWith('--guild=')) options.guildId = arg.slice('--guild='.length);
        else if (arg.startsWith('--server=')) options.serverId = arg.slice('--server='.length);
        else if (arg.startsWith('--player-token=')) options.playerToken = arg.slice('--player-token='.length);
        else if (arg.startsWith('--timeout=')) options.timeoutMs = Number(arg.slice('--timeout='.length));
        else throw new Error(`Unknown argument "${arg}"`);
    }

    if (!options.help && !options.camera) throw new Error('--camera=<code> is required');
    if (!Number.isFinite(options.seconds) || options.seconds <= 0) throw new Error('--seconds must be a positive number');

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
    const instancePath = Path.join(__dirname, '..', 'instances', `${guildId}.json`);
    return JSON.parse(Fs.readFileSync(instancePath, 'utf8'));
}

function describeControlFlags(flags) {
    if (typeof flags !== 'number') return 'unknown';

    const names = Object.keys(CONTROL_FLAGS).filter((key) => (flags & CONTROL_FLAGS[key]) === CONTROL_FLAGS[key]);
    return `${flags} (${names.length === 0 ? 'static, no control' : names.join(', ')})`;
}

function entityTypeName(type) {
    return ENTITY_TYPES[type] === undefined ? `${type}` : ENTITY_TYPES[type];
}

/*
    The two answers a camera subscription can get, and what they mean - both cost an afternoon if you have to guess:
    - not_found: the server does not know the camera, or the playerToken of the server is stale (it rotates on re-pairing)
    - player_online: the paired account is connected to the server, Rust+ only streams cameras while it is offline
*/
function describeCameraError(error) {
    const code = (error && error.error) ? `${error.error}` : null;

    if (code === 'not_found') {
        return 'not_found (unknown camera code, or the playerToken of this server is stale - it rotates on re-pairing)';
    }
    if (code === 'player_online') {
        return 'player_online (the paired account is on the server - Rust+ only streams cameras while it is offline)';
    }

    return code === null ? JSON.stringify(error) : code;
}

function position(entity) {
    const p = entity.position;
    if (!p) return '?';
    const round = (value) => (typeof value === 'number' ? Math.round(value * 10) / 10 : value);
    return `${round(p.x)}/${round(p.y)}/${round(p.z)}`;
}

function printSubscribeInfo(info) {
    if (!info) {
        console.log('[camera] the server did not answer with a cameraSubscribeInfo (invalid code or no access).');
        return false;
    }

    console.log(`[camera] resolution: ${info.width}x${info.height} | nearPlane=${info.nearPlane} ` +
        `farPlane=${info.farPlane}`);
    console.log(`[camera] controlFlags: ${describeControlFlags(info.controlFlags)}`);
    return true;
}

/* One frame is one cameraRays broadcast: the payload the server pushes while a camera is subscribed. */
function printFrame(index, rays) {
    const entities = Array.isArray(rays.entities) ? rays.entities : [];
    const rayBytes = rays.rayData ? rays.rayData.length : 0;

    console.log(`[camera] frame ${index}: rayData=${rayBytes} B | sampleOffset=${rays.sampleOffset} | ` +
        `distance=${rays.distance} | verticalFov=${rays.verticalFov} | entities=${entities.length}`);

    for (const entity of entities.slice(0, 10)) {
        console.log(`[camera]   entity: ${entityTypeName(entity.type)} id=${entity.entityId} ` +
            `name=${entity.name === undefined ? '-' : `"${entity.name}"`} pos=${position(entity)}`);
    }
}
function summarise(frames, seconds, frameCount = frames.length) {
    if (frames.length === 0) {
        console.log('[camera] no cameraRays frame arrived - the server does not stream this camera.');
        return;
    }

    const raySizes = frames.map((frame) => (frame.rayData ? frame.rayData.length : 0));
    const entities = frames.flatMap((frame) => (Array.isArray(frame.entities) ? frame.entities : []));
    const unique = new Map();
    for (const entity of entities) {
        const key = `${entity.type}:${entity.entityId}`;
        if (!unique.has(key)) unique.set(key, entity);
    }

    console.log(`[camera] ${frameCount} frame(s) in ${seconds} s = ${(frameCount / seconds).toFixed(2)} frames/s ` +
        `(the buffer of the library keeps the last ${frames.length})`);
    console.log(`[camera] rayData: min=${Math.min(...raySizes)} B max=${Math.max(...raySizes)} B ` +
        `(sum ${raySizes.reduce((a, b) => a + b, 0)} B)`);
    console.log(`[camera] entities: ${entities.length} entr(y/ies) in the kept frames, ${unique.size} unique`);

    for (const entity of unique.values()) {
        console.log(`[camera]   unique: ${entityTypeName(entity.type)} id=${entity.entityId} ` +
            `name=${entity.name === undefined ? '-' : `"${entity.name}"`} pos=${position(entity)} ` +
            `size=${entity.size ? `${entity.size.x}/${entity.size.y}/${entity.size.z}` : '?'}`);
    }
}

async function main() {
    let options = null;
    try {
        options = parseArgs(process.argv.slice(2));
    }
    catch (e) {
        console.error(`[camera] ${e.message}`);
        printHelp();
        process.exit(1);
    }

    if (options.help) {
        printHelp();
        return;
    }

    let guildId = options.guildId;
    if (guildId === null) {
        const guildIds = listInstanceFiles();
        if (guildIds.length !== 1) {
            console.error(`[camera] could not determine the instance file automatically ` +
                `(found ${guildIds.length}). Use --guild=<guildId>.`);
            process.exit(1);
        }
        guildId = guildIds[0];
    }

    const instance = readInstance(guildId);
    const serverId = options.serverId || instance.activeServer;
    const server = instance.serverList[serverId];

    if (!server) {
        console.error(`[camera] unknown server "${serverId}" for guild ${guildId}. ` +
            `Known: ${Object.keys(instance.serverList).join(', ')}`);
        process.exit(1);
    }

    /*
        The player token is per server and rotates every time the server is paired again. A stale token connects fine but
        every request is answered with AppError not_found (see the troubleshooting notes of the community clients), so
        it can be passed in explicitly when the instance file is older than the pairing.
    */
    if (options.playerToken === null) options.playerToken = server.playerToken;

    console.log(`[camera] guild=${guildId} server=${serverId} title="${server.title}" ` +
        `endpoint=${server.serverIp}:${server.appPort} steamId=${server.steamId} camera=${options.camera} ` +
        `playerToken=${options.playerToken}${options.playerToken === undefined ? ' (missing)' : ''}`);

    const rustplus = new RustPlusLib(server.serverIp, server.appPort, server.steamId, options.playerToken);

    rustplus.on('error', (e) => console.log(`[camera] socket error: ${e && e.message ? e.message : e}`));

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout while connecting')), options.timeoutMs);

        rustplus.on('connected', () => {
            clearTimeout(timer);
            resolve();
        });

        const auth = RustPlusAuth.readAuth(server.steamId);
        if (server.guid && auth && auth.token) {
            console.log(`[camera] using the authenticated relay socket for ${server.guid}`);
            RustPlusSocket.connectAuthenticatedSocket(rustplus, server.guid, auth.token);
        }
        else {
            console.log('[camera] no stored login, falling back to the direct connection');
            rustplus.connect();
        }
    });

    console.log('[camera] connected.');

    /*
        Several codes at once: only tells whether the server knows them (used to find the codes of a map). Raw requests
        instead of one Camera instance per code, those would add a listener per code to the instance.
    */
    if (options.camera.includes(',')) {
        for (const code of options.camera.split(',').map((entry) => entry.trim()).filter(Boolean)) {
            let response = null;

            try {
                response = await rustplus.sendRequestAsync({ cameraSubscribe: { cameraId: code } }, options.timeoutMs);
            }
            catch (e) {
                console.log(`[camera] ${code}: ${describeCameraError(e)}`);
                continue;
            }

            const info = response && response.cameraSubscribeInfo;
            console.log(`[camera] ${code}: ok - ${info ? `${info.width}x${info.height} ` +
                `controlFlags=${describeControlFlags(info.controlFlags)}` : 'no cameraSubscribeInfo'}`);

            await rustplus.sendRequestAsync({ cameraUnsubscribe: {} }, options.timeoutMs).catch(() => undefined);
        }

        process.exit(0);
    }
    const camera = rustplus.getCamera(options.camera);
    let renders = 0;
    let frames = 0;
    let pngPath = null;

    /* Every cameraRays broadcast carries only a part of the image (sampleOffset), the render builds up over frames. */
    const originalOnCameraRays = camera._onCameraRays.bind(camera);
    camera._onCameraRays = async (rays) => {
        frames += 1;
        return await originalOnCameraRays(rays);
    };

    camera.on('render', (buffer) => {
        renders += 1;

        if (options.png) {
            const tempDir = Path.join(__dirname, '..', 'temp');
            Fs.mkdirSync(tempDir, { recursive: true });

            if (pngPath === null) pngPath = Path.join(tempDir, `camera-${options.camera}-${Date.now()}.png`);

            /* Overwritten on every render, so the file always holds the most complete frame. */
            Fs.writeFileSync(pngPath, buffer);
        }
    });

    console.log(`[camera] subscribing to "${options.camera}" ...`);
    try {
        await camera.subscribe();
    }
    catch (e) {
        /* sendRequestAsync rejects with the AppError object of the server, not with an Error instance. */
        console.error(`[camera] subscribe failed: ${describeCameraError(e)}`);
        process.exit(1);
    }

    if (!printSubscribeInfo(camera.cameraSubscribeInfo)) {
        await camera.unsubscribe();
        process.exit(2);
    }

    /* Wait for the frames the server pushes and look at them while they arrive. */
    const seconds = Math.round(options.seconds);
    for (let step = 0; step < seconds; step++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (step % 5 === 4) console.log(`[camera] ${step + 1} s: ${frames} frame(s), ${renders} render(s)`);
    }

    summarise(camera.cameraRays, seconds, frames);
    console.log(`[camera] rendered frames: ${renders}${pngPath === null ? '' : ` (png: ${pngPath})`}`);

    await camera.unsubscribe();
    console.log('[camera] unsubscribed.');

    process.exit(0);
}

main().catch((e) => {
    console.error(`[camera] ${e && e.message ? e.message : e}`);
    process.exit(1);
});



