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
