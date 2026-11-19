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

const ButtonHandler = require('../src/handlers/buttonHandler.js');
const DiscordBot = require('../src/structures/DiscordBot.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const DiscordTools = require('../src/discordTools/discordTools.js');

/*
    Discord allows 3 s for the first answer to a click (issue #9: 10062 Unknown interaction after the Connect button).
    Buttons whose work waits on other Discord or Rust+ calls have to acknowledge the click before that work.
    These tests stub the Discord client and record the order of the calls, nothing is sent.
*/

function fakeInteraction(customId, events) {
    return {
        customId: customId,
        guildId: 'guildId',
        user: { username: 'user', id: 'userId' },
        deferred: false,
        replied: false,
        message: { delete: async () => events.push('message.delete') },
        deferUpdate: async function () {
            events.push('deferUpdate');
            this.deferred = true;
        }
    };
}

function fakeClient(instance, events, rustplus = undefined) {
    const client = {
        rustplusInstances: rustplus ? { guildId: rustplus } : {},
        getInstance: () => instance,
        setInstance: () => undefined,
        log: () => undefined,
        intlGet: (guildId, key) => key,
        logInteraction: () => undefined,
        isAllowedUser: () => true,
        hasAdminPrivileges: () => true,
        resetRustplusVariables: () => undefined,
        createRustplusInstance: () => {
            events.push('createRustplusInstance');
            return {};
        },
        interactionUpdate: async (interaction) => {
            events.push(interaction.deferred ? 'interactionUpdate (deferred)' : 'interactionUpdate');
        }
    };
    client.interactionDeferUpdate = DiscordBot.prototype.interactionDeferUpdate.bind(client);
    return client;
}

function fakeInstance(activeServer) {
    return {
        activeServer: activeServer,
        channelId: { servers: 'servers', switches: 'switches', switchGroups: 'switchGroups', alarms: 'alarms' },
        generalSettings: { smartSwitchNotifyInGameWhenChangedFromDiscord: false },
        serverList: {
            serverId: {
                serverIp: '127.0.0.1', appPort: 1, steamId: '1', playerToken: 1, messageId: 'serverMessage',
                switches: { 1: { active: false, reachable: true, name: 'Switch', messageId: 'switchMessage' } },
                switchGroups: {},
                alarms: {},
                storageMonitors: {}
            }
        },
        trackers: {}
    };
}

/* Replaces a property of a module for one test and puts it back afterwards. */
function patch(t, object, key, value) {
    const original = object[key];
    object[key] = value;
    t.after(() => { object[key] = original; });
}

Test.test('ServerConnect acknowledges the click before rewriting the previous server message', async (t) => {
    const events = [];
    patch(t, DiscordMessages, 'sendServerMessage', async (guildId, serverId, state, interaction) => {
        events.push(interaction ? 'sendServerMessage (interaction)' : 'sendServerMessage');
        if (interaction) await interaction.client.interactionUpdate(interaction);
    });

    const instance = fakeInstance('serverId');
    const client = fakeClient(instance, events);
    const interaction = fakeInteraction('ServerConnect{"serverId":"serverId"}', events);
    interaction.client = client;

    await ButtonHandler(client, interaction);

    Assert.deepStrictEqual(events, [
        'deferUpdate',
        'sendServerMessage',
        'createRustplusInstance',
        'sendServerMessage (interaction)',
        'interactionUpdate (deferred)'
    ]);
});

Test.test('ServerDisconnect acknowledges the click before removing the devices', async (t) => {
    const events = [];
    patch(t, DiscordMessages, 'sendServerMessage', async (guildId, serverId, state, interaction) => {
        events.push(interaction ? 'sendServerMessage (interaction)' : 'sendServerMessage');
    });
    patch(t, DiscordTools, 'deleteMessageById', async () => events.push('deleteMessageById'));

    const instance = fakeInstance('serverId');
    const client = fakeClient(instance, events);

    await ButtonHandler(client, fakeInteraction('ServerDisconnect{"serverId":"serverId"}', events));

    Assert.strictEqual(events[0], 'deferUpdate');
    Assert.strictEqual(events.at(-1), 'sendServerMessage (interaction)');
    Assert.ok(events.includes('deleteMessageById'), 'the switch message is removed');
});

Test.test('ServerDelete answers the click, it used to stay unanswered', async (t) => {
    const events = [];
    patch(t, DiscordTools, 'deleteMessageById', async () => events.push('deleteMessageById'));

    const instance = fakeInstance(null);
    const client = fakeClient(instance, events);

    await ButtonHandler(client, fakeInteraction('ServerDelete{"serverId":"serverId"}', events));

    Assert.deepStrictEqual(events, ['deferUpdate', 'deleteMessageById']);
    Assert.strictEqual(instance.serverList.serverId, undefined);
});

Test.test('SmartSwitchOn acknowledges the click before the Rust+ request', async (t) => {
    const events = [];
    patch(t, DiscordMessages, 'sendSmartSwitchMessage', async (guildId, serverId, entityId, interaction) => {
        events.push(interaction && interaction.deferred ? 'sendSmartSwitchMessage (deferred)' : 'sendSmartSwitchMessage');
    });

    const instance = fakeInstance('serverId');
    const rustplus = {
        serverId: 'serverId',
        interactionSwitches: [],
        turnSmartSwitchAsync: async () => {
            events.push('turnSmartSwitchAsync');
            return {};
        },
        isResponseValid: async () => true
    };
    const client = fakeClient(instance, events, rustplus);

    await ButtonHandler(client, fakeInteraction('SmartSwitchOn{"serverId":"serverId","entityId":"1"}', events));

    Assert.deepStrictEqual(events, ['deferUpdate', 'turnSmartSwitchAsync', 'sendSmartSwitchMessage (deferred)']);
    Assert.strictEqual(instance.serverList.serverId.switches[1].active, true);
});

Test.test('interactionDeferUpdate does not acknowledge twice and logs a failed acknowledgement', async () => {
    const logs = [];
    const client = { log: (...args) => logs.push(args), intlGet: (guildId, key) => key };
    const defer = DiscordBot.prototype.interactionDeferUpdate.bind(client);

    let calls = 0;
    await defer({ deferred: true, replied: false, deferUpdate: async () => { calls++; } });
    await defer({ deferred: false, replied: true, deferUpdate: async () => { calls++; } });
    Assert.strictEqual(calls, 0);

    await defer({
        deferred: false, replied: false,
        deferUpdate: async () => { throw new Error('Unknown interaction'); }
    });
    Assert.strictEqual(logs.length, 1);
    Assert.match(logs[0][1], /couldNotDeferInteraction Error: Unknown interaction/);
    Assert.strictEqual(logs[0][2], 'error');
});
