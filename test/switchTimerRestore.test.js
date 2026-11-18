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
const SwitchTimeouts = require('../src/util/switchTimeouts.js');
const SwitchTimerRestore = require('../src/handlers/switchTimerRestore.js');

function setup(t, pendingTimers) {
    const instance = { serverList: { server: {
        switches: { 5: { name: 'Door', active: true, reachable: true } },
        switchGroups: { 1: { name: 'Lights', switches: ['5'] } },
        pendingTimers: pendingTimers
    } } };
    let writes = 0;
    const client = {
        getInstance: () => instance,
        setInstance: () => { writes += 1; },
        intlGet: (guildId, key) => key,
        log: () => undefined,
        rustplusInstances: {},
    };
    const previous = Client.client;
    Client.client = client;
    t.after(() => { Client.client = previous; SwitchTimeouts.reset(); });

    const rustplus = { guildId: 'guild', serverId: 'server', log: () => undefined };
    client.rustplusInstances.guild = rustplus;

    return { instance, client, rustplus, writes: () => writes };
}

Test.describe('switch timers survive a restart', () => {
    Test.it('a started timer is written to the instance and removed when it is cancelled', (t) => {
        const { instance } = setup(t, undefined);

        SwitchTimeouts.schedule('guild', 'server', 'group-1', 60000, { kind: 'group', id: '1', value: false },
            async () => undefined);
        const stored = instance.serverList.server.pendingTimers['group-1'];
        Assert.strictEqual(stored.kind, 'group');
        Assert.strictEqual(stored.value, false);
        Assert.ok(Math.abs(stored.endsAtMs - (Date.now() + 60000)) < 1000);

        SwitchTimeouts.cancel('guild', 'server', 'group-1');
        Assert.deepStrictEqual(instance.serverList.server.pendingTimers, {});
    });

    Test.it('a timer that fired is removed from the instance', async (t) => {
        const { instance } = setup(t, undefined);
        let fired = 0;

        SwitchTimeouts.schedule('guild', 'server', '5', 10, { kind: 'switch', id: '5', value: false },
            async () => { fired += 1; });
        await new Promise((resolve) => setTimeout(resolve, 50));

        Assert.strictEqual(fired, 1);
        Assert.deepStrictEqual(instance.serverList.server.pendingTimers, {});
    });

    Test.it('restores the stored timers with the time that is left, a due one shortly after the start', (t) => {
        const now = Date.now();
        const { client, rustplus } = setup(t, {
            'group-1': { kind: 'group', id: '1', value: false, inGame: true, endsAtMs: now + 120000 },
            5: { kind: 'switch', id: '5', value: true, inGame: false, endsAtMs: now - 60000 },
            broken: { kind: 'other' },
        });

        Assert.strictEqual(SwitchTimerRestore.restore(client, rustplus, now), 2);

        const group = SwitchTimeouts.getEnd('guild', 'server', 'group-1');
        Assert.ok(group !== null && Math.abs(group.endsAtMs - (now + 120000)) < 1000);
        Assert.strictEqual(group.value, false);

        const due = SwitchTimeouts.getEnd('guild', 'server', '5');
        Assert.ok(due !== null);
        Assert.ok(due.endsAtMs - Date.now() <= SwitchTimerRestore.RESTORE_MIN_DELAY_MS + 50);

        Assert.ok(!client.getInstance().serverList.server.pendingTimers.broken, 'an invalid entry is dropped');
    });

    Test.it('does not start a timer twice after a reconnect', (t) => {
        const now = Date.now();
        const { client, rustplus } = setup(t, {
            'group-1': { kind: 'group', id: '1', value: false, endsAtMs: now + 120000 },
        });

        Assert.strictEqual(SwitchTimerRestore.restore(client, rustplus, now), 1);
        Assert.strictEqual(SwitchTimerRestore.restore(client, rustplus, now), 0, 'it still runs');
    });
});
