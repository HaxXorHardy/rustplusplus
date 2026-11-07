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

const Assert = require('node:assert');
const Test = require('node:test');

const RustPlusHistory = require('../src/util/rustplusHistory.js');

const STEAM_ID = '76561198000000300';
const SERVER_ID = '6f2a1c3d-4b5e-4978-8a9b-0c1d2e3f4a5b';

function intlGet(key) {
    return key;
}

/* One entry of /api/history/read, the pairing payload is a JSON string in `data`. */
function pairEntry(entityId, entityType, entityName, title) {
    return {
        notificationId: 1,
        date: '2026-11-07T13:30:29.9105990+00:00',
        serverId: SERVER_ID,
        title: title,
        body: 'Tap to pair with this device.',
        channel: 1001,
        data: JSON.stringify({
            id: SERVER_ID,
            name: "Captain's Quarters",
            desc: 'Server description',
            img: 'https://files.facepunch.com/header.png',
            logo: 'https://files.facepunch.com/logo.png',
            url: 'https://rust.facepunch.com',
            ip: '91.229.114.90',
            port: '28111',
            playerId: STEAM_ID,
            playerToken: -395561831,
            entityId: entityId,
            entityType: `${entityType}`,
            entityName: entityName,
            type: 'entity',
        }),
    };
}

/*
    A server pairing (`type: 'server'`): no entity, the entry carries the credentials of the server. The server sends
    it again with a new player token when it pairs the player anew (for example after a wipe).
*/
function serverPairEntry(playerToken, notificationId, date) {
    return {
        notificationId: notificationId,
        date: date,
        serverId: SERVER_ID,
        title: "Captain's Quarters",
        body: 'Tap to pair with this server.',
        channel: 1001,
        data: JSON.stringify({
            id: SERVER_ID,
            name: "Captain's Quarters",
            desc: 'Server description',
            img: 'https://files.facepunch.com/header.png',
            logo: 'https://files.facepunch.com/logo.png',
            url: 'https://rust.facepunch.com',
            ip: '91.229.114.90',
            port: '28111',
            playerId: STEAM_ID,
            playerToken: playerToken,
            type: 'server',
        }),
    };
}

Test.describe('RustPlusHistory.parsePairingEntries', () => {
    Test.it('reads the pairing payload of the history', () => {
        const entries = RustPlusHistory.parsePairingEntries([
            pairEntry('116582', 1, 'Smart Switch', 'Smart Switch'),
            pairEntry('116584', 2, 'Smart Alarm', 'Smart Alarm'),
        ]);

        Assert.strictEqual(entries.length, 2);

        Assert.deepStrictEqual(entries[0], {
            notificationId: 1,
            date: '2026-11-07T13:30:29.9105990+00:00',
            kind: 'entity',
            serverId: SERVER_ID,
            serverName: "Captain's Quarters",
            ip: '91.229.114.90',
            port: '28111',
            playerToken: -395561831,
            playerId: STEAM_ID,
            headerImage: 'https://files.facepunch.com/header.png',
            description: 'Server description',
            url: 'https://rust.facepunch.com',
            entityId: '116582',
            entityType: 1,
            entityName: 'Smart Switch',
        });
        Assert.strictEqual(entries[1].entityType, 2);
    });

    Test.it('skips entries without usable data', () => {
        Assert.deepStrictEqual(RustPlusHistory.parsePairingEntries(null), []);
        Assert.deepStrictEqual(RustPlusHistory.parsePairingEntries([{ data: 'not-json' }, {}, { data: '{}' }]), []);
    });
});

Test.describe('RustPlusHistory.applyPairingEntries', () => {
    Test.it('creates the server with its pairing address and adopts the device', () => {
        const instance = { serverList: {} };
        const entries = RustPlusHistory.parsePairingEntries([pairEntry('116582', 1, 'Smart Switch', 'Smart Switch')]);

        const result = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.deepStrictEqual(result.servers, 1);
        Assert.deepStrictEqual(result.created, 1);
        Assert.deepStrictEqual(result.devices, 1);
        Assert.deepStrictEqual(result.added, [
            { serverKey: '91.229.114.90-28111', entityId: '116582', entityType: 1 },
        ]);

        const server = instance.serverList['91.229.114.90-28111'];
        Assert.strictEqual(server.guid, SERVER_ID);
        Assert.strictEqual(server.serverIp, '91.229.114.90');
        Assert.strictEqual(server.appPort, '28111');
        Assert.strictEqual(server.playerToken, -395561831);
        Assert.strictEqual(server.switches['116582'].name, 'Smart Switch');
    });

    Test.it('adds a second device to the server it already knows', () => {
        const instance = { serverList: {} };
        const entries = RustPlusHistory.parsePairingEntries([
            pairEntry('116582', 1, 'Smart Switch', 'Smart Switch'),
            pairEntry('116584', 2, 'Smart Alarm', 'Smart Alarm'),
        ]);

        const result = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(result.created, 1);
        Assert.strictEqual(result.devices, 2);
        Assert.deepStrictEqual(Object.keys(instance.serverList), ['91.229.114.90-28111']);
        Assert.deepStrictEqual(Object.keys(instance.serverList['91.229.114.90-28111'].alarms), ['116584']);
    });

    Test.it('does not adopt the same device twice', () => {
        const instance = { serverList: {} };
        const entries = RustPlusHistory.parsePairingEntries([pairEntry('116582', 1, 'Smart Switch', 'Smart Switch')]);

        RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);
        const again = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(again.created, 0);
        Assert.strictEqual(again.devices, 0);
        Assert.deepStrictEqual(again.added, []);
        Assert.strictEqual(Object.keys(instance.serverList['91.229.114.90-28111'].switches).length, 1);
    });

    Test.it('renews the player token of a known server from the newest server pairing', () => {
        const instance = { serverList: {} };

        /* The device pairing created the server with the old token. */
        RustPlusHistory.applyPairingEntries(instance, STEAM_ID,
            RustPlusHistory.parsePairingEntries([pairEntry('116582', 1, 'Smart Switch', 'Smart Switch')]), intlGet);

        /* The server paired the player anew, the history is newest first. */
        const entries = RustPlusHistory.parsePairingEntries([
            serverPairEntry(1947563374, 2, '2026-11-07T13:54:34.8160021+00:00'),
            pairEntry('116582', 1, 'Smart Switch', 'Smart Switch'),
        ]);

        const result = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(result.created, 0);
        Assert.strictEqual(result.devices, 0);
        Assert.strictEqual(result.updated, 1);
        Assert.deepStrictEqual(result.updatedKeys, ['91.229.114.90-28111']);

        const server = instance.serverList['91.229.114.90-28111'];
        Assert.strictEqual(server.playerToken, 1947563374);
        Assert.strictEqual(server.guid, SERVER_ID);
        Assert.deepStrictEqual(Object.keys(server.switches), ['116582']);
    });

    Test.it('keeps the token of the newest pairing when the history holds several', () => {
        const instance = { serverList: {} };

        const entries = RustPlusHistory.parsePairingEntries([
            serverPairEntry(1947563374, 3, '2026-11-07T13:54:34.8160021+00:00'),
            serverPairEntry(-395561831, 2, '2026-11-07T13:30:29.9105990+00:00'),
        ]);

        RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(instance.serverList['91.229.114.90-28111'].playerToken, 1947563374);
    });

    Test.it('ignores alarm notifications, they carry no credentials', () => {
        const instance = { serverList: {} };

        const entries = RustPlusHistory.parsePairingEntries([{
            notificationId: 9,
            date: '2026-11-07T13:40:00.0000000+00:00',
            serverId: SERVER_ID,
            title: 'Alarm',
            body: 'Your base is under attack!',
            channel: 1001,
            data: JSON.stringify({ id: SERVER_ID, name: "Captain's Quarters", type: 'alarm' }),
        }]);

        const result = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(result.servers, 0);
        Assert.deepStrictEqual(instance.serverList, {});
    });
});

/*
    A guild without any configured server does not know its account. The stored logins have to be asked, otherwise a
    server that was removed - or a container that only carries the login - would never be adopted again.
*/
Test.describe('RustPlusHistory.refresh', () => {
    const GUILD_ID = '100000000000000006';

    function fakeClient(instance) {
        const client = {
            instances: { [GUILD_ID]: {} },
            saved: 0,
            rustplusInstances: {},
            rustplusReconnectTimers: {},
            rustplusReconnecting: {},
            createdRustplusInstances: [],
            warnings: [],
            getInstance: () => instance,
            setInstance: () => { client.saved += 1; },
            intlGet: (guildId, key) => key,
            log: (title, text) => client.warnings.push(text),
            createRustplusInstance: (...args) => client.createdRustplusInstances.push(args),
        };

        return client;
    }

    function stubAuth(t, auth) {
        const rustplusAuthPath = require.resolve('../src/util/rustplusAuth.js');
        const RustPlusAuth = require(rustplusAuthPath);

        const originalListSteamIds = RustPlusAuth.listSteamIds;
        const originalReadAuth = RustPlusAuth.readAuth;
        const originalWriteAuth = RustPlusAuth.writeAuth;

        RustPlusAuth.listSteamIds = () => (auth === null ? [] : [STEAM_ID]);
        RustPlusAuth.readAuth = () => auth;
        /* The refresh stores the account state, the test must not write into the credentials folder. */
        RustPlusAuth.writeAuth = () => undefined;

        t.after(() => {
            RustPlusAuth.listSteamIds = originalListSteamIds;
            RustPlusAuth.readAuth = originalReadAuth;
            RustPlusAuth.writeAuth = originalWriteAuth;
        });
    }

    Test.it('adopts the servers of the account when the guild has none', async (t) => {
        stubAuth(t, {
            steamId: STEAM_ID,
            token: 'test-token',
            servers: [{ id: SERVER_ID, name: "Captain's Quarters", playerToken: 42, devices: [] }],
        });

        const instance = { activeServer: null, serverList: {}, trackers: {} };
        const client = fakeClient(instance);

        /* No pairing notifications, the server list of the account is enough to adopt the server. */
        const added = await RustPlusHistory.refresh(client, async () => [],
            async () => ({ servers: [{ id: SERVER_ID, name: "Captain's Quarters", playerToken: 42, devices: [] }] }));

        const serverKeys = Object.keys(instance.serverList);
        Assert.strictEqual(serverKeys.length, 1);

        const server = instance.serverList[serverKeys[0]];
        Assert.strictEqual(server.guid, SERVER_ID);
        Assert.strictEqual(server.title, "Captain's Quarters");
        Assert.strictEqual(server.steamId, STEAM_ID);
        Assert.strictEqual(server.playerToken, 42);

        /* Without an address the entry is reachable through the relay. */
        Assert.strictEqual(server.appPort, SERVER_ID);

        Assert.strictEqual(instance.activeServer, serverKeys[0]);
        Assert.strictEqual(client.saved, 1);
        Assert.deepStrictEqual(added, []);

        /* A server that is adopted while the bot runs is connected right away. */
        Assert.strictEqual(client.createdRustplusInstances.length, 1);
        Assert.strictEqual(client.createdRustplusInstances[0][3], STEAM_ID);
        Assert.strictEqual(client.createdRustplusInstances[0][4], 42);
    });

    Test.it('leaves the instance alone when the account has nothing to adopt', async (t) => {
        stubAuth(t, { steamId: STEAM_ID, token: 'test-token', servers: [] });

        const instance = { activeServer: null, serverList: {}, trackers: {} };
        const client = fakeClient(instance);

        await RustPlusHistory.refresh(client, async () => [], async () => ({ servers: [] }));

        Assert.deepStrictEqual(Object.keys(instance.serverList), []);
        Assert.strictEqual(instance.activeServer, null);
        Assert.strictEqual(client.saved, 0);
    });

    Test.it('does nothing when no login is stored at all', async (t) => {
        stubAuth(t, null);

        const instance = { activeServer: null, serverList: {}, trackers: {} };
        const client = fakeClient(instance);

        await RustPlusHistory.refresh(client, async () => [], async () => ({ servers: [] }));

        Assert.deepStrictEqual(Object.keys(instance.serverList), []);
        Assert.strictEqual(client.saved, 0);
    });

    /*
        The Rust+ app does not always list a server that was paired in-game (the notification never reached the app),
        but the pairing notification carries a player token the server accepts. So the history has to be adopted.
    */
    Test.it('adopts a server from the history even when the app does not list it', async (t) => {
        stubAuth(t, { steamId: STEAM_ID, token: 'test-token', servers: [] });

        const instance = { activeServer: null, serverList: {}, trackers: {} };
        const client = fakeClient(instance);

        await RustPlusHistory.refresh(client, async () => [serverPairEntry(1234, 7, '2026-11-07T16:28:10.0000000+00:00')],
            async () => ({ servers: [] }));

        const serverKeys = Object.keys(instance.serverList);
        Assert.strictEqual(serverKeys.length, 1);
        Assert.strictEqual(instance.serverList[serverKeys[0]].playerToken, 1234);
        Assert.notStrictEqual(instance.serverList[serverKeys[0]].paired, false);
        Assert.strictEqual(instance.activeServer, serverKeys[0]);
        Assert.strictEqual(client.createdRustplusInstances.length, 1);
    });

    Test.it('marks a server whose pairing is gone and stops connecting it', async (t) => {
        stubAuth(t, { steamId: STEAM_ID, token: 'test-token', servers: [] });

        const serverKey = `relay-${SERVER_ID}`;
        const instance = {
            activeServer: serverKey,
            serverList: {
                [serverKey]: {
                    title: "Captain's Quarters",
                    guid: SERVER_ID,
                    steamId: STEAM_ID,
                    playerToken: -889972864,
                    switches: {},
                    alarms: {},
                    storageMonitors: {},
                },
            },
            trackers: {},
        };
        const client = fakeClient(instance);

        await RustPlusHistory.refresh(client, async () => [], async () => ({ servers: [] }));

        Assert.strictEqual(instance.serverList[serverKey].paired, false);
        Assert.strictEqual(instance.activeServer, null);
        Assert.strictEqual(client.saved, 1);
        Assert.strictEqual(client.createdRustplusInstances.length, 0);
        Assert.ok(client.warnings.some((text) => text.includes('is not paired with')));
    });

    Test.it('keeps a server that the account is still paired with', async (t) => {
        stubAuth(t, { steamId: STEAM_ID, token: 'test-token', servers: [] });

        const serverKey = `relay-${SERVER_ID}`;
        const instance = {
            activeServer: serverKey,
            serverList: {
                [serverKey]: {
                    title: "Captain's Quarters",
                    guid: SERVER_ID,
                    steamId: STEAM_ID,
                    playerToken: 42,
                    switches: {},
                    alarms: {},
                    storageMonitors: {},
                },
            },
            trackers: {},
        };
        const client = fakeClient(instance);

        await RustPlusHistory.refresh(client, async () => [],
            async () => ({ servers: [{ id: SERVER_ID, name: "Captain's Quarters", playerToken: 42, devices: [] }] }));

        Assert.strictEqual(instance.serverList[serverKey].paired, true);
        Assert.strictEqual(instance.activeServer, serverKey);
        Assert.strictEqual(client.warnings.length, 0);
    });
});

/*
    The account stays paired with a server that was removed in Discord. The history is applied on every run, so only a
    pairing that is newer than the deletion may bring the server back.
*/
Test.describe('RustPlusHistory.applyPairingEntries (removed servers)', () => {
    const DELETED_AT = Date.parse('2026-11-07T13:00:00+00:00');

    Test.it('keeps a removed server out when the history only holds an older pairing', () => {
        const instance = { serverList: {}, deletedServers: { [SERVER_ID]: DELETED_AT } };

        const entries = RustPlusHistory.parsePairingEntries([
            serverPairEntry(1947563374, 5, '2026-11-07T12:00:00.0000000+00:00'),
        ]);

        const result = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(result.servers, 0);
        Assert.deepStrictEqual(instance.serverList, {});
        Assert.strictEqual(SERVER_ID in instance.deletedServers, true);
    });

    Test.it('brings a removed server back when it was paired again afterwards', () => {
        const instance = { serverList: {}, deletedServers: { [SERVER_ID]: DELETED_AT } };

        const entries = RustPlusHistory.parsePairingEntries([
            serverPairEntry(1947563374, 6, '2026-11-07T14:00:00.0000000+00:00'),
        ]);

        const result = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(result.servers, 1);
        Assert.strictEqual(SERVER_ID in instance.deletedServers, false);

        const serverKeys = Object.keys(instance.serverList);
        Assert.strictEqual(serverKeys.length, 1);
        Assert.strictEqual(instance.serverList[serverKeys[0]].guid, SERVER_ID);
    });
});

/*
    The history keeps every pairing of a server. Replaying the older ones must not look like a renewal, otherwise the
    instance reconnects on every refresh (every five minutes) although nothing changed.
*/
Test.describe('RustPlusHistory.applyPairingEntries (replay)', () => {
    Test.it('does not report a renewal when the replay ends where it started', () => {
        const instance = { serverList: {} };

        const entries = RustPlusHistory.parsePairingEntries([
            serverPairEntry(300, 3, '2026-11-07T16:38:49.2660604+00:00'),
            serverPairEntry(200, 2, '2026-11-07T16:28:10.6870231+00:00'),
            serverPairEntry(100, 1, '2026-11-07T16:14:33.2544318+00:00'),
        ]);

        const first = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);
        Assert.strictEqual(first.created, 1);
        Assert.strictEqual(first.updated, 0);
        Assert.deepStrictEqual(first.updatedKeys, []);

        const again = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);
        Assert.strictEqual(again.updated, 0);
        Assert.deepStrictEqual(again.updatedKeys, []);
        Assert.strictEqual(instance.serverList['91.229.114.90-28111'].playerToken, 300);
    });

    Test.it('still reports a renewal when a newer pairing arrives', () => {
        const instance = { serverList: {} };

        RustPlusHistory.applyPairingEntries(instance, STEAM_ID,
            RustPlusHistory.parsePairingEntries([serverPairEntry(100, 1, '2026-11-07T16:14:33.2544318+00:00')]),
            intlGet);

        const entries = RustPlusHistory.parsePairingEntries([
            serverPairEntry(400, 2, '2026-11-07T17:00:00.0000000+00:00'),
            serverPairEntry(100, 1, '2026-11-07T16:14:33.2544318+00:00'),
        ]);

        const result = RustPlusHistory.applyPairingEntries(instance, STEAM_ID, entries, intlGet);

        Assert.strictEqual(result.updated, 1);
        Assert.deepStrictEqual(result.updatedKeys, ['91.229.114.90-28111']);
        Assert.strictEqual(instance.serverList['91.229.114.90-28111'].playerToken, 400);
    });
});