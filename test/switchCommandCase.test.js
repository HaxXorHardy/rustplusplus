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

Test.describe('in-game switch commands without regard to case', () => {
    Test.it('"!lamp OFF" on a lamp that is off does not turn it on', async (t) => {
        const { instance, rustplus, client } = switchSetup(t, 'ok', false);

        Assert.strictEqual(await SmartSwitchHandler.smartSwitchCommandHandler(rustplus, client, '!LAMP OFF'), true);
        Assert.deepStrictEqual(rustplus.requests, []);
        Assert.strictEqual(instance.serverList.server.switches[5].active, false);
        Assert.deepStrictEqual(rustplus.inGame, ['deviceIsAlreadyOnOff']);
    });

    Test.it('"!LIGHTS status" is the group status, matched without regard to case', async (t) => {
        const { rustplus, client } = switchSetup(t);
        /* The group lists only existing switches here, so the status works without the clean-up fix. */
        client.getInstance().serverList.server.switchGroups[1].switches = ['5'];

        await SmartSwitchGroupHandler.smartSwitchGroupCommandHandler(rustplus, client, '!LIGHTS STATUS');
        Assert.strictEqual(rustplus.inGame.length, 1);
        Assert.match(rustplus.inGame[0], /Lamp: offCap$/);
    });
});
