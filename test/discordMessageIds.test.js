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

Test.describe('RemoveGuildChannels', () => {
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

        const server = instance.serverList.serverId;
        Assert.strictEqual(server.messageId, null);
        Assert.strictEqual(server.switches.entityId.messageId, null);
        Assert.strictEqual(server.alarms.entityId.messageId, null);
        Assert.strictEqual(server.storageMonitors.entityId.messageId, null);
        Assert.strictEqual(server.switchGroups.groupId.messageId, null);

        Assert.strictEqual(instance.trackers.trackerId.messageId, null);
    });
});
