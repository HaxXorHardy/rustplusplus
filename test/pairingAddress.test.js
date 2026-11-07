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

const PairingAddress = require('../src/util/fcm/pairingAddress.js');

const GUID = '6f2a1c3d-4b5e-4978-8a9b-0c1d2e3f4a5b';

function instance(serverList = {}) {
    return { serverList: serverList };
}

Test.describe('PairingAddress.resolveServerAddress', () => {
    Test.it('uses ip and port as key when the notification carries them', () => {
        const address = PairingAddress.resolveServerAddress(instance(), { ip: '1.2.3.4', port: 28082, id: GUID });

        Assert.deepStrictEqual(address,
            { serverId: '1.2.3.4-28082', serverIp: '1.2.3.4', appPort: '28082', guid: GUID });
    });

    Test.it('keeps the key of an entry that was paired with the same server id', () => {
        const instance0 = instance({
            '5.6.7.8-28082': { serverIp: '5.6.7.8', appPort: '28082', guid: GUID },
        });

        const address = PairingAddress.resolveServerAddress(instance0, { id: GUID });

        Assert.deepStrictEqual(address,
            { serverId: '5.6.7.8-28082', serverIp: '5.6.7.8', appPort: '28082', guid: GUID });
    });

    Test.it('keys a notification without ip/port by the pairing id', () => {
        const address = PairingAddress.resolveServerAddress(instance(), { id: GUID });

        Assert.strictEqual(address.serverId, `relay-${GUID}`);
        Assert.strictEqual(address.guid, GUID);
        /* The rustplus instance builds its server id as `<serverIp>-<appPort>`, it has to match the key. */
        Assert.strictEqual(`${address.serverIp}-${address.appPort}`, address.serverId);
    });

    Test.it('returns null when neither ip/port nor an id are present', () => {
        Assert.strictEqual(PairingAddress.resolveServerAddress(instance(), {}), null);
        Assert.strictEqual(PairingAddress.resolveServerAddress(instance(), { id: null }), null);
        Assert.strictEqual(PairingAddress.resolveServerAddress(instance(), null), null);
    });
});
