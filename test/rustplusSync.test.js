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

const RustPlusSync = require('../src/util/rustplusSync.js');

const STEAM_ID = '76561198000000200';
const SERVER_ID = '6f2a1c3d-4b5e-4978-8a9b-0c1d2e3f4a5b';
const SWITCH_ID = 116236;
const ALARM_ID = 116254;

function intlGet(key) {
    const strings = {
        smartSwitch: 'Smart Switch',
        smartAlarm: 'Smart Alarm',
        storageMonitor: 'Storage Monitor',
        baseIsUnderAttack: 'Base is under attack!',
    };

    return strings[key] || key;
}

/* The account state of the Rust+ app, cut down to the fields that matter. */
function syncPayload() {
    return JSON.stringify({
        currentServerId: SERVER_ID,
        servers: [{
            id: SERVER_ID,
            name: "Captain's Quarters",
            playerToken: 1623465021,
            playerId: { low: 39734472, high: 17825793 },
            headerImage: 'https://files.facepunch.com/header.png',
            url: 'https://rust.facepunch.com',
            desc: 'Server description',
            map: 'BuildMap5',
            mapSize: 4500,
            seed: 12345,
            wipeTime: { unix: 1795000000 },
            isSubscribed: true,
            cameras: [{ identifier: 'OILRIG2L2', icon: 'cctv.png' }],
            entityCategories: [
                { categoryId: 0, name: '', entities: [
                    { entityId: { low: SWITCH_ID, high: 0 }, type: 1, name: 'Front Door', icon: 'switch.png' },
                    { entityId: { low: ALARM_ID, high: 0 }, type: 2, name: 'Base Alarm', icon: 'alarm.png' },
                    { entityId: { low: 4242, high: 0 }, type: 3, name: 'Main TC', icon: 'tc.png' },
                ] },
            ],
        }],
    });
}

Test.describe('RustPlusSync.toEntityIdString', () => {
    Test.it('converts the protobuf long representation', () => {
        Assert.strictEqual(RustPlusSync.toEntityIdString({ low: 116236, high: 0 }), '116236');
        Assert.strictEqual(RustPlusSync.toEntityIdString({ low: -1, high: -1 }), '18446744073709551615');
        Assert.strictEqual(RustPlusSync.toEntityIdString(42), '42');
        Assert.strictEqual(RustPlusSync.toEntityIdString('4711'), '4711');
        Assert.strictEqual(RustPlusSync.toEntityIdString(null), null);
        Assert.strictEqual(RustPlusSync.toEntityIdString({}), null);
    });
});

Test.describe('RustPlusSync.parseSyncPayload', () => {
    Test.it('reads servers, player tokens, cameras and paired entities', () => {
        const data = RustPlusSync.parseSyncPayload(syncPayload());

        Assert.strictEqual(data.currentServerId, SERVER_ID);

        const server = data.servers[0];
        Assert.strictEqual(server.id, SERVER_ID);
        Assert.strictEqual(server.name, "Captain's Quarters");
        Assert.strictEqual(server.playerToken, 1623465021);
        Assert.strictEqual(server.playerId, STEAM_ID);
        Assert.strictEqual(server.mapSize, 4500);
        Assert.strictEqual(server.wipeTime, 1795000000);
        Assert.deepStrictEqual(server.cameras, [{ identifier: 'OILRIG2L2', icon: 'cctv.png' }]);

        Assert.deepStrictEqual(server.devices, [
            { id: `${SWITCH_ID}`, type: 1, name: 'Front Door', icon: 'switch.png' },
            { id: `${ALARM_ID}`, type: 2, name: 'Base Alarm', icon: 'alarm.png' },
            { id: '4242', type: 3, name: 'Main TC', icon: 'tc.png' },
        ]);
    });

    Test.it('accepts an already parsed payload and empty data', () => {
        Assert.deepStrictEqual(RustPlusSync.parseSyncPayload({ servers: [] }).servers, []);
        Assert.deepStrictEqual(RustPlusSync.parseSyncPayload(null).servers, []);
    });
});

Test.describe('RustPlusSync.applySyncServers', () => {
    Test.it('creates the server of the account with its paired devices', () => {
        const instance = { serverList: {} };
        const data = RustPlusSync.parseSyncPayload(syncPayload());

        const result = RustPlusSync.applySyncServers(instance, STEAM_ID, data.servers, intlGet);

        Assert.deepStrictEqual(result,
            { servers: 1, created: 1, devices: 3, updated: 0, updatedKeys: [], skipped: [] });

        const server = instance.serverList[`relay-${SERVER_ID}`];
        Assert.strictEqual(server.guid, SERVER_ID);
        Assert.strictEqual(server.title, "Captain's Quarters");
        Assert.strictEqual(server.steamId, STEAM_ID);
        Assert.strictEqual(server.playerToken, 1623465021);
        Assert.strictEqual(server.img, 'https://files.facepunch.com/header.png');

        /* The device names of the app are used, the bot only adds what it does not know yet. */
        Assert.strictEqual(server.switches[`${SWITCH_ID}`].name, 'Front Door');
        Assert.strictEqual(server.alarms[`${ALARM_ID}`].name, 'Base Alarm');
        Assert.strictEqual(server.storageMonitors['4242'].name, 'Main TC');
        Assert.strictEqual(server.alarms[`${ALARM_ID}`].server, "Captain's Quarters");
    });
});

Test.describe('RustPlusSync.applySyncServers (existing entries)', () => {
    Test.it('updates an existing server instead of creating a second one', () => {
        const instance = {
            serverList: {
                '1.2.3.4-28082': {
                    title: "Captain's Quarters",
                    serverIp: '1.2.3.4',
                    appPort: '28082',
                    guid: null,
                    steamId: '76561198000000201',
                    playerToken: 1,
                    switches: { [`${SWITCH_ID}`]: { name: 'My own name', command: `${SWITCH_ID}` } },
                },
            },
        };

        const data = RustPlusSync.parseSyncPayload(syncPayload());
        const result = RustPlusSync.applySyncServers(instance, STEAM_ID, data.servers, intlGet);

        Assert.strictEqual(result.servers, 1);
        Assert.strictEqual(result.created, 0);
        Assert.strictEqual(result.devices, 2);   /* the known switch stays as it is */

        const server = instance.serverList['1.2.3.4-28082'];
        Assert.strictEqual(server.guid, SERVER_ID);
        Assert.strictEqual(server.serverIp, '1.2.3.4');
        Assert.strictEqual(server.appPort, '28082');
        Assert.strictEqual(server.playerToken, 1623465021);
        Assert.strictEqual(server.switches[`${SWITCH_ID}`].name, 'My own name');
        Assert.ok(server.alarms[`${ALARM_ID}`]);
        Assert.ok(server.storageMonitors['4242']);
    });

    Test.it('ignores entries without a pairing id', () => {
        const instance = { serverList: {} };

        Assert.deepStrictEqual(RustPlusSync.applySyncServers(instance, STEAM_ID, [{ name: 'no id' }], intlGet),
            { servers: 0, created: 0, devices: 0, updated: 0, updatedKeys: [], skipped: [] });
        Assert.deepStrictEqual(instance.serverList, {});
    });

    /* Servers adopted while the bot runs never pass the repair of the instance file, the mirror has to be created. */
    Test.it('creates the lite mirror of an adopted server', () => {
        const instance = { serverList: {} };
        const data = RustPlusSync.parseSyncPayload(syncPayload());

        RustPlusSync.applySyncServers(instance, STEAM_ID, data.servers, intlGet);

        const key = Object.keys(instance.serverList)[0];
        Assert.deepStrictEqual(Object.keys(instance.serverList[key]), [
            'title', 'serverIp', 'appPort', 'guid', 'steamId', 'playerToken', 'description', 'img', 'url', 'notes',
            'switches', 'alarms', 'storageMonitors', 'markers', 'switchGroups', 'messageId', 'battlemetricsId',
            'connect', 'cargoShipEgressTimeMs', 'oilRigLockedCrateUnlockTimeMs', 'deepSeaMinWipeCooldownMs',
            'deepSeaMaxWipeCooldownMs', 'deepSeaWipeDurationMs', 'timeTillDay', 'timeTillNight', 'customCameraGroups',
        ]);

        Assert.deepStrictEqual(Object.keys(instance.serverListLite[key]), [STEAM_ID]);
        Assert.strictEqual(instance.serverListLite[key][STEAM_ID].playerToken, 1623465021);
        Assert.strictEqual(instance.serverListLite[key][STEAM_ID].guid, undefined);
    });
});

/*
    The Rust+ account stays paired with a server after the user removes it in Discord. Without a mark the account state
    would adopt it again on the next refresh, which made deleting a server look broken.
*/
Test.describe('RustPlusSync.applySyncServers (removed servers)', () => {
    const DELETED_AT = 1794058229000;

    Test.it('does not adopt a server that was removed in Discord', () => {
        const instance = { serverList: {}, deletedServers: { [SERVER_ID]: DELETED_AT } };
        const data = RustPlusSync.parseSyncPayload(syncPayload());

        const result = RustPlusSync.applySyncServers(instance, STEAM_ID, data.servers, intlGet);

        Assert.strictEqual(result.servers, 0);
        Assert.deepStrictEqual(result.skipped, [SERVER_ID]);
        Assert.deepStrictEqual(instance.serverList, {});
    });

    Test.it('adopts it when the caller explicitly asks for removed servers', () => {
        const instance = { serverList: {}, deletedServers: { [SERVER_ID]: DELETED_AT } };
        const data = RustPlusSync.parseSyncPayload(syncPayload());

        const result = RustPlusSync.applySyncServers(instance, STEAM_ID, data.servers, intlGet,
            { includeDeleted: true });

        Assert.strictEqual(result.servers, 1);
        Assert.deepStrictEqual(result.skipped, []);
    });

    Test.it('reads the lite mirror of a server that has none', () => {
        Assert.deepStrictEqual(RustPlusSync.getServerListLiteEntry({ serverList: {} }, 'relay-1'), {});
        Assert.deepStrictEqual(RustPlusSync.getServerListLiteEntry({ serverListLite: {} }, 'relay-1'), {});
        Assert.deepStrictEqual(RustPlusSync.getServerListLiteEntry(null, 'relay-1'), {});
    });
});

/*
    The server list of the login is a snapshot. Writing it over an entry that the notification history has already
    renewed keeps the bot asking with an old player token and makes the instance reconnect on every refresh.
*/
Test.describe('RustPlusSync.applySyncServers (keepCredentials)', () => {
    Test.it('keeps the pairing credentials of a known server', () => {
        const instance = {
            serverList: {
                [`relay-${SERVER_ID}`]: {
                    title: "Captain's Quarters",
                    serverIp: 'relay',
                    appPort: SERVER_ID,
                    guid: SERVER_ID,
                    steamId: STEAM_ID,
                    playerToken: 1792502454,
                    switches: { [`${SWITCH_ID}`]: { name: 'Front Door', command: `${SWITCH_ID}` } },
                },
            },
        };

        const data = RustPlusSync.parseSyncPayload(syncPayload());
        const result = RustPlusSync.applySyncServers(instance, STEAM_ID, data.servers, intlGet,
            { keepCredentials: true });

        const server = instance.serverList[`relay-${SERVER_ID}`];

        Assert.strictEqual(server.playerToken, 1792502454);
        Assert.strictEqual(server.guid, SERVER_ID);
        Assert.strictEqual(server.title, "Captain's Quarters");

        /* Devices of the account are still added, and a changed token is not reported as a renewal. */
        Assert.ok(server.alarms[`${ALARM_ID}`]);
        Assert.strictEqual(result.updated, 0);
        Assert.deepStrictEqual(result.updatedKeys, []);
    });

    Test.it('takes the credentials when the entry has none yet', () => {
        const instance = { serverList: { [`relay-${SERVER_ID}`]: { title: 'x', playerToken: null } } };

        const data = RustPlusSync.parseSyncPayload(syncPayload());
        RustPlusSync.applySyncServers(instance, STEAM_ID, data.servers, intlGet, { keepCredentials: true });

        Assert.strictEqual(instance.serverList[`relay-${SERVER_ID}`].playerToken, 1623465021);
        Assert.strictEqual(instance.serverList[`relay-${SERVER_ID}`].guid, SERVER_ID);
    });
});
