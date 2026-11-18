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

const DiscordMessages = require('../src/discordTools/discordMessages.js');
const SmartSwitchGroupHandler = require('../src/handlers/smartSwitchGroupHandler.js');
const SwitchTimeouts = require('../src/util/switchTimeouts.js');

function setup(t, count, answers = {}) {
    const switches = {};
    for (let i = 1; i <= count; i++) switches[`${i}`] = { name: `sw${i}`, active: false, reachable: true };
    const instance = {
        serverList: { server: { switches: switches, switchGroups: { 1: { switches: Object.keys(switches) } } } },
    };

    const calls = { running: 0, maxRunning: 0, requests: {}, notFound: [], groupMessages: 0 };
    const rustplus = {
        guildId: 'guild',
        serverId: 'server',
        interactionSwitches: [],
        currentSwitchTimeouts: {},
        isResponseValid: async (response) => response === 'ok',
        turnSmartSwitchAsync: async (entityId) => {
            calls.running += 1;
            calls.maxRunning = Math.max(calls.maxRunning, calls.running);
            calls.requests[entityId] = (calls.requests[entityId] || 0) + 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            calls.running -= 1;

            /* answers[entityId]: the answers in order, then 'ok'. */
            const list = answers[entityId] || [];
            return list.length !== 0 ? list.shift() : 'ok';
        },
    };
    const client = {
        logs: [],
        getInstance: () => instance,
        setInstance: () => undefined,
        intlGet: (guildId, key) => key,
        log: (cap, text) => client.logs.push(text),
    };

    t.mock.method(DiscordMessages, 'sendSmartSwitchMessage', async () => undefined);
    t.mock.method(DiscordMessages, 'sendSmartSwitchesNotFoundMessage',
        async (guildId, serverId, ids) => { calls.notFound.push(ids.slice().sort()); });
    t.mock.method(DiscordMessages, 'sendSmartSwitchGroupMessage', async () => { calls.groupMessages += 1; });

    return { instance, rustplus, client, calls };
}

Test.describe('switch group: turning on and off', () => {
    Test.it('switches several at a time, but not more than the limit', async (t) => {
        const { instance, rustplus, client, calls } = setup(t, 10);

        const result = await SmartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, 'guild', 'server', '1', true,
            { retryDelayMs: 0 });

        Assert.strictEqual(result.switched.length, 10);
        Assert.deepStrictEqual(result.failed, []);
        Assert.ok(calls.maxRunning > 1, 'in parallel');
        Assert.ok(calls.maxRunning <= SmartSwitchGroupHandler.SWITCH_CONCURRENCY, 'within the limit');
        Assert.ok(Object.values(instance.serverList.server.switches).every((s) => s.active === true));
        Assert.strictEqual(calls.groupMessages, 1, 'the group message is updated once');
    });

    Test.it('tries a switch that did not answer once more', async (t) => {
        const { instance, rustplus, client, calls } = setup(t, 2, { 2: ['error'] });

        const result = await SmartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, 'guild', 'server', '1', true,
            { retryDelayMs: 0 });

        Assert.strictEqual(calls.requests['2'], 2);
        Assert.deepStrictEqual(result.failed, []);
        Assert.strictEqual(instance.serverList.server.switches['2'].reachable, true);
        Assert.deepStrictEqual(calls.notFound, []);
    });

    Test.it('reports the switches that stay unreachable in one message and keeps their state', async (t) => {
        const { instance, rustplus, client, calls } = setup(t, 4, { 2: ['error', 'error'], 3: ['error', 'error'] });

        const result = await SmartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, 'guild', 'server', '1', true,
            { retryDelayMs: 0 });

        Assert.deepStrictEqual(result.switched.slice().sort(), ['1', '4']);
        Assert.deepStrictEqual(result.failed.slice().sort(), ['2', '3']);
        Assert.deepStrictEqual(calls.notFound, [['2', '3']], 'one message for both');
        Assert.strictEqual(instance.serverList.server.switches['2'].active, false, 'the old state stays');
        Assert.strictEqual(instance.serverList.server.switches['2'].reachable, false);
        Assert.ok(client.logs.some((l) => l.includes('2/4 switched, not reachable')));
    });

    Test.it('does not report a switch again that was already unreachable', async (t) => {
        const { instance, rustplus, client, calls } = setup(t, 1, { 1: ['error', 'error'] });
        instance.serverList.server.switches['1'].reachable = false;

        await SmartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, 'guild', 'server', '1', true,
            { retryDelayMs: 0 });

        Assert.deepStrictEqual(calls.notFound, []);
    });

    Test.it('leaves switches alone that are already in the wanted state', async (t) => {
        const { instance, rustplus, client, calls } = setup(t, 3);
        instance.serverList.server.switches['2'].active = true;

        const result = await SmartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, 'guild', 'server', '1', true,
            { retryDelayMs: 0 });

        Assert.deepStrictEqual(result.switched.slice().sort(), ['1', '3']);
        Assert.strictEqual(calls.requests['2'], undefined);
    });
});

Test.describe('switch timers outlive a reconnect', () => {
    Test.afterEach(() => SwitchTimeouts.reset());

    Test.it('a new connection of the same guild and server sees the same timers', () => {
        const RustPlus = require('../src/structures/RustPlus.js');
        const get = Object.getOwnPropertyDescriptor(RustPlus.prototype, 'currentSwitchTimeouts').get;

        const before = get.call({ guildId: 'guild', serverId: 'server' });
        before['5'] = setTimeout(() => undefined, 60000);
        const after = get.call({ guildId: 'guild', serverId: 'server' });

        Assert.strictEqual(after, before);
        Assert.ok(after['5']);
        Assert.notStrictEqual(get.call({ guildId: 'guild', serverId: 'other' }), before, 'per server');
    });

    Test.it('a timer uses the current connection, not the one it was started on', () => {
        const current = { serverId: 'server' };
        const client = { rustplusInstances: { guild: current } };

        Assert.strictEqual(SwitchTimeouts.currentInstance(client, 'guild', 'server'), current);
        Assert.strictEqual(SwitchTimeouts.currentInstance(client, 'guild', 'other'), null, 'another server now');
        Assert.strictEqual(SwitchTimeouts.currentInstance({ rustplusInstances: {} }, 'guild', 'server'), null);
    });
});
