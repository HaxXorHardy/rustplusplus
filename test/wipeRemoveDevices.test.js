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
const WipeHelper = require('../src/handlers/wipeHelper.js');

function setup(t) {
    const instance = {
        channelId: { switches: 'cs', alarms: 'ca', storageMonitors: 'cm' },
        serverList: { server: {
            guid: 'pairing',
            title: 'CQ',
            switches: { 1: { messageId: 'm1' }, 2: { messageId: 'm2' } },
            alarms: { 3: { messageId: 'm3' } },
            storageMonitors: { 4: { messageId: 'm4' } },
            switchGroups: { 9: { name: 'Lights', switches: ['1', '2'], alarms: ['3'], schedule: { windows: [] } } },
        } },
    };
    const client = {
        getInstance: () => instance,
        setInstance: () => undefined,
        intlGet: (guildId, key) => key,
        log: () => undefined,
        rustplusInstances: { guild: { storageMonitors: { 4: { items: [] } } } },
    };
    const previous = Client.client;
    Client.client = client;
    t.after(() => { Client.client = previous; SwitchTimeouts.reset(); });

    const deleted = [];
    const deps = { deleteMessage: async (channelId, messageId) => { deleted.push(`${channelId}/${messageId}`); },
        skipGroupMessages: true };

    return { instance, client, deleted, deps, server: instance.serverList.server };
}

Test.describe('removing the devices after a wipe', () => {
    Test.it('removes only the devices of the old map, not the ones paired after the wipe', async (t) => {
        const { client, server, deleted, deps, instance } = setup(t);

        WipeHelper.clearOldMap(client, 'guild', 'server');
        server.switches[5] = { messageId: 'm5' };   /* paired on the new map */

        Assert.strictEqual(WipeHelper.countOf(WipeHelper.devicesToRemove(server)), 4);

        const removed = await WipeHelper.removeOldDevices(client, 'guild', 'server', {}, deps);

        Assert.deepStrictEqual(removed, { switches: 2, alarms: 1, storageMonitors: 1 });
        Assert.deepStrictEqual(Object.keys(server.switches), ['5']);
        Assert.deepStrictEqual(server.alarms, {});
        Assert.deepStrictEqual(server.storageMonitors, {});
        Assert.deepStrictEqual(deleted.sort(), ['ca/m3', 'cm/m4', 'cs/m1', 'cs/m2']);
        Assert.ok(instance.deletedDevices.pairing['1'], 'marked: the history cannot bring them back');
        Assert.strictEqual(client.rustplusInstances.guild.storageMonitors[4], undefined);
        Assert.strictEqual(server.wipeOldDevices, undefined);
    });

    Test.it('keeps the groups and takes the removed switches and alarms out of them', async (t) => {
        const { client, server, deps } = setup(t);

        await WipeHelper.removeOldDevices(client, 'guild', 'server', { all: true }, deps);

        const group = server.switchGroups[9];
        Assert.strictEqual(group.name, 'Lights');
        Assert.deepStrictEqual(group.switches, []);
        Assert.deepStrictEqual(group.alarms, []);
        Assert.ok(group.schedule, 'the settings of the group stay');
    });

    Test.it('removes all devices without a wipe snapshot (/removedevices) and cancels switch timers', async (t) => {
        const { client, server, deps } = setup(t);
        SwitchTimeouts.schedule('guild', 'server', '1', 60000, { kind: 'switch', id: '1', value: false },
            async () => undefined);

        const removed = await WipeHelper.removeOldDevices(client, 'guild', 'server', { all: true }, deps);

        Assert.strictEqual(removed.switches, 2);
        Assert.strictEqual(SwitchTimeouts.getEnd('guild', 'server', '1'), null);
        Assert.deepStrictEqual(server.pendingTimers, {});
    });

    Test.it('/removedevices is a valid command definition', () => {
        const en = require('../src/languages/en.json');
        const json = require('../src/commands/removedevices.js')
            .getSlashCommandDefinition({ intlGet: (g, key) => en[key] || key }, 'guild').toJSON();
        Assert.strictEqual(json.name, 'removedevices');
        Assert.ok(json.description.length <= 100);
    });
});
