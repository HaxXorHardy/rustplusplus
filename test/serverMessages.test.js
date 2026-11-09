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
const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const DiscordTools = require('../src/discordTools/discordTools.js');
const RemoveServerDevices = require('../src/discordTools/RemoveServerDevices.js');
const SetupServerList = require('../src/discordTools/SetupServerList.js');

/* These tests stub the Discord helpers, nothing is sent and nothing is deleted on Discord. */
function fakeClient(instance) {
    const client = {
        saved: 0,
        logs: [],
        getInstance: () => instance,
        setInstance: () => { client.saved += 1; },
        intlGet: (guildId, key) => key,
        log: (title, text) => client.logs.push(text),
    };

    return client;
}

/*
    A server that is adopted while the bot runs has no message in the servers channel, so it is not listed in Discord
    and cannot be connected (the button lives on that message).
*/
Test.describe('SetupServerList.postMissingServerMessages', () => {
    const originalSendServerMessage = DiscordMessages.sendServerMessage;

    Test.afterEach(() => {
        DiscordMessages.sendServerMessage = originalSendServerMessage;
    });

    function fakeInstance() {
        return {
            serverList: {
                'relay-a': { title: 'A', guid: 'a', messageId: '111', switches: {}, alarms: {}, storageMonitors: {} },
                'relay-b': { title: 'B', guid: 'b', messageId: null, switches: {}, alarms: {}, storageMonitors: {} },
                '1.2.3.4-28082': { title: 'C', serverIp: '1.2.3.4', appPort: '28082', switches: {}, alarms: {} },
                'no-address': { title: 'D', messageId: null, switches: {}, alarms: {} },
            },
        };
    }

    Test.it('posts the servers that have no message yet', async () => {
        const posted = [];
        DiscordMessages.sendServerMessage = async (guildId, serverId) => posted.push(serverId);

        const result = await SetupServerList.postMissingServerMessages(fakeClient(fakeInstance()), 'guildId');

        Assert.deepStrictEqual(posted, ['relay-b', '1.2.3.4-28082']);
        Assert.deepStrictEqual(result, ['relay-b', '1.2.3.4-28082']);
    });

    Test.it('keeps going when a message cannot be posted', async () => {
        DiscordMessages.sendServerMessage = async (guildId, serverId) => {
            if (serverId === 'relay-b') throw new Error('missing access');
        };

        const client = fakeClient(fakeInstance());
        const result = await SetupServerList.postMissingServerMessages(client, 'guildId');

        Assert.deepStrictEqual(result, ['1.2.3.4-28082']);
        Assert.ok(client.logs.some((text) => text.includes('missing access')));
    });

    Test.it('needs an address or a pairing id to be listed', () => {
        Assert.strictEqual(SetupServerList.needsServerMessage(null), false);
        Assert.strictEqual(SetupServerList.needsServerMessage({ messageId: '1', guid: 'a' }), false);
        Assert.strictEqual(SetupServerList.needsServerMessage({ messageId: null }), false);
        Assert.strictEqual(SetupServerList.needsServerMessage({ messageId: null, guid: 'a' }), true);
        Assert.strictEqual(
            SetupServerList.needsServerMessage({ messageId: null, serverIp: 'relay', appPort: 'a' }), true);
    });
});

/* Only the devices of the connected server are listed, the messages of the previous server have to go. */
Test.describe('RemoveServerDevices', () => {
    const originalDeleteMessageById = DiscordTools.deleteMessageById;

    Test.afterEach(() => {
        DiscordTools.deleteMessageById = originalDeleteMessageById;
    });

    function fakeInstance() {
        return {
            channelId: {
                switches: 'switches-channel',
                switchGroups: 'switch-groups-channel',
                alarms: 'alarms-channel',
                storageMonitors: 'storage-monitors-channel',
            },
            serverList: {
                'relay-a': {
                    title: 'A',
                    messageId: 'server-message',
                    switches: { '1': { messageId: 'switch-message' }, '2': { messageId: null } },
                    switchGroups: { '3': { messageId: 'group-message' } },
                    alarms: { '4': { messageId: 'alarm-message' } },
                    storageMonitors: { '5': { messageId: 'storage-message' } },
                },
            },
        };
    }

    Test.it('deletes the device messages and clears their ids', async () => {
        const deleted = [];
        DiscordTools.deleteMessageById = async (guildId, channelId, messageId) => {
            deleted.push(`${channelId}:${messageId}`);
            return true;
        };

        const instance = fakeInstance();
        const client = fakeClient(instance);

        const removed = await RemoveServerDevices(client, 'guildId', 'relay-a');

        Assert.strictEqual(removed, 4);
        Assert.deepStrictEqual(deleted, [
            'switches-channel:switch-message',
            'switch-groups-channel:group-message',
            'alarms-channel:alarm-message',
            'storage-monitors-channel:storage-message',
        ]);

        /* The message of the server itself stays, the devices are posted again by the next connection. */
        Assert.strictEqual(instance.serverList['relay-a'].messageId, 'server-message');
        Assert.strictEqual(instance.serverList['relay-a'].switches['1'].messageId, null);
        Assert.strictEqual(instance.serverList['relay-a'].alarms['4'].messageId, null);
        Assert.strictEqual(client.saved, 1);
    });

    Test.it('does nothing for a server that is not in the instance', async () => {
        DiscordTools.deleteMessageById = async () => {
            throw new Error('nothing should be deleted');
        };

        const client = fakeClient(fakeInstance());

        Assert.strictEqual(await RemoveServerDevices(client, 'guildId', 'relay-unknown'), 0);
        Assert.strictEqual(client.saved, 0);
    });
});


/*
    Items, capacity and expiry of a storage monitor are only known for the connected server. The monitor of another
    server of the guild has to render the not connected state, a missing data set used to throw instead.
*/
Test.describe('DiscordEmbeds.getStorageMonitorEmbed', () => {
    Test.afterEach(() => {
        Client.client = null;
    });

    function stubClient(rustplus) {
        const instance = {
            serverList: {
                'relay-a': {
                    title: 'A',
                    storageMonitors: {
                        '4242': {
                            name: 'TC',
                            image: 'storage_monitor.png',
                            server: 'A',
                            location: null,
                            type: 'toolCupboard',
                            upkeep: null,
                        },
                    },
                },
            },
        };

        Client.client = {
            items: { getName: (id) => `${id}` },
            rustplusInstances: { guildId: rustplus },
            getInstance: () => instance,
            setInstance: () => undefined,
            intlGet: (guildId, key) => key,
        };

        return instance;
    }

    Test.it('shows a monitor of another server as not connected', () => {
        stubClient({ serverId: 'relay-b', storageMonitors: {} });

        const embed = DiscordEmbeds.getStorageMonitorEmbed('guildId', 'relay-a', '4242');

        Assert.ok(embed.data.description.includes('statusNotConnectedToServer'));
    });

    Test.it('shows the slots of a connected monitor', () => {
        stubClient({
            serverId: 'relay-a',
            storageMonitors: { '4242': { capacity: 24, expiry: 0, items: [{ itemId: 'wood', quantity: 5 }] } },
        });

        const embed = DiscordEmbeds.getStorageMonitorEmbed('guildId', 'relay-a', '4242');

        Assert.ok(embed.data.description.includes('(1/24)'));
    });
});

