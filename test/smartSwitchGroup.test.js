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
        generalSettings: { smartAlarmNotifyInGame: true },
        serverList: { server: {
            switches: switches,
            alarms: { 77: { name: 'Raid' }, 78: { name: 'Other' } },
            switchGroups: { 1: { name: 'G', switches: Object.keys(switches) } }
        } },
    };

    const calls = { running: 0, maxRunning: 0, requests: {}, notFound: [], groupMessages: 0 };
    const rustplus = {
        guildId: 'guild',
        serverId: 'server',
        interactionSwitches: [],
        get currentSwitchTimeouts() { return SwitchTimeouts.of('guild', 'server'); },
        inGame: [],
        sendInGameMessage: (text) => { rustplus.inGame.push(text); },
        log: () => undefined,
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
        rustplusInstances: { guild: rustplus },
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

    t.after(() => SwitchTimeouts.reset());

    return { instance, rustplus, client, calls };
}

const fast = { deps: { retryDelayMs: 0 } };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const actives = (instance) => Object.values(instance.serverList.server.switches).map((s) => s.active);

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

Test.describe('switch group: timer, toggle and automation', () => {
    Test.it('a timer switches the group now and back later, the end is known until then', async (t) => {
        const { instance, rustplus, client } = setup(t, 2);

        await SmartSwitchGroupHandler.setGroup(client, rustplus, 'guild', 'server', '1', true,
            Object.assign({ seconds: 0.05 }, fast));

        Assert.deepStrictEqual(actives(instance), [true, true]);
        const end = SwitchTimeouts.getEnd('guild', 'server', 'group-1');
        Assert.ok(end !== null && end.value === false, 'the message can show "turns off ..."');

        await wait(150);

        Assert.deepStrictEqual(actives(instance), [false, false], 'switched back');
        Assert.strictEqual(SwitchTimeouts.getEnd('guild', 'server', 'group-1'), null);
    });

    Test.it('the timer switches back on the connection that is current when it fires', async (t) => {
        const { instance, rustplus, client } = setup(t, 1);

        await SmartSwitchGroupHandler.setGroup(client, rustplus, 'guild', 'server', '1', true,
            Object.assign({ seconds: 0.05 }, fast));

        /* A reconnect: a new instance with its own request function. */
        let usedNew = 0;
        const rebuilt = Object.create(rustplus);
        rebuilt.turnSmartSwitchAsync = async () => { usedNew += 1; return 'ok'; };
        client.rustplusInstances.guild = rebuilt;

        await wait(150);

        Assert.strictEqual(usedNew, 1);
        Assert.deepStrictEqual(actives(instance), [false]);
    });

    Test.it('turning the group on or off cancels its timer', async (t) => {
        const { instance, rustplus, client } = setup(t, 1);

        await SmartSwitchGroupHandler.setGroup(client, rustplus, 'guild', 'server', '1', true,
            Object.assign({ seconds: 0.05 }, fast));
        await SmartSwitchGroupHandler.setGroup(client, rustplus, 'guild', 'server', '1', true, fast);

        await wait(150);

        Assert.deepStrictEqual(actives(instance), [true], 'not switched back');
        Assert.strictEqual(SwitchTimeouts.getEnd('guild', 'server', 'group-1'), null);
    });

    Test.it('toggle turns everything off when anything is on, otherwise on', async (t) => {
        const { instance, rustplus, client } = setup(t, 3);
        instance.serverList.server.switches['2'].active = true;

        await SmartSwitchGroupHandler.toggleGroup(client, rustplus, 'guild', 'server', '1', fast);
        Assert.deepStrictEqual(actives(instance), [false, false, false]);

        await SmartSwitchGroupHandler.toggleGroup(client, rustplus, 'guild', 'server', '1', fast);
        Assert.deepStrictEqual(actives(instance), [true, true, true]);
    });

    Test.it('day/night automation switches the groups when the time turns', async (t) => {
        const { instance, rustplus, client } = setup(t, 1);
        const groups = instance.serverList.server.switchGroups;
        instance.serverList.server.switches['2'] = { name: 'sw2', active: true, reachable: true };
        instance.serverList.server.switches['3'] = { name: 'sw3', active: false, reachable: true };
        groups[1].autoDayNight = SmartSwitchGroupHandler.AUTO_DAY;
        groups[2] = { name: 'Night', switches: ['2'], autoDayNight: SmartSwitchGroupHandler.AUTO_NIGHT };
        groups[3] = { name: 'Manual', switches: ['3'] };

        let turned = 'day';
        rustplus.time = { isTurnedDay: () => turned === 'day', isTurnedNight: () => turned === 'night' };

        await SmartSwitchGroupHandler.handler(rustplus, client, {});
        Assert.deepStrictEqual(actives(instance), [true, false, false], 'day: day group on, night group off');

        turned = 'night';
        await SmartSwitchGroupHandler.handler(rustplus, client, {});
        Assert.deepStrictEqual(actives(instance), [false, true, false]);

        turned = null;
        instance.serverList.server.switches['1'].active = true;
        await SmartSwitchGroupHandler.handler(rustplus, client, {});
        Assert.strictEqual(instance.serverList.server.switches['1'].active, true, 'nothing when the time did not turn');
    });

    Test.it('an alarm turns its groups on, and off again after the set time', async (t) => {
        const { instance, rustplus, client } = setup(t, 1);
        const group = instance.serverList.server.switchGroups[1];
        group.alarms = ['77'];
        group.alarmOffAfterSeconds = 0.05;

        await SmartSwitchGroupHandler.onAlarmTriggered(client, rustplus, 78);
        Assert.deepStrictEqual(actives(instance), [false], 'another alarm does nothing');

        /* parseInt: the stored setting is whole seconds, the test uses a short timer through the option. */
        group.alarmOffAfterSeconds = 1;
        await SmartSwitchGroupHandler.onAlarmTriggered(client, rustplus, 77);

        Assert.deepStrictEqual(actives(instance), [true]);
        Assert.ok(rustplus.inGame.some((l) => l === 'groupTurnedOnByAlarm'));
        const end = SwitchTimeouts.getEnd('guild', 'server', 'group-1');
        Assert.ok(end !== null && end.value === false, 'it turns off again');
    });

    Test.it('an alarm without an off time leaves the group on', async (t) => {
        const { instance, rustplus, client } = setup(t, 1);
        instance.serverList.server.switchGroups[1].alarms = ['77'];

        await SmartSwitchGroupHandler.onAlarmTriggered(client, rustplus, 77);

        Assert.deepStrictEqual(actives(instance), [true]);
        Assert.strictEqual(SwitchTimeouts.getEnd('guild', 'server', 'group-1'), null);
    });
});

Test.describe('switch group message', () => {
    const Client = require('../src/structures/clientRegistry.js');
    const DiscordSelectMenus = require('../src/discordTools/discordSelectMenus.js');
    const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');

    function withClient(t, instance) {
        const previous = Client.client;
        Client.client = { getInstance: () => instance, setInstance: () => undefined, intlGet: (g, key) => key };
        t.after(() => { Client.client = previous; });
    }

    function serverWith(count) {
        const switches = {};
        for (let i = 1; i <= count; i++) {
            switches[`${i}`] = { name: `sw${i}`, active: i === 1, reachable: true, location: null };
        }
        return {
            generalSettings: { prefix: '!' },
            serverList: { server: {
                title: 'Server',
                switches: switches,
                alarms: { 77: { name: 'Raid', location: 'G7' } },
                switchGroups: { 1: { name: 'G', command: 'g', image: 'x.png', switches: ['1', '2'], alarms: ['77'],
                    autoDayNight: 2, alarmOffAfterSeconds: 300 } }
            } },
        };
    }

    Test.it('offers the switches with the members selected, the automation and the alarms', (t) => {
        const instance = serverWith(3);
        withClient(t, instance);

        const rows = DiscordSelectMenus.getSmartSwitchGroupSelectMenus('guild', 'server', '1').map((r) => r.toJSON());

        Assert.strictEqual(rows.length, 3);
        const members = rows[0].components[0];
        Assert.deepStrictEqual(members.options.filter((o) => o.default).map((o) => o.value), ['1', '2']);
        Assert.strictEqual(members.min_values, 0);
        Assert.strictEqual(members.max_values, 3);
        Assert.deepStrictEqual(rows[2].components[0].options.filter((o) => o.default).map((o) => o.value), ['77']);
    });

    Test.it('stays within the 25 options of Discord, members first', (t) => {
        const instance = serverWith(30);
        instance.serverList.server.switchGroups[1].switches = ['29', '30'];
        withClient(t, instance);

        const members = DiscordSelectMenus.getSmartSwitchGroupSelectMenus('guild', 'server', '1')[0].toJSON()
            .components[0];

        Assert.strictEqual(members.options.length, 25);
        Assert.deepStrictEqual(members.options.slice(0, 2).map((o) => o.value), ['29', '30']);
    });

    Test.it('shows the state, the automation, the alarm and the timer', (t) => {
        const instance = serverWith(2);
        withClient(t, instance);

        SwitchTimeouts.of('guild', 'server')['group-1'] = setTimeout(() => undefined, 60000);
        SwitchTimeouts.setEnd('guild', 'server', 'group-1', Date.now() + 60000, false);
        t.after(() => SwitchTimeouts.reset());

        const description = DiscordEmbeds.getSmartSwitchGroupEmbed('guild', 'server', '1').toJSON().description;

        Assert.ok(description.includes('groupStatusSomeOn'), description);
        Assert.ok(description.includes('groupAutoNightDesc'));
        Assert.ok(description.includes('Raid') && description.includes('groupAlarmOffAfter'));
        Assert.ok(description.includes('groupTimerEnds'));
    });
});
