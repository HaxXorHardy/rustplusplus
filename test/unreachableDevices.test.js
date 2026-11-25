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

const DiscordMessages = require('../src/discordTools/discordMessages.js');
const SmartAlarmHandler = require('../src/handlers/smartAlarmHandler.js');
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

    Test.it('takes only the not_found of the server for a device that is gone', () => {
        Assert.strictEqual(UnreachableDevices.isNotFound({ error: 'not_found' }), true);

        Assert.strictEqual(UnreachableDevices.isNotFound(new Error('Timeout reached while waiting for response')), false);
        const closed = new Error('The relay socket closed before the server answered.');
        closed.code = 'ERELAYCLOSED';
        Assert.strictEqual(UnreachableDevices.isNotFound(closed), false);
        Assert.strictEqual(UnreachableDevices.isNotFound({ error: 'Tokens', localError: 'tokensDidNotReplenish' }), false);
        Assert.strictEqual(UnreachableDevices.isNotFound({ error: 'rate_limit' }), false);
        Assert.strictEqual(UnreachableDevices.isNotFound(undefined), false);
        Assert.strictEqual(UnreachableDevices.isNotFound({}), false);
    });
});

Test.describe('smart alarm round', () => {
    /* An alarm round (every 30 polls) with the answers of the server per alarm. */
    function setup(t, alarms, answers) {
        const instance = { serverList: { server: { alarms: alarms } } };
        const rustplus = {
            guildId: 'guild',
            serverId: 'server',
            smartAlarmIntervalCounter: 29,
            subscribed: [],
            async getEntityInfoAsync(entityId) { return answers[entityId]; },
            async isResponseValid(response) { return Boolean(response && response.entityInfo); },
            async subscribeAlarm(entityId) { this.subscribed.push(entityId); return true; },
        };
        const client = { getInstance: () => instance, setInstance: () => undefined };
        const notFound = t.mock.method(DiscordMessages, 'sendSmartAlarmNotFoundMessage', async () => undefined);
        t.mock.method(DiscordMessages, 'sendSmartAlarmMessage', async () => undefined);

        return { instance, rustplus, client, notFound };
    }

    Test.it('leaves an alarm that did not answer as it is', async (t) => {
        const { instance, rustplus, client, notFound } = setup(t, { 1: { reachable: true } },
            { 1: new Error('Timeout reached while waiting for response') });

        await SmartAlarmHandler.handler(rustplus, client);

        Assert.strictEqual(instance.serverList.server.alarms[1].reachable, true);
        Assert.strictEqual(notFound.mock.callCount(), 0, 'no not found message for a timeout');
        Assert.strictEqual(UnreachableDevices.isUnreachable(rustplus, '1'), false, 'asked again on the next round');
    });

    Test.it('marks an alarm the server does not know', async (t) => {
        const { instance, rustplus, client, notFound } = setup(t, { 1: { reachable: true } },
            { 1: { error: 'not_found' } });

        await SmartAlarmHandler.handler(rustplus, client);

        Assert.strictEqual(instance.serverList.server.alarms[1].reachable, false);
        Assert.strictEqual(notFound.mock.callCount(), 1);
        Assert.strictEqual(UnreachableDevices.isUnreachable(rustplus, '1'), true);
    });

    Test.it('subscribes an alarm again that answers again', async (t) => {
        const { instance, rustplus, client } = setup(t, { 1: { reachable: false }, 2: { reachable: true } },
            { 1: { entityInfo: { payload: { value: false } } }, 2: { entityInfo: { payload: { value: false } } } });

        await SmartAlarmHandler.handler(rustplus, client);

        Assert.strictEqual(instance.serverList.server.alarms[1].reachable, true);
        Assert.deepStrictEqual(rustplus.subscribed, ['1'], 'only the one that was skipped by the connect');
    });
});
