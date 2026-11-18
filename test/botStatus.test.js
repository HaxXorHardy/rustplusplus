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

const BotStatus = require('../src/util/botStatus.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const StatusCommand = require('../src/commands/status.js');

function fakeClient(rustplus) {
    const instance = { activeServer: 'server', serverList: { server: { title: 'CQ', steamId: '1' } },
        informationMessageId: {}, channelId: { information: 'info' } };
    return {
        uptimeBot: new Date(Date.now() - 3600 * 1000),
        ws: { ping: 42 },
        rustplusInstances: rustplus ? { guild: rustplus } : {},
        getInstance: () => instance,
        setInstance: () => undefined,
        intlGet: (guildId, key, variables) => (variables ? `${key}(${Object.values(variables).join(',')})` : key),
    };
}

Test.describe('/status', () => {
    Test.afterEach(() => BotStatus.reset());

    Test.it('keeps the last warnings and errors, not the info lines', () => {
        BotStatus.record('info', 'INFO', 'hello');
        for (let i = 0; i < BotStatus.MAX_WARNINGS + 5; i++) BotStatus.record('warn', 'WARNING', `w${i}`);
        BotStatus.record('error', 'ERROR', 'boom');

        const recent = BotStatus.recentWarnings(3).map((w) => w.text);
        Assert.deepStrictEqual(recent, [`w${BotStatus.MAX_WARNINGS + 3}`, `w${BotStatus.MAX_WARNINGS + 4}`, 'boom']);
    });

    Test.it('collects connection, token and push from the live objects', () => {
        const now = Date.now();
        const client = fakeClient({ isOperational: true, relayConnectedAtMs: now - 60000, lastSuccessfulPollMs: now - 5000 });
        BotStatus.noteDisconnect('guild', now - 1000);

        const status = BotStatus.collect(client, 'guild', {
            version: '9.9.9',
            auth: { tokenExpiresAt: Math.floor(now / 1000) + 3600 },
            push: { persistentIds: ['a', 'b'], registration: { expiresAt: Math.floor(now / 1000) + 7200 } },
            pushState: { up: true, downSince: null },
            tokenRefused: true,
        }, now);

        Assert.strictEqual(status.connection, 'operational');
        Assert.strictEqual(status.server, 'CQ');
        Assert.strictEqual(status.socketAgeMs, 60000);
        Assert.strictEqual(status.lastPollAgoMs, 5000);
        Assert.strictEqual(status.disconnects.count, 1);
        Assert.strictEqual(status.pushNotifications, 2);
        Assert.ok(Math.abs(status.tokenExpiresMs - (now + 3600 * 1000)) < 1000);
        Assert.strictEqual(status.tokenRefused, true);
    });

    Test.it('builds an embed for a bot without a connection', () => {
        const client = fakeClient(null);
        BotStatus.record('warn', 'WARNING', 'Editing message 1 did not finish within 90 s.');

        const embed = StatusCommand.buildEmbed(client, 'guild', BotStatus.collect(client, 'guild', {})).toJSON();

        Assert.ok(embed.title.includes('statusTitle'));
        Assert.ok(embed.description.includes('statusOffline'));
        Assert.ok(embed.description.includes('statusPushOff'));
        Assert.ok(embed.description.includes('did not finish within 90 s'));
    });
});

Test.describe('information messages are only edited when they changed', () => {
    const Discord = require('discord.js');
    const Client = require('../src/structures/clientRegistry.js');

    Test.it('skips an unchanged embed and edits a changed one without uploading the logo again', async (t) => {
        const client = fakeClient(null);
        const previous = Client.client;
        Client.client = client;
        t.after(() => { Client.client = previous; DiscordMessages.resetInformationSent(); });
        DiscordMessages.resetInformationSent();

        const sent = [];
        t.mock.method(DiscordMessages, 'sendMessage', async (guildId, content, messageId) => {
            sent.push({ messageId: messageId, files: content.files ? content.files.length : 0 });
            return { id: messageId || 'm1' };
        });

        const content = (text) => ({
            embeds: [new Discord.EmbedBuilder().setTitle(text).setTimestamp()],
            files: [new Discord.AttachmentBuilder('/x/server_info_logo.png')]
        });

        await DiscordMessages.sendInformationMessage('guild', 'server', content('a'));
        Assert.deepStrictEqual(sent, [{ messageId: undefined, files: 1 }], 'the first post carries the logo');

        sent.length = 0;
        await DiscordMessages.sendInformationMessage('guild', 'server', content('a'));
        await DiscordMessages.sendInformationMessage('guild', 'server', content('a'));
        Assert.deepStrictEqual(sent, [], 'nothing changed, nothing is sent (the timestamp does not count)');

        await DiscordMessages.sendInformationMessage('guild', 'server', content('b'));
        Assert.deepStrictEqual(sent, [{ messageId: 'm1', files: 0 }], 'changed: edited, the logo stays as it is');
    });
});
