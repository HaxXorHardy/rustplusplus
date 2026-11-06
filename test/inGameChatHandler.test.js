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

const InGameChatHandler = require('../src/handlers/inGameChatHandler.js');
const { CHANNELS } = require('../src/util/inGameChat.js');

/* The handler only reads settings and the chat channel, so a plain object is enough. */
function fakeRustplus(overrides = {}) {
    const rustplus = {
        guildId: 'guildId',
        generalSettings: {
            commandDelay: '60',
            trademark: 'NOT SHOWING',
            muteInGameBotMessages: false,
            inGameChatChannel: CHANNELS.CLAN,
        },
        inGameChatQueue: [],
        inGameChatTimeout: null,
        inGameChatChannelUnavailable: false,
        logs: [],
        inClan: false,
        isInClan: () => rustplus.inClan,
        updateBotMessages: () => undefined,
        log: (title, text, level = 'info') => rustplus.logs.push({ title, text, level }),
    };

    return Object.assign(rustplus, overrides);
}

function fakeClient() {
    return { intlGet: (guildId, key) => key };
}

Test.describe('In-Game chat channel selection', () => {
    Test.it('reports the clan chat as unavailable once when the account is not in a clan', async () => {
        const rustplus = fakeRustplus({ inClan: false });
        const client = fakeClient();

        await InGameChatHandler.inGameChatHandler(rustplus, client, 'first message', CHANNELS.CLAN);
        await InGameChatHandler.inGameChatHandler(rustplus, client, 'second message', CHANNELS.CLAN);

        Assert.deepStrictEqual(rustplus.inGameChatQueue, []);
        Assert.strictEqual(rustplus.logs.length, 1);
        Assert.strictEqual(rustplus.logs[0].level, 'warn');
        Assert.strictEqual(rustplus.inGameChatChannelUnavailable, true);
    });

    Test.it('queues the message for the clan chat when the account is in a clan', async () => {
        const rustplus = fakeRustplus({ inClan: true });
        rustplus.inGameChatChannelUnavailable = true;

        await InGameChatHandler.inGameChatHandler(rustplus, fakeClient(), 'hello', CHANNELS.CLAN);

        Assert.deepStrictEqual(rustplus.inGameChatQueue, [{ text: 'hello', chatChannel: CHANNELS.CLAN }]);
        Assert.strictEqual(rustplus.inGameChatChannelUnavailable, false);

        clearTimeout(rustplus.inGameChatTimeout);
        rustplus.inGameChatTimeout = null;
    });

    Test.it('sends a queued message through the clan chat request', async () => {
        const calls = [];
        const rustplus = fakeRustplus({ inClan: true });
        rustplus.sendClanMessageAsync = async (message) => calls.push(['clan', message]);
        rustplus.sendTeamMessageAsync = async (message) => calls.push(['team', message]);

        await InGameChatHandler.sendQueuedInGameMessage(
            rustplus, fakeClient(), { text: 'hello', chatChannel: CHANNELS.CLAN });

        Assert.deepStrictEqual(calls, [['clan', 'hello']]);
    });

    Test.it('sends a queued message through the team chat request', async () => {
        const calls = [];
        const rustplus = fakeRustplus({ inClan: true });
        rustplus.sendClanMessageAsync = async (message) => calls.push(['clan', message]);
        rustplus.sendTeamMessageAsync = async (message) => calls.push(['team', message]);

        await InGameChatHandler.sendQueuedInGameMessage(
            rustplus, fakeClient(), { text: 'hello', chatChannel: CHANNELS.TEAM });

        Assert.deepStrictEqual(calls, [['team', 'hello']]);
    });
});
