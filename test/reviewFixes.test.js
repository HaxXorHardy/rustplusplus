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

/* The weak spots found in the review of 1.42.3 - 1.50.1. */

const Assert = require('node:assert');
const Test = require('node:test');

const BotStatus = require('../src/util/botStatus.js');
const Client = require('../src/structures/clientRegistry.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const StorageAlerts = require('../src/util/storageAlerts.js');
const SwitchTimeouts = require('../src/util/switchTimeouts.js');

function withClient(t, client) {
    const previous = Client.client;
    Client.client = client;
    t.after(() => { Client.client = previous; });
}

Test.describe('review fixes', () => {
    Test.it('warnings of the Rust+ connection reach /status', () => {
        BotStatus.reset();
        const RustPlus = require('../src/structures/RustPlus.js');

        RustPlus.prototype.log.call({ logger: { log: () => undefined } }, 'ERROR', 'The relay rejected the handshake.',
            'error');
        RustPlus.prototype.log.call({ logger: { log: () => undefined } }, 'INFO', 'Poll cycles: 6', 'info');

        Assert.deepStrictEqual(BotStatus.recentWarnings().map((w) => w.text), ['The relay rejected the handshake.']);
        BotStatus.reset();
    });

    Test.it('storage alerts are not checked against the old contents of an unreachable monitor', async (t) => {
        const entity = { name: 'Turret box', reachable: false, inGame: false,
            alerts: [{ itemId: '1', op: '<', amount: 100, triggered: false }] };
        const instance = { serverList: { server: { storageMonitors: { 7: entity } } } };
        withClient(t, { getInstance: () => instance, setInstance: () => undefined, intlGet: (g, k) => k,
            items: { getName: () => 'Ammo' } });
        t.mock.method(DiscordMessages, 'sendStorageAlertMessage', async () => undefined);

        const rustplus = { guildId: 'guild', serverId: 'server', log: () => undefined, sendInGameMessage: () => undefined,
            storageMonitors: { 7: { items: [] } } };

        await StorageAlerts.check(Client.client, rustplus, '7');
        Assert.strictEqual(DiscordMessages.sendStorageAlertMessage.mock.callCount(), 0);

        entity.reachable = true;
        await StorageAlerts.check(Client.client, rustplus, '7');
        Assert.strictEqual(DiscordMessages.sendStorageAlertMessage.mock.callCount(), 1, 'reachable: it reports');
    });

    Test.it('an unchanged information message is still edited every ten minutes (brings a deleted one back)', async (t) => {
        const Discord = require('discord.js');
        const instance = { informationMessageId: {}, channelId: { information: 'info' } };
        withClient(t, { getInstance: () => instance, setInstance: () => undefined });
        DiscordMessages.resetInformationSent();
        t.after(() => DiscordMessages.resetInformationSent());
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });

        let sends = 0;
        t.mock.method(DiscordMessages, 'sendMessage', async (guildId, content, messageId) => {
            sends += 1;
            return { id: messageId || 'm1' };
        });
        const content = () => ({ embeds: [new Discord.EmbedBuilder().setTitle('same')] });

        await DiscordMessages.sendInformationMessage('guild', 'server', content());
        await DiscordMessages.sendInformationMessage('guild', 'server', content());
        Assert.strictEqual(sends, 1, 'unchanged right after: skipped');

        t.mock.timers.tick(10 * 60 * 1000);
        await DiscordMessages.sendInformationMessage('guild', 'server', content());
        Assert.strictEqual(sends, 2, 'unchanged after ten minutes: edited again');
    });

    Test.it('replacing a timer writes the instance once', (t) => {
        const instance = { serverList: { server: {} } };
        let writes = 0;
        withClient(t, { getInstance: () => instance, setInstance: () => { writes += 1; } });
        t.after(() => SwitchTimeouts.reset());

        SwitchTimeouts.schedule('guild', 'server', 'group-1', 60000, { kind: 'group', id: '1', value: false },
            async () => undefined);
        const first = writes;
        SwitchTimeouts.schedule('guild', 'server', 'group-1', 60000, { kind: 'group', id: '1', value: true },
            async () => undefined);

        Assert.strictEqual(first, 1);
        Assert.strictEqual(writes - first, 1, 'one write for the replacement');
        Assert.strictEqual(instance.serverList.server.pendingTimers['group-1'].value, true);
    });
});
