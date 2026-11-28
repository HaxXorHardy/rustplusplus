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

const Client = require('../src/structures/clientRegistry.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const SmartSwitchHandler = require('../src/handlers/smartSwitchHandler.js');
const SwitchTimeouts = require('../src/util/switchTimeouts.js');
const SwitchTimerRestore = require('../src/handlers/switchTimerRestore.js');
const Time = require('../src/structures/Time.js');

const TIMEOUT = () => new Error('Timeout reached while waiting for response');
const DAY = { sunrise: 7, sunset: 19, time: 8 };

function timeAt(hour) {
    const time = Object.create(Time.prototype);
    time.updateTime({ dayLengthMinutes: 60, timeScale: 1, sunrise: 7, sunset: 19, time: hour });
    return time;
}

/* answers[entityId]: the answers of the switch requests in order, then 'ok'. */
function setup(t, switches, answers = {}) {
    const instance = { serverList: { server: { switches: switches, switchGroups: {} } } };
    const requests = [];
    const rustplus = {
        guildId: 'guild',
        serverId: 'server',
        smartSwitchIntervalCounter: 0,
        interactionSwitches: [],
        team: { players: [] },
        time: timeAt(5),
        inGame: [],
        sendInGameMessage: (text) => { rustplus.inGame.push(text); },
        log: () => undefined,
        isResponseValid: async (response) => response === 'ok',
        turnSmartSwitchAsync: async (entityId, value) => {
            requests.push([entityId, value]);
            const list = answers[entityId] || [];
            return list.length !== 0 ? list.shift() : 'ok';
        },
    };
    const client = {
        rustplusInstances: { guild: rustplus },
        getInstance: () => instance,
        setInstance: () => undefined,
        intlGet: (guildId, key) => key,
        log: () => undefined,
    };

    const previous = Client.client;
    Client.client = client;
    t.mock.method(DiscordMessages, 'sendSmartSwitchMessage', async () => undefined);
    t.mock.method(DiscordMessages, 'sendSmartSwitchNotFoundMessage', async () => undefined);
    t.mock.method(DiscordMessages, 'sendSmartSwitchGroupMessage', async () => undefined);
    t.after(() => { Client.client = previous; SwitchTimeouts.reset(); });

    return { instance, rustplus, client, requests };
}

const sw = (mode, active) => ({ name: `mode ${mode}`, autoDayNightOnOff: mode, active: active, reachable: true,
    location: null });

Test.describe('smart switch automation', () => {
    Test.it('keeps the previous state of a switch that did not answer, so AUTO-ON tries again', async (t) => {
        const { instance, rustplus, client, requests } = setup(t, { 1: sw(3, false) }, { 1: [TIMEOUT()] });

        await SmartSwitchHandler.handler(rustplus, client, DAY);
        Assert.strictEqual(instance.serverList.server.switches[1].active, false, 'not shown as on');
        Assert.strictEqual(instance.serverList.server.switches[1].reachable, true, 'a timeout is no not_found');

        await SmartSwitchHandler.handler(rustplus, client, DAY);
        Assert.strictEqual(instance.serverList.server.switches[1].active, true);
        Assert.strictEqual(requests.length, 2);
    });

    Test.it('keeps the previous state at the day/night turn when the switch did not answer', async (t) => {
        const { instance, rustplus, client } = setup(t, { 1: sw(1, false), 2: sw(2, true) },
            { 1: [TIMEOUT()], 2: [TIMEOUT()] });

        await SmartSwitchHandler.handler(rustplus, client, DAY);

        Assert.strictEqual(instance.serverList.server.switches[1].active, false);
        Assert.strictEqual(instance.serverList.server.switches[2].active, true);
    });

    Test.it('switches at the day/night turn also when the round at the edge was skipped', async (t) => {
        const { instance, rustplus, client } = setup(t, { 1: sw(1, false), 2: sw(2, true) });

        await SmartSwitchHandler.handler(rustplus, client, { sunrise: 7, sunset: 19, time: 6 });
        Assert.strictEqual(instance.serverList.server.switches[1].active, false, 'still night');

        /* The poll at sunrise skipped the handler, the stored time moved on. */
        rustplus.time.updateTime(DAY);
        await SmartSwitchHandler.handler(rustplus, client, DAY);

        Assert.strictEqual(instance.serverList.server.switches[1].active, true, 'AUTO-DAY on');
        Assert.strictEqual(instance.serverList.server.switches[2].active, false, 'AUTO-NIGHT off');

        instance.serverList.server.switches[1].active = false;
        await SmartSwitchHandler.handler(rustplus, client, DAY);
        Assert.strictEqual(instance.serverList.server.switches[1].active, false, 'the turn is applied once');
    });

    Test.it('a switch deleted while another one is switched is skipped', async (t) => {
        const { instance, rustplus, client, requests } = setup(t, { 1: sw(3, false), 2: sw(3, false), 3: sw(3, false) });
        const turn = rustplus.turnSmartSwitchAsync;
        rustplus.turnSmartSwitchAsync = async (entityId, value) => {
            if (entityId === '1') delete instance.serverList.server.switches[2];
            return turn(entityId, value);
        };

        await Assert.doesNotReject(SmartSwitchHandler.handler(rustplus, client, DAY));

        Assert.deepStrictEqual(requests.map((r) => r[0]), ['1', '3']);
        Assert.strictEqual(instance.serverList.server.switches[3].active, true);
    });

    Test.it('a switch deleted during its own request is left alone', async (t) => {
        const { instance, rustplus, client } = setup(t, { 1: sw(3, false) });
        rustplus.turnSmartSwitchAsync = async () => {
            delete instance.serverList.server.switches[1];
            return TIMEOUT();
        };

        await Assert.doesNotReject(SmartSwitchHandler.handler(rustplus, client, DAY));
        Assert.deepStrictEqual(rustplus.interactionSwitches, []);
    });
});

Test.describe('switch-back of a switch timer', () => {
    const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve)); };

    Test.it('tries a switch-back that did not answer again and announces it only when it switched', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const { instance, rustplus, client } = setup(t, { 5: Object.assign(sw(0, true), { name: 'Lamp' }) },
            { 5: [TIMEOUT()] });

        SwitchTimeouts.schedule('guild', 'server', '5', 1000, { kind: 'switch', id: '5', value: false, inGame: true },
            () => SmartSwitchHandler.switchBack(client, 'guild', 'server', '5', false, true));

        t.mock.timers.tick(1000);
        await flush();
        Assert.strictEqual(instance.serverList.server.switches[5].active, true, 'no answer: still on');
        Assert.ok(!rustplus.inGame.includes('automaticallyTurningBackOnOff'), 'not announced');
        Assert.notStrictEqual(SwitchTimeouts.getEnd('guild', 'server', '5'), null, 'a retry is due');

        t.mock.timers.tick(SmartSwitchHandler.SWITCH_BACK_RETRY_DELAYS_MS[0]);
        await flush();
        Assert.strictEqual(instance.serverList.server.switches[5].active, false, 'switched back');
        Assert.strictEqual(rustplus.inGame.filter((l) => l === 'automaticallyTurningBackOnOff').length, 1);
        Assert.strictEqual(SwitchTimeouts.getEnd('guild', 'server', '5'), null);
    });

    Test.it('gives up a switch the server does not know', async (t) => {
        const { rustplus, client } = setup(t, { 5: sw(0, true) }, { 5: [{ error: 'not_found' }] });

        Assert.strictEqual(await SmartSwitchHandler.switchBack(client, 'guild', 'server', '5', false, true), false);
        Assert.strictEqual(SwitchTimeouts.getEnd('guild', 'server', '5'), null, 'no retry');
        Assert.ok(!rustplus.inGame.includes('automaticallyTurningBackOnOff'));
    });

    Test.it('a restored timer announces the switch-back only when it switched', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const now = Date.now();
        const { instance, rustplus, client } = setup(t, { 5: sw(0, true) }, { 5: [TIMEOUT()] });
        instance.serverList.server.pendingTimers = {
            5: { kind: 'switch', id: '5', value: false, inGame: true, endsAtMs: now - 1000 },
        };

        Assert.strictEqual(SwitchTimerRestore.restore(client, rustplus, now), 1);
        t.mock.timers.tick(SwitchTimerRestore.RESTORE_MIN_DELAY_MS);
        await flush();

        Assert.ok(!rustplus.inGame.includes('automaticallyTurningBackOnOff'), 'not announced without an answer');
        Assert.ok(instance.serverList.server.pendingTimers[5], 'the retry is stored for a restart');

        t.mock.timers.tick(SmartSwitchHandler.SWITCH_BACK_RETRY_DELAYS_MS[0]);
        await flush();
        Assert.strictEqual(instance.serverList.server.switches[5].active, false);
        Assert.ok(rustplus.inGame.includes('automaticallyTurningBackOnOff'));
    });
});
