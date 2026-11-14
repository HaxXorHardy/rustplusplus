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
    Runs on a timer: adopts servers and devices that were paired in-game since the last run and returns the devices
    that were added, so the caller can post their Discord messages. Deaths of the account are reported as well
    (`deaths`), they replace the direct message the removed FCM listener sent.

    A renewed pairing of the active server (new player token) reconnects the instance, otherwise the bot would keep
    asking with credentials the server does not accept (`not_found` on every request).
*/
async function refresh(client, fetchHistoryFn = fetchHistory, fetchSyncFn = RustPlusLogin.fetchSyncData) {
    const added = [];
    const deaths = [];

    for (const guildId of Object.keys(client.instances || {})) {
        try {
            const instance = client.getInstance(guildId);
            const serverList = instance.serverList || {};
            const server = serverList[instance.activeServer] ||
                serverList[Object.keys(serverList)[0]];

            /*
                The account is known by the steam id of a configured server. A guild without any server (everything
                was removed, or a fresh container that only carries the stored login) would never adopt a server
                again, so every stored login is asked then.
            */
            const steamIds = (server && server.steamId) ? [`${server.steamId}`] : RustPlusAuth.listSteamIds();

            for (const steamId of steamIds) {
                /* A rejected token is not asked for again until the backoff is over (see renewRejectedAuth). */
                if (Number(authFailureUntil.get(`${steamId}`)) > Date.now()) continue;

                let auth = RustPlusAuth.readAuth(steamId);
                if (auth === null) continue;

                const intlGet = (key) => client.intlGet(guildId, key);

                /*
                    The account state (app) and the pairing notifications (server) are both evidence of a pairing. A
                    token the API rejects is renewed once and the read is repeated; an account that cannot be renewed
                    is left alone for a while instead of retrying every few seconds.
                */
                let accountServers = null;
                let entries = null;

                try {
                    accountServers = await readAccountServers(client, steamId, auth, fetchSyncFn);
                    entries = parsePairingEntries(await fetchHistoryFn(auth.token));
                }
                catch (e) {
                    if (!isAuthFailure(e)) throw e;

                    const strikes = (authFailureStrikes.get(`${steamId}`) || 0) + 1;
                    authFailureStrikes.set(`${steamId}`, strikes);

                    /*
                        A single rejected request can be a race with a login somewhere else. The renewal is only asked
                        for when the next read fails as well: a renewal mints a new token and with it kills the token
                        of the running socket.
                    */
                    if (strikes < AUTH_FAILURE_STRIKES) {
                        client.log(client.intlGet(null, 'warningCap'),
                            `The Rust+ API rejected one read of ${steamId} (${strikes}/${AUTH_FAILURE_STRIKES}), ` +
                            'the token is renewed if it happens again.', 'debug');

                        throw e;
                    }

                    auth = await renewRejectedAuth(client, steamId);

                    if (auth === null) {
                        authFailureUntil.set(`${steamId}`, Date.now() + AUTH_FAILURE_BACKOFF_MS);
                        throw e;
                    }

                    rebuildInstanceConnection(client, guildId, steamId, 'the account token was renewed');

                    try {
                        accountServers = await readAccountServers(client, steamId, auth, fetchSyncFn);
                        entries = parsePairingEntries(await fetchHistoryFn(auth.token));
                    }
                    catch (retryError) {
                        if (!isAuthFailure(retryError)) throw retryError;

                        authFailureUntil.set(`${steamId}`, Date.now() + AUTH_FAILURE_BACKOFF_MS);
                        throw retryError;
                    }
                }

                /* A read that went through means the token is accepted, the next rejection starts at one again. */
                authFailureStrikes.delete(`${steamId}`);

                let changed = false;

                /*
                    A death notification is reported once as a direct message (the job of the removed FCM listener).
                    The newest reported one is remembered per account, so the replay of the history does not repeat it.
                    The first run only records the newest one: the history keeps old deaths and nobody wants them as a
                    direct message days later.
                */
                const reportedDeath = getReportedDeath(instance, steamId);
                const deathEntries = entries
                    .filter((entry) => entry.kind === 'death')
                    .map((entry) => ({ entry: entry, at: entry.date ? Date.parse(entry.date) : NaN }))
                    .filter((death) => Number.isFinite(death.at));

                if (reportedDeath === null) {
                    if (deathEntries.length !== 0) {
                        setReportedDeath(instance, steamId, Math.max(...deathEntries.map((death) => death.at)));
                        changed = true;
                    }
                }
                else {
                    const newDeaths = deathEntries.filter((death) => death.at > reportedDeath);

                    if (newDeaths.length !== 0) {
                        /* Oldest first, the user should read them in the order they happened. */
                        for (const death of [...newDeaths].reverse()) {
                            deaths.push({ guildId: guildId, steamId: steamId, death: death.entry });
                        }

                        setReportedDeath(instance, steamId, Math.max(...newDeaths.map((death) => death.at)));
                        changed = true;
                    }
                }

                if (accountServers !== null) {
                    /* Keep the stored snapshot current, the token renewal and the login use it. */
                    try {
                        RustPlusAuth.writeAuth(steamId, Object.assign({}, auth, { servers: accountServers }));
                    }
                    catch (e) {
                        client.log(client.intlGet(null, 'warningCap'),
                            `Could not store the account state of ${steamId}: ${e && e.message ? e.message : e}`,
                            'debug');
                    }
                }

                /* Servers whose pairing is gone are not connected anymore, their entry stays. */
                const pairedIds = (accountServers === null && entries.length === 0) ? null :
                    pairedServerIds(accountServers, entries);

                if (markUnpairedServers(client, instance, pairedIds) !== 0) changed = true;

                const servers = (accountServers === null) ? (auth.servers || []) : accountServers;

                /*
                    The account state is fresh but not complete: the app does not always list a server that was paired
                    in-game, and its token can lag behind. So it never overwrites a token, only fills in what is
                    missing. The history is applied after it and decides about the newest player token.
                */
                const synced = RustPlusSync.applySyncServers(instance, steamId, servers, intlGet,
                    { keepCredentials: true });

                const applied = (entries.length === 0) ? emptyPairingResult() :
                    applyPairingEntries(instance, steamId, entries, intlGet);

                if (synced.created !== 0 || synced.updated !== 0 || applied.devices !== 0 ||
                    applied.created !== 0 || applied.updated !== 0) {
                    changed = true;
                }

                /*
                    Only a run that adopted something activates a server. A guild whose connection was ended in Discord
                    (activeServer === null by the disconnect button) stays disconnected: the user decided that, the
                    refresh must not connect it again every five minutes.
                */
                if (!changed) continue;

                const firstServerKey = Object.keys(instance.serverList)
                    .find((key) => instance.serverList[key] && instance.serverList[key].paired !== false);
                let activatedKey = null;

                if (instance.activeServer === null && firstServerKey) {
                    instance.activeServer = firstServerKey;
                    activatedKey = firstServerKey;

                    client.log(client.intlGet(null, 'infoCap'),
                        `Activating "${instance.serverList[firstServerKey].title}", the guild had no active server.`);
                }

                /* Devices and servers that were adopted now need their Discord messages and their connection. */
                client.setInstance(guildId, instance);

                for (const device of applied.added) added.push({ guildId: guildId, ...device });

                /* Only a pairing notification tells about a new player token, the account snapshot does not. */
                reconnectRenewedServers(client, guildId, instance, applied.updatedKeys);

                /*
                    A server that is adopted while the bot runs has no connection: the startup path connects the
                    servers of the instance only once.
                */
                const activatedServer = activatedKey ? instance.serverList[activatedKey] : null;
                const alreadyConnected = client.rustplusInstances && client.rustplusInstances[guildId];

                if (activatedServer && !alreadyConnected) {
                    client.createRustplusInstance(guildId, activatedServer.serverIp, activatedServer.appPort,
                        activatedServer.steamId, activatedServer.playerToken);
                }
            }
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `Could not read the pairing history of ${guildId}: ${e && e.message ? e.message : e}`, 'debug');
        }
    }

    return { devices: added, deaths: deaths };
}

/*
    The account state of the app is a slow snapshot: the history carries the pairings themselves, so a short history
    interval does not have to ask for the server list on every run. Cached per steam id for
    Config.general.rustplusSyncDataIntervalMs.
*/
const accountStateCache = new Map();   /* steamId -> { servers, at } */

/*
    A token that the API rejects (401, e.g. because the account logged in somewhere else and minted a new one) is
    renewed with the stored Steam refresh token. When that fails, the account is left alone for a while: asking every
    few seconds would only fill the log and hammer the API.
*/
const AUTH_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const authFailureUntil = new Map();   /* steamId -> ms */

/*
    A single rejected request is no proof of a dead token: a request can race a login, and a proxy in front of the API
    answers 403 (not 401) on its own. Every renewal mints a new token and with it kills the token of the running Rust+
    socket, so the bot only asks Steam after the second failure in a row.
*/
const AUTH_FAILURE_STRIKES = 2;
const authFailureStrikes = new Map();   /* steamId -> failed reads in a row */

function resetAccountStateCache() {
    accountStateCache.clear();
    authFailureUntil.clear();
    authFailureStrikes.clear();
}

/* Only 401 says "this token is not accepted anymore". A 403 is a refusal by a proxy, not a dead token. */
function isAuthFailure(error) {
    return Boolean(error) && (error.status === 401);
}

/*
    The relay authenticates a socket once, with the token of the handshake (`util/rustplusSocket.js`), so a renewed
    token never reaches a running socket: from that moment every request is answered with not_found. The instance has
    to build its socket again to use the stored token.
*/
function rebuildInstanceConnection(client, guildId, steamId, reason) {
    const rustplus = (client.rustplusInstances) ? client.rustplusInstances[guildId] : null;

    if (!rustplus || typeof rustplus.rebuildConnection !== 'function') return;
    if (rustplus.playerId !== undefined && `${rustplus.playerId}` !== `${steamId}`) return;

    rustplus.rebuildConnection(reason);
}

async function renewRejectedAuth(client, steamId) {
    try {
        const auth = await RustPlusLogin.renewAuth(steamId,
            (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug'));

        client.log(client.intlGet(null, 'infoCap'),
            `The Rust+ account token of ${steamId} was rejected by the API, a new one was fetched.`);

        return auth;
    }
    catch (e) {
        client.log(client.intlGet(null, 'warningCap'),
            `The Rust+ account token of ${steamId} is rejected by the API and could not be renewed ` +
            `(${e && e.message ? e.message : e}). Use "/credentials login" in Discord.`, 'warn');

        return null;
    }
}

function cachedAccountServers(steamId, now) {
    const cached = accountStateCache.get(`${steamId}`);
    if (!cached) return null;

    return ((now - cached.at) < Config.general.rustplusSyncDataIntervalMs) ? cached.servers : null;
}

/* The servers of the Rust+ account, or null when the state could not be read (then nothing is changed). */
async function readAccountServers(client, steamId, auth, fetchSyncFn, now = Date.now()) {
    const cached = cachedAccountServers(steamId, now);
    if (cached !== null) return cached;

    try {
        const sync = await fetchSyncFn(auth.token);
        if (!sync || !Array.isArray(sync.servers)) return null;

        accountStateCache.set(`${steamId}`, { servers: sync.servers, at: now });

        return sync.servers;
    }
    catch (e) {
        if (isAuthFailure(e)) throw e;

        client.log(client.intlGet(null, 'warningCap'),
            `Could not read the Rust+ account state of ${steamId}: ${e && e.message ? e.message : e}`, 'debug');

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
function markUnpairedServers(client, instance, pairedIds) {
    if (!(pairedIds instanceof Set)) return 0;

    let changed = 0;

    for (const [key, server] of Object.entries(instance.serverList)) {
        if (!server) continue;

        const paired = !server.guid || pairedIds.has(`${server.guid}`);
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
    fetchHistory: fetchHistory,
    parsePairingEntries: parsePairingEntries,
    applyPairingEntries: applyPairingEntries,
    refresh: refresh,
    resetAccountStateCache: resetAccountStateCache,
};
