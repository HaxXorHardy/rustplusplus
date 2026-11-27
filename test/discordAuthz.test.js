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

/*
    Authorization and acknowledgement of Discord interactions: buttons, select menus, modals, the commands channel,
    aliases and the team/clan chat relay. The Discord client is stubbed, nothing is sent.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Alias = require('../src/commands/alias.js');
const ButtonHandler = require('../src/handlers/buttonHandler.js');
const Client = require('../src/structures/clientRegistry.js');
const DiscordBot = require('../src/structures/DiscordBot.js');
const DiscordCommandHandler = require('../src/handlers/discordCommandHandler.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const DiscordTools = require('../src/discordTools/discordTools.js');
const InGameCommandHandler = require('../src/handlers/inGameCommandHandler.js');
const InteractionCreate = require('../src/discordEvents/interactionCreate.js');
const ModalHandler = require('../src/handlers/modalHandler.js');
const RustPlus = require('../src/structures/RustPlus.js');
const SelectMenuHandler = require('../src/handlers/selectMenuHandler.js');
const SmartSwitchGroupHandler = require('../src/handlers/smartSwitchGroupHandler.js');

const en = require('../src/languages/en.json');

/* Replaces a property of an object for one test and puts it back afterwards. */
function patch(t, object, key, value) {
    const original = object[key];
    object[key] = value;
    t.after(() => { object[key] = original; });
}

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

function fakeClient(instance, events, options = {}) {
    const client = {
        rustplusInstances: options.rustplus ? { guildId: options.rustplus } : {},
        getInstance: () => instance,
        setInstance: () => events.push('setInstance'),
        log: () => undefined,
        intlGet: (guildId, key) => key,
        logInteraction: () => undefined,
        isAllowedUser: () => options.allowed !== false,
        hasAdminPrivileges: () => options.admin !== false,
        resetRustplusVariables: () => undefined,
        createRustplusInstance: () => {
            events.push('createRustplusInstance');
            return {};
        },
        interactionUpdate: async () => events.push('interactionUpdate')
    };
    client.interactionDeferUpdate = DiscordBot.prototype.interactionDeferUpdate.bind(client);
    return client;
}

function fakeInstance(activeServer = null) {
    return {
        activeServer: activeServer,
        channelId: {
            servers: 'servers', switches: 'switches', switchGroups: 'switchGroups', alarms: 'alarms',
            storageMonitors: 'storageMonitors', teamchat: 'teamchat', clanchat: 'clanchat'
        },
        generalSettings: { smartSwitchNotifyInGameWhenChangedFromDiscord: false },
        serverList: {
            serverId: {
                serverIp: '127.0.0.1', appPort: 1, steamId: '1', playerToken: 1, messageId: 'serverMessage',
                switches: { 1: { active: false, reachable: false, name: 'Switch', messageId: 'switchMessage' } },
                switchGroups: { 7: { name: 'Group', switches: [], messageId: 'groupMessage' } },
                alarms: {},
                storageMonitors: { 5: { name: 'Box', reachable: true, messageId: 'boxMessage' } }
            }
        },
        trackers: {},
        teamChatColors: {},
        aliases: []
    };
}

Test.describe('buttons', () => {
    Test.it('DeleteUnreachableDevices does nothing for a member without admin privileges', async (t) => {
        const events = [];
        patch(t, DiscordTools, 'deleteMessageById', async () => events.push('deleteMessageById'));

        const instance = fakeInstance('serverId');
        const client = fakeClient(instance, events, { admin: false });
        await ButtonHandler(client, fakeInteraction('DeleteUnreachableDevices{"serverId":"serverId"}', events));

        Assert.deepStrictEqual(events, ['deferUpdate']);
        Assert.ok(instance.serverList.serverId.switches[1], 'the unreachable switch is still there');
    });

    Test.it('acknowledges the click of a blacklisted user without acting on it', async () => {
        const events = [];
        const instance = fakeInstance('serverId');
        const client = fakeClient(instance, events, { allowed: false });
        await ButtonHandler(client, fakeInteraction('DeleteUnreachableDevices{"serverId":"serverId"}', events));

        Assert.deepStrictEqual(events, ['deferUpdate']);
    });

    Test.it('ServerConnect disconnects the instance that is current after the awaits, not the captured one',
        async (t) => {
            const events = [];
            const stale = { disconnect: () => events.push('stale.disconnect') };
            const current = { disconnect: () => events.push('current.disconnect') };

            const instance = fakeInstance('serverId');
            const client = fakeClient(instance, events, { rustplus: stale });
            patch(t, DiscordMessages, 'sendServerMessage', async (guildId, serverId, state, interaction) => {
                /* A reconnect replaced the instance while the previous server message was rewritten. */
                if (!interaction) client.rustplusInstances.guildId = current;
            });

            await ButtonHandler(client, fakeInteraction('ServerConnect{"serverId":"serverId"}', events));

            Assert.ok(events.includes('current.disconnect'));
            Assert.ok(!events.includes('stale.disconnect'));
            Assert.strictEqual(current.isDeleted, true);
        });

    Test.it('ServerConnect ignores a second click while the first one still runs', async (t) => {
        const events = [];
        let release;
        const gate = new Promise((resolve) => { release = resolve; });

        const instance = fakeInstance('serverId');
        const client = fakeClient(instance, events);
        patch(t, DiscordMessages, 'sendServerMessage', async (guildId, serverId, state, interaction) => {
            if (!interaction) await gate;
        });

        const first = ButtonHandler(client, fakeInteraction('ServerConnect{"serverId":"serverId"}', events));
        await new Promise((resolve) => setImmediate(resolve));
        await ButtonHandler(client, fakeInteraction('ServerConnect{"serverId":"serverId"}', events));
        release();
        await first;

        Assert.strictEqual(events.filter(e => e === 'createRustplusInstance').length, 1);

        /* Afterwards a new click works again. */
        await ButtonHandler(client, fakeInteraction('ServerConnect{"serverId":"serverId"}', events));
        Assert.strictEqual(events.filter(e => e === 'createRustplusInstance').length, 2);
    });

    Test.it('GroupTurnOn of another server does not cancel the timer of the connected server', async (t) => {
        const events = [];
        patch(t, SmartSwitchGroupHandler, 'cancelGroupTimer', () => events.push('cancelGroupTimer'));
        patch(t, SmartSwitchGroupHandler, 'setGroup', async () => events.push('setGroup'));

        const instance = fakeInstance('serverId');
        const client = fakeClient(instance, events, { rustplus: { serverId: 'otherServer' } });
        await ButtonHandler(client, fakeInteraction('GroupTurnOn{"serverId":"serverId","groupId":"7"}', events));

        Assert.ok(!events.includes('cancelGroupTimer'));
        Assert.ok(!events.includes('setGroup'));

        client.rustplusInstances.guildId.serverId = 'serverId';
        await ButtonHandler(client, fakeInteraction('GroupTurnOn{"serverId":"serverId","groupId":"7"}', events));
        Assert.ok(events.includes('cancelGroupTimer'));
        Assert.ok(events.includes('setGroup'));
    });

    Test.it('StorageMonitorRecycle schedules no delete when the recycle message could not be posted', async (t) => {
        const events = [];
        const timers = [];
        patch(t, DiscordMessages, 'sendStorageMonitorRecycleMessage', async () => undefined);
        patch(t, global, 'setTimeout', (fn, ms) => { timers.push(ms); return 0; });

        const rustplus = {
            serverId: 'serverId',
            getEntityInfoAsync: async () => ({ entityInfo: { payload: { items: [] } } }),
            isResponseValid: async () => true
        };
        const instance = fakeInstance('serverId');
        const client = fakeClient(instance, events, { rustplus: rustplus });
        client.rustlabs = { getRecycleDataFromArray: () => [] };

        await ButtonHandler(client, fakeInteraction('StorageMonitorRecycle|serverId|5', events));

        Assert.deepStrictEqual(timers, []);
    });
});

Test.describe('select menus and modals of blacklisted users', () => {
    Test.it('a select menu is acknowledged', async () => {
        const events = [];
        const client = fakeClient(fakeInstance(), events, { allowed: false });
        await SelectMenuHandler(client, fakeInteraction('language', events));
        Assert.deepStrictEqual(events, ['deferUpdate']);
    });

    Test.it('a modal is acknowledged', async () => {
        const events = [];
        const client = fakeClient(fakeInstance(), events, { allowed: false });
        await ModalHandler(client, fakeInteraction('ServerEdit{"serverId":"serverId"}', events));
        Assert.deepStrictEqual(events, ['deferUpdate']);
    });
});

Test.describe('modals', () => {
    function modal(customId, events, fields) {
        const interaction = fakeInteraction(customId, events);
        interaction.fields = { getTextInputValue: (id) => fields[id] };
        return interaction;
    }

    Test.it('ServerEdit of a removed server is acknowledged instead of throwing', async () => {
        const events = [];
        const instance = fakeInstance();
        const client = fakeClient(instance, events);
        await ModalHandler(client, modal('ServerEdit{"serverId":"gone"}', events, { ServerBattlemetricsId: '1' }));
        Assert.deepStrictEqual(events, ['deferUpdate']);
    });

    Test.it('custom timers accept positive whole seconds up to a week only', () => {
        Assert.strictEqual(ModalHandler.parseTimerSeconds('600'), 600);
        Assert.strictEqual(ModalHandler.parseTimerSeconds(' 900 '), 900);
        Assert.strictEqual(ModalHandler.parseTimerSeconds(`${7 * 24 * 60 * 60}`), 7 * 24 * 60 * 60);
        for (const value of ['0', '-5', '1e12', '12abc', '1.5', '', `${7 * 24 * 60 * 60 + 1}`, '999999999999']) {
            Assert.strictEqual(ModalHandler.parseTimerSeconds(value), null, value);
        }
    });

    Test.it('CustomTimersEdit keeps the current value for a negative or huge input', async () => {
        const events = [];
        const instance = fakeInstance();
        const server = instance.serverList.serverId;
        Object.assign(server, {
            cargoShipEgressTimeMs: 1000, oilRigLockedCrateUnlockTimeMs: 2000, deepSeaMinWipeCooldownMs: 3000,
            deepSeaMaxWipeCooldownMs: 4000, deepSeaWipeDurationMs: 5000
        });
        const client = fakeClient(instance, events);
        await ModalHandler(client, modal('CustomTimersEdit{"serverId":"serverId"}', events, {
            CargoShipEgressTime: '-10', OilRigCrateUnlockTime: '1000000000000', DeepSeaMinWipeCooldownTime: '60',
            DeepSeaMaxWipeCooldownTime: 'abc', DeepSeaWipeDurationTime: '0'
        }));

        Assert.strictEqual(server.cargoShipEgressTimeMs, 1000);
        Assert.strictEqual(server.oilRigLockedCrateUnlockTimeMs, 2000);
        Assert.strictEqual(server.deepSeaMinWipeCooldownMs, 60000);
        Assert.strictEqual(server.deepSeaMaxWipeCooldownMs, 4000);
        Assert.strictEqual(server.deepSeaWipeDurationMs, 5000);
        Assert.ok(events.includes('deferUpdate'));
    });
});

Test.describe('interactionCreate', () => {
    Test.it('a throwing handler is logged and the interaction acknowledged', async () => {
        const logs = [];
        const events = [];
        const client = { log: (...args) => logs.push(args), intlGet: (guildId, key) => key };
        const interaction = fakeInteraction('X', events);

        await Assert.doesNotReject(InteractionCreate.runComponentHandler(client, interaction, async () => {
            throw new Error('boom');
        }));
        Assert.deepStrictEqual(events, ['deferUpdate']);
        Assert.strictEqual(logs.length, 1);
    });

    Test.it('an interaction the handler already answered is not acknowledged twice', async () => {
        const events = [];
        const client = { log: () => undefined, intlGet: (guildId, key) => key };
        const interaction = fakeInteraction('X', events);

        await InteractionCreate.runComponentHandler(client, interaction, async (c, i) => {
            await i.deferUpdate();
            throw new Error('boom');
        });
        Assert.deepStrictEqual(events, ['deferUpdate']);
    });
});

Test.describe('team and clan chat relay', () => {
    for (const [name, channel] of [['sendTeamChatMessage', 'teamchat'], ['sendClanChatMessage', 'clanchat']]) {
        Test.it(`${name} does not turn an in-game @everyone into a ping`, async (t) => {
            const sent = [];
            const instance = fakeInstance();
            patch(t, Client, 'client', { getInstance: () => instance });
            patch(t, DiscordMessages, 'sendMessage', async (guildId, content, messageId, channelId) => {
                sent.push({ content, channelId });
            });

            await DiscordMessages[name]('guildId', { steamId: '1', name: 'Bob', message: 'raid @everyone @here' });

            Assert.strictEqual(sent.length, 1);
            Assert.strictEqual(sent[0].channelId, channel);
            Assert.strictEqual(sent[0].content.content, undefined);
            Assert.deepStrictEqual(sent[0].content.allowedMentions, { parse: [] });
        });
    }
});

Test.describe('aliases', () => {
    const aliases = [
        { index: 0, alias: 'gg', value: '!door off' },
        { index: 1, alias: 'p', value: '!pop $&' },
        { index: 2, alias: 'two words', value: '!time' }
    ];

    Test.it('replaces only a whole leading match', () => {
        Assert.strictEqual(Alias.applyAliases(aliases, 'gg'), '!door off');
        Assert.strictEqual(Alias.applyAliases(aliases, 'gg now'), '!door off now');
        Assert.strictEqual(Alias.applyAliases(aliases, 'ggwp'), 'ggwp');
        Assert.strictEqual(Alias.applyAliases(aliases, 'that was gg'), 'that was gg');
        Assert.strictEqual(Alias.applyAliases(aliases, 'two words'), '!time');
    });

    Test.it('inserts the value literally, no $& patterns', () => {
        Assert.strictEqual(Alias.applyAliases(aliases, 'p'), '!pop $&');
    });

    Test.it('in-game chat containing an alias somewhere is no command', async () => {
        const sent = [];
        const client = {
            intlGet: (guildId, key) => en[key] || key,
            getInstance: () => ({
                aliases: [{ index: 0, alias: 'gg', value: '.pop' }],
                serverList: { serverId: { alarms: {}, switches: {}, switchGroups: {} } }
            }),
        };
        const rustplus = {
            guildId: 'guild',
            serverId: 'serverId',
            isOperational: true,
            generalSettings: { prefix: '.', inGameCommandsEnabled: true },
            log: () => undefined,
            logInGameCommand: () => undefined,
            sendInGameMessage: (text) => sent.push(text),
            getCommandPop: () => 'POP',
        };
        const run = (message) => InGameCommandHandler.inGameCommandHandler(rustplus, client,
            { message: message, steamId: 1, name: 'Hardy' });

        Assert.strictEqual(await run('nice gg'), false);
        Assert.strictEqual(await run('gg'), true);
        Assert.deepStrictEqual(sent, ['POP']);
    });

    Test.it('/alias add and remove need admin privileges, show does not', async () => {
        for (const subcommand of ['add', 'remove', 'show']) {
            const instance = { aliases: [] };
            const calls = [];
            const client = {
                logInteraction: () => undefined,
                validatePermissions: async () => true,
                requireAdminPrivileges: async () => { calls.push('requireAdminPrivileges'); return false; },
                getInstance: () => instance,
                setInstance: () => calls.push('setInstance'),
                intlGet: (guildId, key) => key,
                log: () => undefined,
                interactionEditReply: async () => calls.push('editReply')
            };
            const interaction = {
                guildId: 'guildId',
                deferReply: async () => undefined,
                options: {
                    getSubcommand: () => subcommand,
                    getString: (name) => name === 'alias' ? 'gg' : '!door off',
                    getInteger: () => 0
                }
            };

            await Alias.execute(client, interaction);

            if (subcommand === 'show') {
                Assert.ok(!calls.includes('requireAdminPrivileges'), subcommand);
            }
            else {
                Assert.deepStrictEqual(calls, ['requireAdminPrivileges'], subcommand);
                Assert.deepStrictEqual(instance.aliases, [], subcommand);
            }
        }
    });
});

Test.describe('!leader <name>', () => {
    function leaderContext(players, leaderSteamId = '1') {
        const changed = [];
        const instance = { serverListLite: { serverId: { 1: {}, 2: {}, 3: {}, 4: {} } } };
        const context = {
            guildId: 'guildId',
            serverId: 'serverId',
            playerId: '1',
            generalSettings: { prefix: '!', leaderCommandEnabled: true, leaderCommandOnlyForPaired: false },
            team: {
                leaderSteamId: leaderSteamId,
                players: players,
                changeLeadership: async (steamId) => changed.push(steamId),
                getPlayer: (steamId) => players.find(e => e.steamId === steamId)
            }
        };
        return { context, changed, instance };
    }

    const players = [
        { steamId: '1', name: 'Hardy' },
        { steamId: '2', name: 'Alice' },
        { steamId: '3', name: 'Bob' },
        { steamId: '4', name: 'bob' }
    ];

    function withClient(t, instance) {
        patch(t, Client, 'client', {
            getInstance: () => instance,
            intlGet: (guildId, key, args) => args ? `${key} ${args.name}` : (en[key] || key)
        });
    }

    Test.it('a part of a name does not match', async (t) => {
        const { context, changed, instance } = leaderContext(players);
        withClient(t, instance);
        const result = await RustPlus.prototype.getCommandLeader.call(context, '!leader a', null);
        Assert.deepStrictEqual(changed, []);
        Assert.strictEqual(result, 'couldNotIdentifyMember a');
    });

    Test.it('the whole name matches regardless of case', async (t) => {
        const { context, changed, instance } = leaderContext(players);
        withClient(t, instance);
        const result = await RustPlus.prototype.getCommandLeader.call(context, '!leader ALICE', null);
        Assert.deepStrictEqual(changed, ['2']);
        Assert.strictEqual(result, 'leaderTransferred Alice');
    });

    Test.it('a name two teammates share is refused', async (t) => {
        const { context, changed, instance } = leaderContext(players);
        withClient(t, instance);
        const result = await RustPlus.prototype.getCommandLeader.call(context, '!leader bob', null);
        Assert.deepStrictEqual(changed, []);
        Assert.strictEqual(result, 'couldNotIdentifyMember bob');
    });

    Test.it('from the Discord commands channel the name form needs admin privileges', async (t) => {
        const responses = [];
        const leaderCalls = [];
        patch(t, DiscordMessages, 'sendDiscordCommandResponseMessage', async (rustplus, client, message, response) => {
            responses.push(response);
        });
        patch(t, DiscordTools, 'getGuild', () => ({ id: 'guildId', name: 'Guild' }));
        patch(t, DiscordTools, 'getTextChannelById', () => ({ id: 'commands', name: 'commands' }));

        let admin = false;
        const client = {
            intlGet: (guildId, key) => en[key] || key,
            getInstance: () => ({ aliases: [] }),
            hasAdminPrivileges: () => admin,
            log: () => undefined
        };
        const rustplus = {
            guildId: 'guildId',
            generalSettings: { prefix: '!' },
            getCommandLeader: async (command, caller) => { leaderCalls.push([command, caller]); return 'DONE'; }
        };
        const message = (text) => ({
            cleanContent: text,
            author: { username: 'user', id: 'userId' },
            member: { permissions: { has: () => admin } },
            guild: { id: 'guildId' },
            channelId: 'commands'
        });

        await DiscordCommandHandler.discordCommandHandler(rustplus, client, message('!leader Alice'));
        Assert.deepStrictEqual(leaderCalls, []);
        Assert.deepStrictEqual(responses, [en.missingPermission]);

        /* The plain form needs a caller and does nothing from Discord; it is passed on as before. */
        await DiscordCommandHandler.discordCommandHandler(rustplus, client, message('!leader'));
        Assert.deepStrictEqual(leaderCalls, [['!leader', null]]);

        admin = true;
        await DiscordCommandHandler.discordCommandHandler(rustplus, client, message('!leader Alice'));
        Assert.deepStrictEqual(leaderCalls, [['!leader', null], ['!leader Alice', null]]);
    });
});

Test.describe('/credentials', () => {
    const Credentials = require('../src/commands/credentials.js');
    const CredentialRevocation = require('../src/util/credentialRevocation.js');
    const InstanceUtils = require('../src/util/instanceUtils.js');

    function run(t, subcommand, steamId, credentials, admin = true) {
        const calls = [];
        patch(t, InstanceUtils, 'readCredentialsFile', () => credentials);
        patch(t, InstanceUtils, 'writeCredentialsFile', (guildId, value) => calls.push(['write', value]));
        patch(t, CredentialRevocation, 'revokeIfUnregistered', (id) => calls.push(['revoke', id]));

        const client = {
            logInteraction: () => undefined,
            validatePermissions: async () => true,
            requireAdminPrivileges: async () => { calls.push(['requireAdminPrivileges']); return admin; },
            getInstance: () => ({}),
            rustplusInstances: {},
            intlGet: (guildId, key) => key,
            log: () => undefined,
            interactionEditReply: async (interaction, content) => calls.push(['editReply'])
        };
        const interaction = {
            guildId: 'guildId',
            member: { user: { id: 'userId' } },
            deferReply: async () => undefined,
            options: { getSubcommand: () => subcommand, getString: () => steamId }
        };
        return { calls, done: Credentials.execute(client, interaction) };
    }

    Test.it('remove refuses the hoster key as a steam id', async (t) => {
        const credentials = { hoster: null, '76561198000000001': { discord_user_id: 'userId' } };
        const { calls, done } = run(t, 'remove', 'hoster', credentials);
        await done;
        Assert.ok(!calls.some(e => e[0] === 'write'));
        Assert.ok(Object.prototype.hasOwnProperty.call(credentials, 'hoster'));
    });

    Test.it('remove of an inherited key such as toString is refused', async (t) => {
        const credentials = { hoster: null };
        const { calls, done } = run(t, 'remove', 'toString', credentials);
        await done;
        Assert.ok(!calls.some(e => e[0] === 'write'));
    });

    Test.it('remove of a null entry needs an admin and does not throw', async (t) => {
        const credentials = { hoster: null, '76561198000000002': null };
        const { calls, done } = run(t, 'remove', '76561198000000002', credentials, false);
        await Assert.doesNotReject(done);
        Assert.deepStrictEqual(calls, [['requireAdminPrivileges']]);

        const second = run(t, 'remove', '76561198000000002', credentials, true);
        await second.done;
        Assert.ok(!Object.prototype.hasOwnProperty.call(credentials, '76561198000000002'));
    });

    Test.it('remove without a steam id skips null entries and finds the own one', async (t) => {
        const credentials = { hoster: null, '76561198000000002': null, '76561198000000003': { discord_user_id: 'userId' } };
        const { calls, done } = run(t, 'remove', null, credentials);
        await done;
        Assert.ok(calls.some(e => e[0] === 'revoke' && e[1] === '76561198000000003'));
    });

    Test.it('set_hoster refuses the hoster key and toString', async (t) => {
        for (const steamId of ['hoster', 'toString']) {
            const credentials = { hoster: '76561198000000003', '76561198000000003': { discord_user_id: 'userId' } };
            const { calls, done } = run(t, 'set_hoster', steamId, credentials);
            await done;
            Assert.strictEqual(credentials.hoster, '76561198000000003', steamId);
            Assert.ok(!calls.some(e => e[0] === 'write'), steamId);
        }
    });

    Test.it('the subcommand is awaited, so a throw reaches the caller', async (t) => {
        const { done } = run(t, 'remove', '76561198000000001', null);
        await Assert.rejects(done);
    });
});