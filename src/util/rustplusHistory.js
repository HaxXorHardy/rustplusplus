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
    if (response.status !== 200) throw new Error(`History request failed with status ${response.status}.`);

    return Array.isArray(response.data) ? response.data : [];
}

/* The pairing notifications of the history, newest first, one entry per device. */
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

        if (!data || !data.id) continue;

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
    Writes the paired servers and devices of the history into the instance. Existing entries are matched by pairing
    id, then by name, so nothing is duplicated.

    The history contains both kinds of pairing: `server` entries renew the credentials of a server (the server sends
    a new player token when it is paired again, for example after a wipe), `entity` entries add a device. The list is
    newest first, so it is applied oldest first and the newest pairing decides about the player token.
*/
function applyPairingEntries(instance, steamId, entries, intlGet = (key) => key) {
    const result = { servers: 0, created: 0, devices: 0, updated: 0, updatedKeys: [], added: [] };

    for (const entry of [...(entries || [])].reverse()) {
        if (!entry || !entry.serverId) continue;

        /* Alarm notifications have neither an entity nor credentials, they only report an attack. */
        const hasCredentials = entry.playerToken !== undefined && entry.playerToken !== null;
        if (entry.entityId === null && !hasCredentials) continue;

        /*
            A pairing of a server that was removed in Discord brings it back - but only when the pairing is newer than
            the deletion, otherwise the history would undo every deletion again and again.
        */
        const deletedAt = instance.deletedServers ? instance.deletedServers[entry.serverId] : null;
        if (deletedAt) {
            const pairedAt = entry.date ? Date.parse(entry.date) : NaN;

            if (!Number.isFinite(pairedAt) || pairedAt <= deletedAt) continue;

            delete instance.deletedServers[entry.serverId];
        }

        const applied = RustPlusSync.applySyncServers(instance, steamId, [{
            id: entry.serverId,
            name: entry.serverName,
            ip: entry.ip,
            port: entry.port,
            playerToken: entry.playerToken,
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
        result.updated += applied.updated;

        for (const key of applied.updatedKeys) {
            if (!result.updatedKeys.includes(key)) result.updatedKeys.push(key);
        }

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

    return result;
}

/*
    Runs on a timer: adopts servers and devices that were paired in-game since the last run and returns the devices
    that were added, so the caller can post their Discord messages.

    A renewed pairing of the active server (new player token) reconnects the instance, otherwise the bot would keep
    asking with credentials the server does not accept (`not_found` on every request).
*/
async function refresh(client, fetchHistoryFn = fetchHistory, fetchSyncFn = RustPlusLogin.fetchSyncData) {
    const added = [];

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
                const auth = RustPlusAuth.readAuth(steamId);
                if (auth === null) continue;

                const intlGet = (key) => client.intlGet(guildId, key);

                /* The account state (app) and the pairing notifications (server) are both evidence of a pairing. */
                const accountServers = await readAccountServers(client, steamId, auth, fetchSyncFn);
                const entries = parsePairingEntries(await fetchHistoryFn(auth.token));

                let changed = false;

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

                if (!changed) continue;

                /* Devices and servers that were adopted now need their Discord messages and their connection. */
                const firstServerKey = Object.keys(instance.serverList)
                    .find((key) => instance.serverList[key] && instance.serverList[key].paired !== false);
                let activatedKey = null;

                if (instance.activeServer === null && firstServerKey) {
                    instance.activeServer = firstServerKey;
                    activatedKey = firstServerKey;
                }

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

    return added;
}

/* The servers of the Rust+ account, or null when the state could not be read (then nothing is changed). */
async function readAccountServers(client, steamId, auth, fetchSyncFn) {
    try {
        const sync = await fetchSyncFn(auth.token);
        if (!sync || !Array.isArray(sync.servers)) return null;

        return sync.servers;
    }
    catch (e) {
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
};
