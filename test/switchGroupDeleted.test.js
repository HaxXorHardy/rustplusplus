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

const DiscordMessages = require('../src/discordTools/discordMessages.js');
const SmartSwitchGroupHandler = require('../src/handlers/smartSwitchGroupHandler.js');
const SmartSwitchHandler = require('../src/handlers/smartSwitchHandler.js');
const SwitchTimeouts = require('../src/util/switchTimeouts.js');

function switchSetup(t, answer = 'ok', active = false) {
    const words = { commandSyntaxOn: 'on', commandSyntaxOff: 'off', commandSyntaxStatus: 'status' };
    const instance = {
        serverList: { server: {
            switches: { 5: { name: 'Lamp', command: 'lamp', active: active, reachable: true } },
            switchGroups: { 1: { name: 'Lights', command: 'lights', switches: ['5', '6'] } },
        } },
    };
    const rustplus = {
        guildId: 'guild',
        serverId: 'server',
        generalSettings: { prefix: '!' },
        interactionSwitches: [],
        requests: [],
        inGame: [],
        sendInGameMessage: (text) => { rustplus.inGame.push(text); },
        log: () => undefined,
        isResponseValid: async (response) => response === 'ok',
        turnSmartSwitchAsync: async (entityId, value) => { rustplus.requests.push(value); return answer; },
    };
    const client = {
        rustplusInstances: { guild: rustplus },
        getInstance: () => instance,
        setInstance: () => undefined,
        intlGet: (guildId, key) => words[key] || key,
        log: () => undefined,
    };

    t.mock.method(DiscordMessages, 'sendSmartSwitchMessage', async () => undefined);
    t.mock.method(SmartSwitchGroupHandler, 'updateSwitchGroupIfContainSwitch', () => undefined);
    t.after(() => SwitchTimeouts.reset());

    return { instance, rustplus, client };
}

Test.describe('switch group status after a switch was deleted', () => {
    Test.it('the group status leaves out a switch that was deleted', async (t) => {
        const { rustplus, client } = switchSetup(t);

        await SmartSwitchGroupHandler.smartSwitchGroupCommandHandler(rustplus, client, '!lights status');
        Assert.strictEqual(rustplus.inGame.length, 1);
        Assert.match(rustplus.inGame[0], /Lamp: offCap$/);
    });
});
