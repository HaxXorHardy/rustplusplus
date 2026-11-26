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
    The team message followed only the information cycle (once in six minutes): a member who came online or died
    kept the old status that long. It is refreshed after every poll now, like the original bot did.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const InformationHandler = require('../src/handlers/informationHandler.js');
const PollingHandler = require('../src/handlers/pollingHandler.js');

function setup(t, teamMessageId = 'msg') {
    const previous = Client.client;
    Client.client = {
        getInstance: () => ({ informationMessageId: { team: teamMessageId } }),
        intlGet: (guildId, key) => key
    };

    const original = DiscordMessages.sendUpdateTeamInformationMessage;
    const sent = [];
    DiscordMessages.sendUpdateTeamInformationMessage = async (rustplus) => { sent.push(rustplus); };

    t.after(() => {
        Client.client = previous;
        DiscordMessages.sendUpdateTeamInformationMessage = original;
    });

    const rustplus = { guildId: 'guild', team: { players: [] }, log: () => undefined };
    return { rustplus, sent };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

Test.describe('team message refresh', () => {
    Test.it('refreshes the team message on every call', async (t) => {
        const { rustplus, sent } = setup(t);

        InformationHandler.refreshTeam(rustplus);
        await settle();
        InformationHandler.refreshTeam(rustplus);
        await settle();

        Assert.strictEqual(sent.length, 2);
    });

    Test.it('leaves creating the message to the information cycle', async (t) => {
        const { rustplus, sent } = setup(t, null);

        InformationHandler.refreshTeam(rustplus);
        await settle();

        Assert.strictEqual(sent.length, 0);
    });

    Test.it('does not start a second refresh while one is running', async (t) => {
        const { rustplus } = setup(t);
        let release;
        let calls = 0;
        DiscordMessages.sendUpdateTeamInformationMessage = () => {
            calls += 1;
            return new Promise((resolve) => { release = resolve; });
        };

        InformationHandler.refreshTeam(rustplus);
        InformationHandler.refreshTeam(rustplus);
        Assert.strictEqual(calls, 1);

        release();
        await settle();
        InformationHandler.refreshTeam(rustplus);
        Assert.strictEqual(calls, 2);
    });

    Test.it('a refresh that fails is logged and the next one runs again', async (t) => {
        const { rustplus } = setup(t);
        const logs = [];
        rustplus.log = (cap, text) => logs.push(text);
        let calls = 0;
        DiscordMessages.sendUpdateTeamInformationMessage = async () => {
            calls += 1;
            throw new Error('rate limited');
        };

        InformationHandler.refreshTeam(rustplus);
        await settle();
        InformationHandler.refreshTeam(rustplus);
        await settle();

        Assert.strictEqual(calls, 2);
        Assert.ok(logs.some((text) => text.includes('rate limited')));
    });

    Test.it('the poll handlers ask for the refresh', () => {
        Assert.match(PollingHandler.handlers.toString(), /InformationHandler\.refreshTeam\(rustplus\)/);
    });
});
