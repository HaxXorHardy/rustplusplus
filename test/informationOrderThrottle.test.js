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
    The information order check fetches up to 100 Discord messages. It ran once per minute (the most expensive call of
    the bot) and now runs once and then at most every 15 minutes.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const DiscordTools = require('../src/discordTools/discordTools.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');

Client.client = {
    intlGet: (guildId, key) => key,
    getInstance: () => ({ channelId: { information: 'information-channel' }, informationMessageId: {} }),
};

function stubChannel(t, channel) {
    const original = DiscordTools.getTextChannelById;
    DiscordTools.getTextChannelById = () => channel;
    t.after(() => { DiscordTools.getTextChannelById = original; });
}

Test.describe('DiscordMessages.ensureInformationMessageOrder', () => {
    Test.it('fetches the channel once and then waits 15 minutes', async (t) => {
        let fetches = 0;
        stubChannel(t, { messages: { fetch: async () => { fetches += 1; return new Map(); } } });

        const rustplus = { guildId: 'guild' };

        await DiscordMessages.ensureInformationMessageOrder(rustplus);
        Assert.strictEqual(fetches, 1);

        await DiscordMessages.ensureInformationMessageOrder(rustplus);
        Assert.strictEqual(fetches, 1, 'the second run within the interval does not fetch');

        rustplus.lastInformationOrderCheckMs -= (16 * 60 * 1000);
        await DiscordMessages.ensureInformationMessageOrder(rustplus);
        Assert.strictEqual(fetches, 2, 'after the interval it fetches again');
    });

    Test.it('does nothing without a channel', async (t) => {
        stubChannel(t, null);

        const rustplus = { guildId: 'guild' };

        await DiscordMessages.ensureInformationMessageOrder(rustplus);

        Assert.strictEqual(rustplus.lastInformationOrderCheckMs, undefined);
    });

    Test.it('treats a fresh instance as never checked', async (t) => {
        let fetches = 0;
        stubChannel(t, { messages: { fetch: async () => { fetches += 1; return new Map(); } } });

        const first = { guildId: 'guild' };
        await DiscordMessages.ensureInformationMessageOrder(first);

        /* A reconnect builds a new instance, the order is checked again right away. */
        const second = { guildId: 'guild' };
        await DiscordMessages.ensureInformationMessageOrder(second);

        Assert.strictEqual(fetches, 2);
    });
});
