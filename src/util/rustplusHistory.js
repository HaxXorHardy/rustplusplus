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
    The notification history of the Rust+ account (`POST /api/history/read`), the same list the app and the website
    show. It contains the pairing notifications of servers and entities with everything needed to adopt them:

        { title: "Smart Switch", body: "Tap to pair with this device.",
          data: "{\"id\":\"<server uuid>\",\"name\":\"...\",\"ip\":\"...\",\"port\":\"...\",
                  \"playerToken\":123,\"entityId\":\"116582\",\"entityType\":\"1\",\"entityName\":\"Smart Switch\"}" }

    FCM used to be the only way to see these, this endpoint makes the bot independent of it.
*/

const Axios = require('axios');

const Config = require('../../config');
const RustPlusLoginPages = require('./rustplusLoginPages.js');
const RustPlusAuth = require('./rustplusAuth.js');
const RustPlusLogin = require('./rustplusLogin.js');
const RustPlusSync = require('./rustplusSync.js');
const TokenRecovery = require('./tokenRecovery.js');

const HISTORY_URL = 'https://companion-rust.facepunch.com/api/history/read';

/*
    The pairing payloads are marked with type "server" (the server pairs the player again and sends the credentials)
    or "entity" (a device was paired). Alarm notifications carry neither and are ignored here.
*/

async function fetchHistory(token) {
    const response = await Axios.post(HISTORY_URL, { AuthToken: token }, {
        timeout: 30000,
        validateStatus: () => true,
        headers: {
            'user-agent': RustPlusLoginPages.USER_AGENT,
            accept: 'application/json',
            'content-type': 'application/json',
        },
    });

    if (response.status === 204) return [];
    if (response.status !== 200) {
        /* The status lets the caller tell a rejected token (401/403) from a temporary failure. */
        const error = new Error(`History request failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
    }

    return Array.isArray(response.data) ? response.data : [];
}

/*
    The pairing notifications of the history, newest first, one entry per device.

    A death notification ("You were killed by ...") carries no pairing data, it is kept as `kind: 'death'` and used for
    the direct message the FCM listener used to send (see discordMessages.sendDeathDirectMessage).
*/
function parsePairingEntries(entries) {
    const result = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || typeof entry.data !== 'string') continue;

        let data = null;
        try {
            data = JSON.parse(entry.data);
        }
        catch (e) {
            continue;
        }

        if (!data) continue;

        if (`${data.type}` === 'death') {
            result.push({
                notificationId: entry.notificationId,
                date: entry.date ? `${entry.date}` : null,
                kind: 'death',
                serverId: null,
                serverName: data.name ? `${data.name}` : null,
                playerId: data.playerId ? `${data.playerId}` : null,
                /* The app shows `title` ("You were killed by ...") and names the server in `body`. */
                text: entry.title ? `${entry.title}` : null,
                body: entry.body ? `${entry.body}` : null,
            });
            continue;
        }

        if (!data.id) continue;

        const entityType = Number(data.entityType);

        result.push({
            notificationId: entry.notificationId,
            date: entry.date ? `${entry.date}` : null,
            kind: `${data.type}`,
            serverId: `${data.id}`,
            serverName: data.name ? `${data.name}` : null,
            ip: data.ip ? `${data.ip}` : null,
            port: data.port ? `${data.port}` : null,
            playerToken: data.playerToken,
            playerId: data.playerId ? `${data.playerId}` : null,
            /* Only sent with server and device pairings, the alarm notifications carry none of them. */
            headerImage: data.img ? `${data.img}` : null,
            description: data.desc ? `${data.desc}` : null,
            url: data.url ? `${data.url}` : null,
            /* Servers are paired without an entity, they only carry the server data. */
            entityId: (data.entityId === undefined || data.entityId === null) ? null : `${data.entityId}`,
            entityType: Number.isFinite(entityType) ? entityType : null,
            entityName: data.entityName ? `${data.entityName}` : null,
        });
    }

    return result;
}

/*
    The pairing token that the newest notification of every server carries. The history keeps every pairing of a
    server, so replaying the older ones must not keep flipping the token around (that looked like a renewal on every
    run and made the instance reconnect every few minutes).
*/
function newestPlayerTokens(entries) {
    const tokens = new Map();

    /* The history is newest first, so the first notification of a server carries its current token. */
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !entry.serverId) continue;
        if (entry.playerToken === undefined || entry.playerToken === null) continue;

        if (!tokens.has(entry.serverId)) tokens.set(entry.serverId, entry.playerToken);
    }

    return tokens;
}

/* The pairing credentials of every server entry, to tell a real renewal from the replay of the history. */
function credentialsSnapshot(instance) {
    const snapshot = new Map();

    for (const [key, server] of Object.entries(instance.serverList || {})) {
        if (server) snapshot.set(key, `${server.guid}|${server.playerToken}`);
    }

    return snapshot;
}

/*
    Writes the paired servers and devices of the history into the instance. Existing entries are matched by pairing
    id, then by name, so nothing is duplicated.

    The history contains both kinds of pairing: `server` entries renew the credentials of a server (the server sends
    a new player token when it is paired again, for example after a wipe), `entity` entries add a device. The list is
    newest first, so it is applied oldest first and the newest pairing decides about the player token.
*/
function applyPairingEntries(instance, steamId, entries, intlGet = (key) => key) {
    const result = { servers: 0, created: 0, devices: 0, updated: 0, updatedKeys: [], added: [] };
    const tokens = newestPlayerTokens(entries);
    const before = credentialsSnapshot(instance);

    for (const entry of [...(entries || [])].reverse()) {
        if (!entry || !entry.serverId) continue;

        /* Alarm notifications have neither an entity nor credentials, they only report an attack. */
        const hasCredentials = entry.playerToken !== undefined && entry.playerToken !== null;
        if (entry.entityId === null && !hasCredentials) continue;

        /*
            A pairing of a server that was removed in Discord brings the server back - but only when the pairing is
            newer than the deletion, otherwise the history would undo every deletion again and again. The devices keep
            their own markers: a device that was removed in Discord only comes back when it is paired again, not when
            the server is paired again (see the entity branch below).
        */
        const deletedAt = instance.deletedServers ? instance.deletedServers[entry.serverId] : null;
        if (deletedAt) {
            const pairedAt = entry.date ? Date.parse(entry.date) : NaN;

            if (!Number.isFinite(pairedAt) || pairedAt <= deletedAt) continue;

            delete instance.deletedServers[entry.serverId];
        }

        /*
            A device that was removed in Discord comes back when it was paired again afterwards - the same rule the
            server markers follow.
        */
        if (entry.entityId !== null) {
            const removedAt = Number(RustPlusSync.getDeletedDevices(instance, entry.serverId)[entry.entityId]);
            const pairedAt = entry.date ? Date.parse(entry.date) : NaN;

            if (removedAt && Number.isFinite(pairedAt) && pairedAt > removedAt) {
                RustPlusSync.clearDeletedDevice(instance, entry.serverId, entry.entityId);
            }
        }

        const applied = RustPlusSync.applySyncServers(instance, steamId, [{
            id: entry.serverId,
            name: entry.serverName,
            ip: entry.ip,
            port: entry.port,
            /* The newest pairing of the server decides about the token, older ones are only replayed for devices. */
            playerToken: tokens.has(entry.serverId) ? tokens.get(entry.serverId) : entry.playerToken,
            headerImage: entry.headerImage,
            desc: entry.description,
            url: entry.url,
            devices: entry.entityId === null ? [] : [{
                id: entry.entityId,
                type: entry.entityType,
                name: entry.entityName,
            }],
        }], intlGet);

        result.servers += applied.servers;
        result.created += applied.created;
        result.devices += applied.devices;

        if (applied.devices !== 0 && entry.entityId !== null) {
            const serverKey = Object.keys(instance.serverList)
                .find((key) => instance.serverList[key] && instance.serverList[key].guid === entry.serverId);

            result.added.push({
                serverKey: serverKey || null,
                entityId: entry.entityId,
                entityType: entry.entityType,
            });
        }
    }

    /*
        Only a server whose stored credentials differ from the ones before the replay was renewed. The history holds
        every pairing of a server, so the intermediate states of the replay are no renewal.
    */
    for (const [key, credentials] of credentialsSnapshot(instance)) {
        if (before.has(key) && before.get(key) !== credentials) result.updatedKeys.push(key);
    }

    result.updated = result.updatedKeys.length;

    return result;
}

/* The time of the newest death that was already reported for this account, null when none was reported yet. */
function getReportedDeath(instance, steamId) {
    const reported = (instance.historyDeaths || {})[`${steamId}`];
    const value = Number(reported);

    return Number.isFinite(value) ? value : null;
}

function setReportedDeath(instance, steamId, at) {
    if (!instance.historyDeaths) instance.historyDeaths = {};

    instance.historyDeaths[`${steamId}`] = at;
}

/*
    The steam accounts a guild reads: the account of its active (or first) server, or every stored login when the
    guild has no server at all (everything was removed, or a fresh container that only carries the stored login).
*/
function steamIdsOfGuild(instance) {
    const serverList = instance.serverList || {};
    const server = serverList[instance.activeServer] || serverList[Object.keys(serverList)[0]];

    return (server && server.steamId) ? [`${server.steamId}`] : RustPlusAuth.listSteamIds();
}

/*
    Reads the account state and the notification history of one account - once per run, however many guilds use it.
    A token the API rejects goes to util/tokenRecovery.js; a renewal that worked is used right away. Returns null when
    the account cannot be read now.
*/
async function readAccount(client, guildId, steamId, fetchHistoryFn, fetchSyncFn, now = Date.now()) {
    /* A token that keeps being rejected is left alone until the backoff of the recovery is over. */
    if (TokenRecovery.isBackedOff(steamId)) return null;

    /* The history refused a token that a live socket proves: no new read (and no log line) until the pause is over. */
    const pausedUntil = historyPausedUntil.get(`${steamId}`);
    if (pausedUntil !== undefined && pausedUntil > now) return null;

    let auth = RustPlusAuth.readAuth(steamId);
    if (auth === null) return null;

    const read = async () => ({
        accountServers: await readAccountServers(client, steamId, auth, fetchSyncFn),
        entries: parsePairingEntries(await fetchHistoryFn(auth.token)),
    });

    let result = null;

    try {
        result = await read();
    }
    catch (e) {
        if (!isAuthFailure(e)) throw e;

        /* One policy for every source of a rejected token: strikes, throttle, renewal, rebuild of the sockets. */
        const recovery = await TokenRecovery.reportRejected(client, guildId, steamId,
            `the history read was refused with ${e.status}`);

        /*
            The token works (a socket with it answers its polls), only the history refuses it - measured: about 30
            minutes after every renewal at a 15 s interval. Asking again every 15 s changes nothing and fills the
            log, so the history of this account is paused.
        */
        if (recovery !== 'renewed' && TokenRecovery.liveSocketOf(client, steamId) !== null) {
            historyPausedUntil.set(`${steamId}`, Date.now() + HISTORY_REFUSED_PAUSE_MS);

            client.log(client.intlGet(null, 'infoCap'),
                `The Rust+ history of ${steamId} was refused with ${e.status} while the connection works with the ` +
                `same token, it is read again in ${HISTORY_REFUSED_PAUSE_MS / 60000} minutes.`, 'debug');
            return null;
        }

        /* A renewal that worked is used right away, everything else waits for the next run. */
        if (recovery !== 'renewed') throw e;

        auth = RustPlusAuth.readAuth(steamId);
        if (auth === null) throw e;

        accountStateCache.delete(`${steamId}`);
        result = await read();
    }

    /* The token works, a rejection that follows starts at one again. */
    TokenRecovery.markReadSuccessful(steamId);
    historyPausedUntil.delete(`${steamId}`);

    if (result.accountServers !== null) {
        /* Keep the stored snapshot current, the token renewal and the login use it. */
        try {
            RustPlusAuth.writeAuth(steamId, Object.assign({}, RustPlusAuth.readAuth(steamId) || auth,
                { servers: result.accountServers }));
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `Could not store the account state of ${steamId}: ${e && e.message ? e.message : e}`, 'debug');
        }
    }

    return { auth: auth, accountServers: result.accountServers, entries: result.entries };
}

/*
    The death notifications of the account that were not reported to this guild yet, oldest first. The newest reported
    one is remembered per account, so the replay of the history does not repeat it. The first run only records the
    newest one: the history keeps old deaths and nobody wants them as a direct message days later.
*/
function takeNewDeaths(instance, steamId, entries) {
    const reportedDeath = getReportedDeath(instance, steamId);
    const deathEntries = entries
        .filter((entry) => entry.kind === 'death')
        .map((entry) => ({ entry: entry, at: entry.date ? Date.parse(entry.date) : NaN }))
        .filter((death) => Number.isFinite(death.at));

    if (deathEntries.length === 0) return { changed: false, deaths: [] };

    if (reportedDeath === null) {
        setReportedDeath(instance, steamId, Math.max(...deathEntries.map((death) => death.at)));
        return { changed: true, deaths: [] };
    }

    const newDeaths = deathEntries.filter((death) => death.at > reportedDeath);
    if (newDeaths.length === 0) return { changed: false, deaths: [] };

    setReportedDeath(instance, steamId, Math.max(...newDeaths.map((death) => death.at)));

    return { changed: true, deaths: [...newDeaths].reverse().map((death) => death.entry) };
}

/*
    Writes what one account knows into one guild: deaths, the paired servers and devices, the unpaired servers. Returns
    the devices that were added and the deaths to report.
*/
function applyAccount(client, guildId, instance, steamId, account) {
    const intlGet = (key) => client.intlGet(guildId, key);
    const { auth, accountServers, entries } = account;
    const added = [];

    const death = takeNewDeaths(instance, steamId, entries);
    let changed = death.changed;

    /*
        Only the account state is a complete list of the pairings, the history drops old notifications. So a server is
        only marked as unpaired when the account state could be read, and never while its connection works.
    */
    const pairedIds = (accountServers === null) ? null : pairedServerIds(accountServers, entries);
    if (markUnpairedServers(client, instance, pairedIds, guildId) !== 0) changed = true;

    const servers = (accountServers === null) ? (auth.servers || []) : accountServers;

    /*
        The account state is fresh but not complete: the app does not always list a server that was paired in-game, and
        its token can lag behind. So it never overwrites a token, only fills in what is missing. The history is applied
        after it and decides about the newest player token.
    */
    const synced = RustPlusSync.applySyncServers(instance, steamId, servers, intlGet, { keepCredentials: true });

    const applied = (entries.length === 0) ? emptyPairingResult() :
        applyPairingEntries(instance, steamId, entries, intlGet);

    if (synced.created !== 0 || synced.updated !== 0 || applied.devices !== 0 ||
        applied.created !== 0 || applied.updated !== 0) {
        changed = true;
    }

    if (!changed) return { added: added, deaths: death.deaths };

    /*
        Only a run that adopted something activates a server. A guild whose connection was ended in Discord
        (activeServer === null by the disconnect button) stays disconnected: the user decided that, the refresh must not
        connect it again every five minutes.
    */
    const firstServerKey = Object.keys(instance.serverList)
        .find((key) => instance.serverList[key] && instance.serverList[key].paired !== false);
    let activatedKey = null;

    if (instance.activeServer === null && firstServerKey && (synced.created !== 0 || applied.created !== 0 ||
        applied.devices !== 0 || applied.updated !== 0)) {
        instance.activeServer = firstServerKey;
        activatedKey = firstServerKey;

        client.log(client.intlGet(null, 'infoCap'),
            `Activating "${instance.serverList[firstServerKey].title}", the guild had no active server.`);
    }

    client.setInstance(guildId, instance);

    for (const device of applied.added) added.push({ guildId: guildId, ...device });

    /* Only a pairing notification tells about a new player token, the account snapshot does not. */
    reconnectRenewedServers(client, guildId, instance, applied.updatedKeys);

    /* A server that is adopted while the bot runs has no connection: the startup connects the servers only once. */
    const activatedServer = activatedKey ? instance.serverList[activatedKey] : null;
    const alreadyConnected = client.rustplusInstances && client.rustplusInstances[guildId];

    if (activatedServer && !alreadyConnected) {
        client.createRustplusInstance(guildId, activatedServer.serverIp, activatedServer.appPort,
            activatedServer.steamId, activatedServer.playerToken);
    }

    return { added: added, deaths: death.deaths };
}

/*
    Runs on a timer: adopts servers and devices that were paired in-game since the last run and returns the devices
    that were added, so the caller can post their Discord messages. Deaths of the account are reported as well
    (`deaths`), they replace the direct message the removed FCM listener sent.

    Every account is read once per run and applied to every guild that uses it (the old version asked Facepunch once
    per guild). options.steamIds limits the run to these accounts (the targeted refresh of a connection).
*/
async function refresh(client, fetchHistoryFn = fetchHistory, fetchSyncFn = RustPlusLogin.fetchSyncData,
    options = {}) {
    const added = [];
    const deaths = [];

    const only = Array.isArray(options.steamIds) ? options.steamIds.map((id) => `${id}`) : null;

    /* A run that was asked for by a pairing (push notification) must not answer from the cached account state. */
    if (options.freshAccountState && only !== null) {
        for (const steamId of only) accountStateCache.delete(steamId);
    }

    /* steamId -> guild ids, in the order of the guilds. */
    const accounts = new Map();

    for (const guildId of Object.keys(client.instances || {})) {
        let instance = null;

        try {
            instance = client.getInstance(guildId);
        }
        catch (e) {
            continue;
        }

        if (!instance) continue;

        for (const steamId of steamIdsOfGuild(instance)) {
            if (only !== null && !only.includes(`${steamId}`)) continue;

            if (!accounts.has(steamId)) accounts.set(steamId, []);
            accounts.get(steamId).push(guildId);
        }
    }

    for (const [steamId, guildIds] of accounts) {
        let account = null;

        try {
            account = await readAccount(client, guildIds[0], steamId, fetchHistoryFn, fetchSyncFn);
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `Could not read the pairing history of ${steamId}: ${e && e.message ? e.message : e}`, 'debug');
            continue;
        }

        if (account === null) continue;

        for (const guildId of guildIds) {
            try {
                const instance = client.getInstance(guildId);
                const result = applyAccount(client, guildId, instance, steamId, account);

                added.push(...result.added);

                for (const death of result.deaths) {
                    deaths.push({ guildId: guildId, steamId: steamId, death: death });
                }
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'),
                    `Could not apply the pairing history of ${steamId} to ${guildId}: ` +
                    `${e && e.message ? e.message : e}`, 'debug');
            }
        }
    }

    return { devices: added, deaths: deaths };
}

/*
    The targeted refresh of one account, for a connection whose server answers not_found (a new player token after a
    re-pairing). Throttled: a connection that keeps failing must not ask Facepunch on every reconnect.
*/
const ACCOUNT_REFRESH_MIN_MS = 2 * 60 * 1000;
const accountRefreshAt = new Map();   /* steamId -> ms */

async function refreshAccount(client, steamId, now = Date.now()) {
    const key = `${steamId}`;
    const last = accountRefreshAt.get(key);

    if (last !== undefined && (now - last) < ACCOUNT_REFRESH_MIN_MS) return null;

    accountRefreshAt.set(key, now);

    /* The account state is read fresh: a new pairing must not wait for the cache. */
    accountStateCache.delete(key);

    return await refresh(client, fetchHistory, RustPlusLogin.fetchSyncData, { steamIds: [key] });
}

/*
    The account state of the app is a slow snapshot: the history carries the pairings themselves, so a short history
    interval does not have to ask for the server list on every run. Cached per steam id for
    Config.general.rustplusSyncDataIntervalMs.
*/
const accountStateCache = new Map();   /* steamId -> { servers, at } */

/* How long the history of an account is not read after it refused a token that a live socket proves. */
const HISTORY_REFUSED_PAUSE_MS = 5 * 60 * 1000;
const historyPausedUntil = new Map();   /* steamId -> ms */

/*
    Facepunch rejects a token with 401 or 403 (the history read and the socket handshake alike). The policy for that
    lives in util/tokenRecovery.js: strikes, throttle, backoff, renewal and the reconnect after it.
*/
function resetAccountStateCache() {
    accountStateCache.clear();
    accountStateFailures.clear();
    accountRefreshAt.clear();
    historyPausedUntil.clear();
    TokenRecovery.reset();
}

/* Read here, renew there: a rejected token is reported to the recovery of the account. */
function isAuthFailure(error) {
    return Boolean(error) && (error.status === 401 || error.status === 403);
}

/* steamId -> ms of the last account state read that failed. */
const accountStateFailures = new Map();

function cachedAccountServers(steamId, now) {
    const cached = accountStateCache.get(`${steamId}`);
    if (!cached) return null;

    return ((now - cached.at) < Config.general.rustplusSyncDataIntervalMs) ? cached.servers : null;
}

/* The servers of the Rust+ account, or null when the state could not be read (then nothing is changed). */
async function readAccountServers(client, steamId, auth, fetchSyncFn, now = Date.now()) {
    const cached = cachedAccountServers(steamId, now);
    if (cached !== null) return cached;

    /* A refused account state is not asked again on every history run (that can be every few seconds). */
    const failedAt = accountStateFailures.get(`${steamId}`);
    if (failedAt !== undefined && (now - failedAt) < Config.general.rustplusSyncDataIntervalMs) return null;

    try {
        const sync = await fetchSyncFn(auth.token);
        if (!sync || !Array.isArray(sync.servers)) return null;

        accountStateCache.set(`${steamId}`, { servers: sync.servers, at: now });
        accountStateFailures.delete(`${steamId}`);

        return sync.servers;
    }
    catch (e) {
        /*
            Not even a 401/403 of the account state stops the run: it is only the slow snapshot, the history is the
            source of the pairings and decides about the token (measured live: /api/syncData answered 403 for hours
            while the socket and the history worked with the same token - and the 403 used to block the history).
        */
        accountStateFailures.set(`${steamId}`, now);

        client.log(client.intlGet(null, 'warningCap'),
            `Could not read the Rust+ account state of ${steamId} (${e && e.message ? e.message : e}), the history ` +
            `is read without it. Next attempt in ${Math.round(Config.general.rustplusSyncDataIntervalMs / 60000)} ` +
            'minute(s).', isAuthFailure(e) ? 'warn' : 'debug');

        return null;
    }
}

/* The pairing ids that the account state and the notification history know about. */
function pairedServerIds(accountServers, entries) {
    const ids = new Set();

    for (const entry of accountServers || []) {
        if (entry && entry.id) ids.add(`${entry.id}`);
    }

    for (const entry of entries || []) {
        if (entry && entry.serverId) ids.add(`${entry.serverId}`);
    }

    return ids;
}

/*
    Marks the servers of the instance that neither the account state nor the history knows anymore. Their player token
    is invalid, so the bot stops connecting them instead of ending in a reconnect loop of `not_found` answers.
*/
function markUnpairedServers(client, instance, pairedIds, guildId = null) {
    if (!(pairedIds instanceof Set)) return 0;

    let changed = 0;
    const rustplus = (guildId !== null && client.rustplusInstances) ? client.rustplusInstances[guildId] : null;

    for (const [key, server] of Object.entries(instance.serverList)) {
        if (!server) continue;

        /* A server that answers right now is paired, whatever the lists say. */
        const isWorking = Boolean(rustplus && rustplus.serverId === key && rustplus.isOperational);

        const paired = isWorking || !server.guid || pairedIds.has(`${server.guid}`);
        if (server.paired === paired) continue;

        server.paired = paired;
        changed += 1;

        if (!paired) {
            client.log(client.intlGet(null, 'warningCap'),
                `The Rust+ account is not paired with "${server.title}" anymore, it is not connected. ` +
                'Pair it again in the Rust+ app to use it.');

            if (instance.activeServer === key) instance.activeServer = null;
        }
    }

    return changed;
}

function emptyPairingResult() {
    return { servers: 0, created: 0, devices: 0, updated: 0, updatedKeys: [], added: [] };
}

/* Connects the active server again when its pairing was renewed. */
function reconnectRenewedServers(client, guildId, instance, updatedKeys) {
    if (!Array.isArray(updatedKeys) || updatedKeys.length === 0) return;

    const serverKey = instance.activeServer;
    if (!serverKey || !updatedKeys.includes(serverKey)) return;

    const server = instance.serverList[serverKey];
    if (!server) return;

    client.log(client.intlGet(null, 'infoCap'),
        `Rust+ pairing of ${server.title} renewed, reconnecting with the new player token.`);

    if (client.rustplusReconnectTimers && client.rustplusReconnectTimers[guildId]) {
        clearTimeout(client.rustplusReconnectTimers[guildId]);
        client.rustplusReconnectTimers[guildId] = null;
    }

    client.rustplusReconnecting[guildId] = false;

    client.createRustplusInstance(guildId, server.serverIp, server.appPort, server.steamId, server.playerToken);
}

module.exports = {
    HISTORY_URL: HISTORY_URL,
    HISTORY_REFUSED_PAUSE_MS: HISTORY_REFUSED_PAUSE_MS,
    fetchHistory: fetchHistory,
    parsePairingEntries: parsePairingEntries,
    applyPairingEntries: applyPairingEntries,
    refresh: refresh,
    refreshAccount: refreshAccount,
    steamIdsOfGuild: steamIdsOfGuild,
    resetAccountStateCache: resetAccountStateCache,
};
