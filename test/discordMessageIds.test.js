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
const DiscordTools = require('../src/discordTools/discordTools.js');
const InstanceUtils = require('../src/util/instanceUtils.js');
const RemoveGuildChannels = require('../src/discordTools/RemoveGuildChannels.js');

/* Message ids become stale when the channels are recreated by /reset, the message helpers have to
   survive that instead of throwing. These tests stub the Discord client, nothing is sent. */
function fakeClient(overrides = {}) {
    return {
        messageEdit: async (message, content) => ({ id: message.id, content: content }),
        messageSend: async (channel, content) => ({ id: 'new-message-id', channelId: channel.id, content: content }),
        interactionUpdate: async () => ({ id: 'interaction-message-id' }),
        log: () => undefined,
        intlGet: (guildId, key) => key,
        ...overrides,
    };
}

function fakeChannel(id) {
    return { id: id };
}

/* An instance with every kind of tracked message id set. */
function fakeInstance() {
    return {
        channelId: { category: null, information: null, servers: null },
        informationMessageId: {
            map: '1', server: '2', event: '3', team: '4', battlemetricsPlayers: '5', monument: '6'
        },
        serverList: {
            serverId: {
                messageId: '7',
                switches: { entityId: { messageId: '8' } },
                alarms: { entityId: { messageId: '9' } },
                storageMonitors: { entityId: { messageId: '10' } },
                switchGroups: { groupId: { messageId: '11' } }
            }
        },
        trackers: { trackerId: { messageId: '12' } }
    };
}

Test.describe('DiscordTools lookups with cleared ids', () => {
    Test.it('getMessageById returns null when the ids are missing', async () => {
        Assert.strictEqual(await DiscordTools.getMessageById('guildId', null, null), null);
        Assert.strictEqual(await DiscordTools.getMessageById('guildId', 'channelId', null), null);
        Assert.strictEqual(await DiscordTools.getMessageById('guildId', null, 'messageId'), null);
    });

    Test.it('removeTextChannel and removeCategory report success for cleared ids', async () => {
        Assert.strictEqual(await DiscordTools.removeTextChannel('guildId', null), true);
        Assert.strictEqual(await DiscordTools.removeCategory('guildId', null), true);
    });
});

Test.describe('DiscordMessages.sendMessage', () => {
    const originalGetMessageById = DiscordTools.getMessageById;
    const originalGetTextChannelById = DiscordTools.getTextChannelById;

    Test.afterEach(() => {
        DiscordTools.getMessageById = originalGetMessageById;
        DiscordTools.getTextChannelById = originalGetTextChannelById;
        Client.client = null;
    });

    Test.it('edits the stored message when it still exists', async () => {
        Client.client = fakeClient();
        DiscordTools.getMessageById = async () => ({ id: 'stored-message-id' });
        DiscordTools.getTextChannelById = () => fakeChannel('channelId');

        const message = await DiscordMessages.sendMessage(
            'guildId', { content: 'text' }, 'stored-message-id', 'channelId');

        Assert.strictEqual(message.id, 'stored-message-id');
    });

    Test.it('posts a new message when the stored message is gone', async () => {
        Client.client = fakeClient();
        DiscordTools.getMessageById = async () => null;
        DiscordTools.getTextChannelById = () => fakeChannel('channelId');

        const message = await DiscordMessages.sendMessage(
            'guildId', { content: 'text' }, 'stale-message-id', 'channelId');

        Assert.strictEqual(message.id, 'new-message-id');
    });

    Test.it('posts a new message when no message id is stored', async () => {
        Client.client = fakeClient();
        DiscordTools.getMessageById = async () => {
            throw new Error('the message should not be fetched without an id');
        };
        DiscordTools.getTextChannelById = () => fakeChannel('channelId');

        const message = await DiscordMessages.sendMessage('guildId', { content: 'text' }, null, 'channelId');

        Assert.strictEqual(message.id, 'new-message-id');
    });

    Test.it('gives up an edit that never answers', async (t) => {
        const original = DiscordMessages.SEND_MESSAGE_TIMEOUT_MS;
        t.after(() => { DiscordMessages.SEND_MESSAGE_TIMEOUT_MS = original; });
        DiscordMessages.SEND_MESSAGE_TIMEOUT_MS = 20;

        const logs = [];
        Client.client = fakeClient({
            messageEdit: () => new Promise(() => undefined),
            log: (cap, text, level) => logs.push({ text: text, level: level }),
        });
        DiscordTools.getMessageById = async () => ({ id: 'stored-message-id' });
        DiscordTools.getTextChannelById = () => fakeChannel('channelId');

        const message = await DiscordMessages.sendMessage(
            'guildId', { content: 'text' }, 'stored-message-id', 'channelId');

        Assert.strictEqual(message, undefined);
        Assert.ok(logs.some((line) => line.level === 'warn' && line.text.includes('Editing message stored-message-id')));
    });

    Test.it('does not post a duplicate when the fetch never answers', async (t) => {
        const original = DiscordMessages.SEND_MESSAGE_TIMEOUT_MS;
        t.after(() => { DiscordMessages.SEND_MESSAGE_TIMEOUT_MS = original; });
        DiscordMessages.SEND_MESSAGE_TIMEOUT_MS = 20;

        let posted = 0;
        Client.client = fakeClient({ messageSend: async () => { posted++; return { id: 'duplicate' }; } });
        DiscordTools.getMessageById = () => new Promise(() => undefined);
        DiscordTools.getTextChannelById = () => fakeChannel('channelId');

        const message = await DiscordMessages.sendMessage(
            'guildId', { content: 'text' }, 'stored-message-id', 'channelId');

        Assert.strictEqual(message, undefined);
        Assert.strictEqual(posted, 0);
    });

    Test.it('gives up a post that never answers', async (t) => {
        const original = DiscordMessages.SEND_MESSAGE_TIMEOUT_MS;
        t.after(() => { DiscordMessages.SEND_MESSAGE_TIMEOUT_MS = original; });
        DiscordMessages.SEND_MESSAGE_TIMEOUT_MS = 20;

        Client.client = fakeClient({ messageSend: () => new Promise(() => undefined) });
        DiscordTools.getMessageById = async () => null;
        DiscordTools.getTextChannelById = () => fakeChannel('channelId');

        const message = await DiscordMessages.sendMessage('guildId', { content: 'text' }, null, 'channelId');

        Assert.strictEqual(message, undefined);
    });

    Test.it('returns undefined when the channel is gone', async () => {
        let logged = 0;
        Client.client = fakeClient({ log: () => logged++ });
        DiscordTools.getMessageById = async () => null;
        DiscordTools.getTextChannelById = () => null;

        const message = await DiscordMessages.sendMessage('guildId', { content: 'text' }, null, 'channelId');

        Assert.strictEqual(message, undefined);
        Assert.strictEqual(logged, 1);
    });
});

Test.describe('DiscordMessages.sendStorageMonitorMessage coalescing', () => {
    const originalNow = DiscordMessages.sendStorageMonitorMessageNow;
    const tick = () => new Promise((resolve) => setImmediate(resolve));

    Test.afterEach(() => {
        DiscordMessages.sendStorageMonitorMessageNow = originalNow;
    });

    Test.it('runs one edit at a time and one more for the changes that came in meanwhile', async () => {
        const releases = [];
        let edits = 0;
        DiscordMessages.sendStorageMonitorMessageNow = () => {
            edits++;
            return new Promise((resolve) => releases.push(resolve));
        };

        /* A burst of ten pushes while the first edit waits on Discord. */
        const first = DiscordMessages.sendStorageMonitorMessage('g', 's', 'e');
        const rest = [];
        for (let i = 0; i < 9; i++) rest.push(DiscordMessages.sendStorageMonitorMessage('g', 's', 'e'));

        /* The later calls return at once, they do not wait behind the edit. */
        await Promise.all(rest);
        Assert.strictEqual(edits, 1);

        releases[0]();
        await first;
        await tick();

        /* Exactly one follow-up edit for the nine changes. */
        Assert.strictEqual(edits, 2);

        releases[1]();
        await tick();
        await tick();
        Assert.strictEqual(edits, 2);

        /* Done: the next push edits right away again. */
        const next = DiscordMessages.sendStorageMonitorMessage('g', 's', 'e');
        Assert.strictEqual(edits, 3);
        releases[2]();
        await next;
    });

    Test.it('keeps different monitors apart and does not coalesce button updates', async () => {
        let edits = 0;
        DiscordMessages.sendStorageMonitorMessageNow = async () => { edits++; };

        await Promise.all([
            DiscordMessages.sendStorageMonitorMessage('g', 's', 'a'),
            DiscordMessages.sendStorageMonitorMessage('g', 's', 'b'),
            DiscordMessages.sendStorageMonitorMessage('g', 's', 'a', { id: 'interaction' }),
        ]);

        Assert.strictEqual(edits, 3);
    });
});

/* Switching a group edited every switch message and the group message once per switch: the edits piled up. */
for (const [name, send, now] of [
    ['switch', 'sendSmartSwitchMessage', 'sendSmartSwitchMessageNow'],
    ['switch group', 'sendSmartSwitchGroupMessage', 'sendSmartSwitchGroupMessageNow'],
]) {
    Test.describe(`DiscordMessages.${send} coalescing`, () => {
        const originalNow = DiscordMessages[now];
        const tick = () => new Promise((resolve) => setImmediate(resolve));

        Test.afterEach(() => { DiscordMessages[now] = originalNow; });

        Test.it(`runs one ${name} edit at a time and one more for the changes meanwhile`, async () => {
            const releases = [];
            let edits = 0;
            DiscordMessages[now] = () => {
                edits++;
                return new Promise((resolve) => releases.push(resolve));
            };

            const first = DiscordMessages[send]('g', 's', '1');
            const rest = [];
            for (let i = 0; i < 5; i++) rest.push(DiscordMessages[send]('g', 's', '1'));
            await Promise.all(rest);
            Assert.strictEqual(edits, 1, 'the burst waits for the running edit');

            releases[0]();
            await first;
            await tick();
            Assert.strictEqual(edits, 2, 'one follow-up with the newest state');

            releases[1]();
            await tick();
            await tick();
            Assert.strictEqual(edits, 2);
        });

        Test.it(`keeps different ${name} messages apart and answers an interaction directly`, async () => {
            let edits = 0;
            DiscordMessages[now] = async () => { edits++; };

            await Promise.all([
                DiscordMessages[send]('g', 's', 'a'),
                DiscordMessages[send]('g', 's', 'b'),
                DiscordMessages[send]('g', 's', 'a', { id: 'interaction' }),
            ]);

            Assert.strictEqual(edits, 3);
        });
    });
}

Test.describe('Instance message id helpers', () => {
    Test.it('clearInformationMessageIds drops only the information section ids', () => {
        const instance = fakeInstance();

        InstanceUtils.clearInformationMessageIds(instance);

        Assert.deepStrictEqual(Object.values(instance.informationMessageId), [null, null, null, null, null, null]);
        Assert.strictEqual(instance.serverList.serverId.messageId, '7');
        Assert.strictEqual(instance.trackers.trackerId.messageId, '12');
    });

    Test.it('clearEntityMessageIds drops the server, device and tracker ids', () => {
        const instance = fakeInstance();

        InstanceUtils.clearEntityMessageIds(instance);

        const server = instance.serverList.serverId;
        Assert.strictEqual(server.messageId, null);
        Assert.strictEqual(server.switches.entityId.messageId, null);
        Assert.strictEqual(server.alarms.entityId.messageId, null);
        Assert.strictEqual(server.storageMonitors.entityId.messageId, null);
        Assert.strictEqual(server.switchGroups.groupId.messageId, null);
        Assert.strictEqual(instance.trackers.trackerId.messageId, null);

        Assert.strictEqual(instance.informationMessageId.map, '1');
    });
});

Test.describe('RemoveGuildChannels', () => {
    Test.it('clears the ids of the messages that lived in the removed channels', async () => {
        const instance = fakeInstance();
        const client = {
            getInstance: () => instance,
            setInstance: () => undefined,
            log: () => undefined,
            intlGet: (guildId, key) => key,
        };

        await RemoveGuildChannels(client, { id: 'guildId' });

        Assert.deepStrictEqual(Object.values(instance.informationMessageId), [null, null, null, null, null, null]);
        Assert.strictEqual(instance.channelId.category, null);
        Assert.strictEqual(instance.channelId.information, null);
        Assert.strictEqual(instance.channelId.servers, null);
        Assert.strictEqual(instance.serverList.serverId.messageId, null);
        Assert.strictEqual(instance.trackers.trackerId.messageId, null);
    });
});
