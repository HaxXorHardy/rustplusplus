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
    The device round of the poll (switches, alarms, storage monitors) runs every 30 polls, i.e. every five minutes. A
    device that the server does not know anymore answered not_found on every one of them, one ERROR line per round for
    hours. This is the memory of the devices that were not found, so they are asked once an hour instead.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const UnreachableDevices = require('../src/util/unreachableDevices.js');

Test.describe('UnreachableDevices', () => {
    Test.it('asks a device that answered before', () => {
        Assert.strictEqual(UnreachableDevices.isUnreachable({}, '116582'), false);
    });

    Test.it('keeps a device away for an hour after not_found', () => {
        const rustplus = {};
        const now = 1_000_000;

        UnreachableDevices.markUnreachable(rustplus, '116582', now);

        Assert.strictEqual(UnreachableDevices.isUnreachable(rustplus, '116582', now + 1000), true);
        Assert.strictEqual(
            UnreachableDevices.isUnreachable(rustplus, '116582', now + UnreachableDevices.RETRY_MS - 1), true);
        Assert.strictEqual(
            UnreachableDevices.isUnreachable(rustplus, '116582', now + UnreachableDevices.RETRY_MS), false);
    });

    Test.it('asks the other devices of the server', () => {
        const rustplus = {};

        UnreachableDevices.markUnreachable(rustplus, '116582');

        Assert.strictEqual(UnreachableDevices.isUnreachable(rustplus, '116584'), false);
    });

    Test.it('asks a device again as soon as it answered', () => {
        const rustplus = {};

        UnreachableDevices.markUnreachable(rustplus, '116582');
        UnreachableDevices.markReachable(rustplus, '116582');

        Assert.strictEqual(UnreachableDevices.isUnreachable(rustplus, '116582'), false);
    });

    /* The entity ids of the instance are strings, a caller may pass a number. */
    Test.it('uses the same entry for a number and a string id', () => {
        const rustplus = {};

        UnreachableDevices.markUnreachable(rustplus, 116582);
        Assert.strictEqual(UnreachableDevices.isUnreachable(rustplus, '116582'), true);

        UnreachableDevices.markReachable(rustplus, '116582');
        Assert.strictEqual(UnreachableDevices.isUnreachable(rustplus, 116582), false);
    });

    Test.it('keeps the list on the instance, not in the module', () => {
        const first = {};
        const second = {};

        UnreachableDevices.markUnreachable(first, '116582');

        Assert.strictEqual(UnreachableDevices.isUnreachable(first, '116582'), true);
        Assert.strictEqual(UnreachableDevices.isUnreachable(second, '116582'), false);
    });
});
