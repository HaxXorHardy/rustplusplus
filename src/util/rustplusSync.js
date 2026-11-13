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
    The account state of the Rust+ app (`POST /api/syncData`) already contains everything the bot needs to set up a
    server without the app: the pairing id of the server, the player token and the paired entities (switches,
    alarms, storage monitors) with their ids and names.

    This module turns that payload into server entries of the instance file, so no FCM credentials are required for
    the setup. FCM is only needed for the push notifications of the Rust+ app.
*/

const Constants = require('./constants.js');
const RustPlusTransport = require('./rustplusTransport.js');

/* AppEntityType of rustplus.proto */
const ENTITY_TYPES = {
    SWITCH: 1,
    ALARM: 2,
    STORAGE_MONITOR: 3,
};

/* Server key used when the account state has no ip/port for a server (the relay does not need them). */
const RELAY_SERVER_IP = RustPlusTransport.RELAY_SERVER_IP;

/* The pairing token is an int32 in the protocol: the history returns it as a string, the account state as a number. */
function normalizePlayerToken(value) {
    if (value === null || value === undefined) return null;

    const number = Number(value);
    return Number.isFinite(number) ? number : value;
}

/* protobuf.js represents 64 bit numbers as { low, high }; entity ids fit in 32 bit today. */
function toEntityIdString(entityId) {
    if (entityId === null || entityId === undefined) return null;
    if (typeof entityId === 'string') return entityId;
    if (typeof entityId === 'number') return `${entityId}`;

    if (typeof entityId.low !== 'number') return null;

    const value = (BigInt(entityId.high >>> 0) << 32n) | BigInt(entityId.low >>> 0);
    return value.toString();
}

/* Cameras of the account state, the Rust+ app lists them for the CCTV codes. */
function parseCameras(cameras) {
    if (!Array.isArray(cameras)) return [];

    return cameras
        .filter((camera) => camera && camera.identifier)
        .map((camera) => ({ identifier: `${camera.identifier}`, icon: camera.icon ? `${camera.icon}` : null }));
}

/* Paired entities of the account state, grouped by AppEntityType. */
function parseDevices(entityCategories) {
    const devices = [];

    for (const category of Array.isArray(entityCategories) ? entityCategories : []) {
        for (const entity of Array.isArray(category && category.entities) ? category.entities : []) {
            const id = toEntityIdString(entity.entityId);
            if (id === null) continue;

            devices.push({
                id: id,
                type: entity.type,
                name: entity.name ? `${entity.name}` : null,
                icon: entity.icon ? `${entity.icon}` : null,
            });
        }
    }

    return devices;
}

/*
    The persisted app state (a JSON string, or the already parsed object) as servers with their paired entities.
*/
function parseSyncPayload(payload) {
    const data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
    const servers = data && Array.isArray(data.servers) ? data.servers : [];

    return {
        currentServerId: (data && data.currentServerId) ? `${data.currentServerId}` : null,
        servers: servers.map((server) => ({
            id: server.id ? `${server.id}` : null,
            name: server.name ? `${server.name}` : null,
            playerToken: server.playerToken,
            playerId: toEntityIdString(server.playerId),
            headerImage: server.headerImage ? `${server.headerImage}` : null,
            logoImage: server.logoImage ? `${server.logoImage}` : null,
            url: server.url ? `${server.url}` : null,
            desc: server.desc ? `${server.desc}` : null,
            map: server.map ? `${server.map}` : null,
            mapSize: Number.isFinite(server.mapSize) ? server.mapSize : null,
            seed: Number.isFinite(server.seed) ? server.seed : null,
            wipeTime: (server.wipeTime && Number.isFinite(server.wipeTime.unix)) ? server.wipeTime.unix : null,
            isSubscribed: server.isSubscribed === true,
            cameras: parseCameras(server.cameras),
            devices: parseDevices(server.entityCategories),
        })),
    };
}
/* Defaults of a server entry, the shape the rest of the bot expects (see util/createInstanceFile.js). */
function createServerEntry(data, existing, steamId, options = {}) {
    const entry = Object.assign({
        title: data.name || 'Rust+ server',
        serverIp: data.ip || RELAY_SERVER_IP,
        appPort: data.port || data.id,
        guid: data.id,
        steamId: steamId ? `${steamId}` : null,
        playerToken: normalizePlayerToken(data.playerToken),
        description: data.desc || '',
        img: data.headerImage || Constants.DEFAULT_SERVER_IMG,
        url: data.url || Constants.DEFAULT_SERVER_URL,
        notes: {},
        switches: {},
        alarms: {},
        storageMonitors: {},
        markers: {},
        switchGroups: {},
        messageId: null,
        battlemetricsId: null,
        connect: null,
        cargoShipEgressTimeMs: Constants.DEFAULT_CARGO_SHIP_EGRESS_TIME_MS,
        oilRigLockedCrateUnlockTimeMs: Constants.DEFAULT_OIL_RIG_LOCKED_CRATE_UNLOCK_TIME_MS,
        deepSeaMinWipeCooldownMs: Constants.DEFAULT_DEEP_SEA_MIN_WIPE_COOLDOWN_MS,
        deepSeaMaxWipeCooldownMs: Constants.DEFAULT_DEEP_SEA_MAX_WIPE_COOLDOWN_MS,
        deepSeaWipeDurationMs: Constants.DEFAULT_DEEP_SEA_WIPE_DURATION_MS,
        timeTillDay: null,
        timeTillNight: null,
        customCameraGroups: {},
        watchedCameras: {},
    }, existing || {});

    /*
        The account state decides about the pairing id, the name and the pairing credentials. `keepCredentials` leaves
        the credentials of a known server alone: the server list of the login is a snapshot that the notification
        history supersedes, writing it back would keep asking the server with an old player token.
    */
    if (data.name) entry.title = data.name;
    if (!options.keepCredentials || !existing || !existing.guid) entry.guid = data.id;

    if ((!options.keepCredentials || !existing || existing.playerToken === null || existing.playerToken === undefined) &&
        data.playerToken !== undefined && data.playerToken !== null) {
        entry.playerToken = normalizePlayerToken(data.playerToken);
    }

    if (!entry.steamId && steamId) entry.steamId = `${steamId}`;

    return entry;
}

/*
    Entity ids of a server that were removed in Discord. The account state and the history keep listing them, so the
    deletion has to be remembered or every refresh would adopt the device again.
*/
function getDeletedDevices(instance, serverGuid) {
    const guid = `${serverGuid === undefined || serverGuid === null ? '' : serverGuid}`;
    const deleted = (guid !== '' && instance.deletedDevices) ? instance.deletedDevices[guid] : null;

    return (deleted && typeof deleted === 'object') ? deleted : Object.create(null);
}

/* Marks a device that was removed in Discord, so the account state cannot adopt it again. */
function markDeviceDeleted(instance, server, entityId) {
    const guid = (server && server.guid) ? `${server.guid}` : '';
    if (guid === '') return false;

    if (!instance.deletedDevices) instance.deletedDevices = {};
    if (!instance.deletedDevices[guid]) instance.deletedDevices[guid] = {};

    instance.deletedDevices[guid][`${entityId}`] = Date.now();

    return true;
}

/* A pairing that happened after the removal brings the device back. */
function clearDeletedDevice(instance, serverGuid, entityId) {
    const deleted = getDeletedDevices(instance, serverGuid);
    if (!deleted[`${entityId}`]) return false;

    delete deleted[`${entityId}`];

    return true;
}

/*
    A server can pair the account again with a new pairing id. The removals of the devices are stored per pairing id,
    so they are moved along: a device that was removed in Discord stays removed until it is paired again, no matter
    which pairing id the server has now.
*/
function migrateDeletedDevices(instance, oldGuid, newGuid) {
    const from = `${oldGuid === undefined || oldGuid === null ? '' : oldGuid}`;
    const to = `${newGuid === undefined || newGuid === null ? '' : newGuid}`;

    if (from === '' || to === '' || from === to) return false;
    if (!instance.deletedDevices || !instance.deletedDevices[from]) return false;

    if (Object.keys(instance.deletedDevices[from]).length === 0) {
        delete instance.deletedDevices[from];
        return false;
    }

    if (!instance.deletedDevices[to]) instance.deletedDevices[to] = {};

    /* A mark of the new pairing id was made later, it wins over the moved one. */
    instance.deletedDevices[to] = Object.assign({}, instance.deletedDevices[from], instance.deletedDevices[to]);
    delete instance.deletedDevices[from];

    return true;
}

/* Adds the paired entities of the account state that the entry does not know yet. */
function addDevices(server, data, intlGet, deleted = null) {
    let added = 0;
    const removed = deleted || Object.create(null);

    for (const device of data.devices || []) {
        const id = device.id;

        /* A device that was removed in Discord stays removed until it is paired again. */
        if (removed[id]) continue;

        if (device.type === ENTITY_TYPES.SWITCH) {
            if (server.switches[id]) continue;

            server.switches[id] = {
                active: false,
                reachable: true,
                name: device.name || intlGet('smartSwitch'),
                command: id,
                image: 'smart_switch.png',
                autoDayNightOnOff: 0,
                location: null,
                x: null,
                y: null,
                server: server.title,
                proximity: Constants.PROXIMITY_SETTING_DEFAULT_METERS,
                messageId: null,
            };
            added++;
        }
        else if (device.type === ENTITY_TYPES.ALARM) {
            if (server.alarms[id]) continue;

            server.alarms[id] = {
                active: false,
                reachable: true,
                everyone: false,
                name: device.name || intlGet('smartAlarm'),
                message: intlGet('baseIsUnderAttack'),
                lastTrigger: null,
                command: id,
                id: id,
                image: 'smart_alarm.png',
                location: null,
                server: server.title,
                messageId: null,
            };
            added++;
        }
        else if (device.type === ENTITY_TYPES.STORAGE_MONITOR) {
            if (server.storageMonitors[id]) continue;

            server.storageMonitors[id] = {
                name: device.name || intlGet('storageMonitor'),
                reachable: true,
                id: id,
                type: null,
                decaying: false,
                upkeep: null,
                everyone: false,
                inGame: true,
                image: 'storage_monitor.png',
                location: null,
                server: server.title,
                messageId: null,
            };
            added++;
        }
    }

    return added;
}

function normalizeName(name) {
    return `${name === undefined || name === null ? '' : name}`.trim().toLowerCase();
}

/*
    Writes the servers and paired entities of the account state into the instance: an entry is matched by pairing
    id, then by name, and created with the relay key when the bot does not know the server yet.
*/
function applySyncServers(instance, steamId, servers, intlGet = (key) => key, options = {}) {
    const result = { servers: 0, created: 0, devices: 0, updated: 0, updatedKeys: [], skipped: [] };

    for (const data of servers || []) {
        if (!data || !data.id) continue;

        /*
            A server that the user removed in Discord stays removed, even though the account is still paired with it.
            A new pairing in the Rust+ app clears that mark (see rustplusHistory.applyPairingEntries).
        */
        if (!options.includeDeleted && instance.deletedServers && instance.deletedServers[data.id]) {
            result.skipped.push(`${data.id}`);
            continue;
        }

        const keys = Object.keys(instance.serverList || {});

        let serverId = keys.find((key) => instance.serverList[key] && instance.serverList[key].guid === data.id);
        if (!serverId && data.name) {
            serverId = keys.find((key) =>
                instance.serverList[key] && normalizeName(instance.serverList[key].title) === normalizeName(data.name));
        }

        const existing = serverId ? instance.serverList[serverId] : null;
        const entry = createServerEntry(data, existing, steamId, options);

        /*
            The pairing id of a known server can change. The device removals are stored per pairing id, so they are
            moved along before the devices of the account are adopted.
        */
        if (existing && `${existing.guid}` !== `${entry.guid}`) {
            migrateDeletedDevices(instance, existing.guid, entry.guid);
        }

        /* A new pairing of the same server changes the token (and sometimes the pairing id) of the entry. */
        const credentialsChanged = existing !== null &&
            (`${existing.guid}` !== `${entry.guid}` ||
                `${existing.playerToken}` !== `${entry.playerToken}`);

        result.devices += addDevices(entry, data, intlGet, getDeletedDevices(instance, entry.guid));
        if (!existing) result.created++;

        /* The key of the instance is <ip>-<appPort>, which is the pairing id when no address is known. */
        const key = serverId || `${entry.serverIp}-${entry.appPort}`;

        instance.serverList[key] = entry;
        result.servers++;

        /* The rest of the bot expects a lite mirror for every server, also for one that is adopted while it runs. */
        ensureServerListLiteEntry(instance, key, entry);

        if (credentialsChanged) {
            result.updated++;
            result.updatedKeys.push(key);
        }
    }

    return result;
}

/*
    serverListLite mirrors the credentials of every server per steam id (see util/createInstanceFile.js). It is created
    here as well, because servers that are adopted while the bot runs never pass the repair of the instance file.
*/
function ensureServerListLiteEntry(instance, key, entry) {
    if (!instance.serverListLite) instance.serverListLite = {};
    if (!instance.serverListLite[key]) instance.serverListLite[key] = {};

    if (entry && entry.steamId && !instance.serverListLite[key][entry.steamId]) {
        instance.serverListLite[key][entry.steamId] = {
            serverIp: entry.serverIp,
            appPort: entry.appPort,
            steamId: entry.steamId,
            playerToken: entry.playerToken,
        };
    }
}

/*
    The lite mirror of a server (`serverListLite[serverId]`, keyed by steam id). It is empty when the server has none,
    which keeps the callers safe: they run Object.keys() on it.
*/
function getServerListLiteEntry(instance, serverId) {
    const lite = (instance && instance.serverListLite) ? instance.serverListLite[serverId] : null;

    return (lite && typeof lite === 'object') ? lite : {};
}

module.exports = {
    ENTITY_TYPES: ENTITY_TYPES,
    RELAY_SERVER_IP: RELAY_SERVER_IP,
    toEntityIdString: toEntityIdString,
    normalizePlayerToken: normalizePlayerToken,
    parseSyncPayload: parseSyncPayload,
    createServerEntry: createServerEntry,
    addDevices: addDevices,
    getDeletedDevices: getDeletedDevices,
    markDeviceDeleted: markDeviceDeleted,
    clearDeletedDevice: clearDeletedDevice,
    migrateDeletedDevices: migrateDeletedDevices,
    applySyncServers: applySyncServers,
    ensureServerListLiteEntry: ensureServerListLiteEntry,
    getServerListLiteEntry: getServerListLiteEntry,
};

