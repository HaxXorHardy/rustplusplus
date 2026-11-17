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
    The information messages of a guild run one after the other. One operation that never finished held that queue
    forever - and with it the map message of the connect flow, so a reconnected server never started polling.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');

const logs = [];

Client.client = {
    intlGet: (guildId, key) => key,
    log: (title, text, level) => logs.push({ text: `${text}`, level: level }),
    getInstance: () => ({ channelId: { information: 'information-channel' }, informationMessageId: {} }),
    setInstance: () => undefined,
};

Test.describe('the information message queue', () => {
    Test.it('moves on when an operation never finishes', async (t) => {
        const originalTimeout = DiscordMessages.INFORMATION_MESSAGE_OPERATION_TIMEOUT_MS;
        const originalSend = DiscordMessages.sendMessage;
        t.after(() => {
            DiscordMessages.INFORMATION_MESSAGE_OPERATION_TIMEOUT_MS = originalTimeout;
            DiscordMessages.sendMessage = originalSend;
        });

        DiscordMessages.INFORMATION_MESSAGE_OPERATION_TIMEOUT_MS = 30;
        logs.length = 0;

        let calls = 0;
        DiscordMessages.sendMessage = () => {
            calls += 1;
            /* The first request never gets an answer, the second one does. */
            return calls === 1 ? new Promise(() => undefined) : Promise.resolve({ id: 'message' });
        };

        const hung = DiscordMessages.sendInformationMapMessage('guild-hang');
        const next = DiscordMessages.sendInformationMapMessage('guild-hang');

        await Assert.rejects(hung, (e) => e.code === 'ESTEPTIMEOUT');
        await next;

        Assert.strictEqual(calls, 2, 'the operation behind the hung one ran');
        Assert.ok(logs.some((l) => l.level === 'warn' && l.text.includes('sendInformationMapMessage')),
            'the timeout is logged with the name of the operation');
    });

    Test.it('keeps the order of the operations', async (t) => {
        const originalSend = DiscordMessages.sendMessage;
        t.after(() => { DiscordMessages.sendMessage = originalSend; });

        const order = [];
        let calls = 0;
        DiscordMessages.sendMessage = async () => {
            const call = ++calls;
            await new Promise((resolve) => setTimeout(resolve, call === 1 ? 20 : 0));
            order.push(call);
            return { id: `m${call}` };
        };

        await Promise.all([
            DiscordMessages.sendInformationMapMessage('guild-order'),
            DiscordMessages.sendInformationMapMessage('guild-order'),
        ]);

        Assert.deepStrictEqual(order, [1, 2]);
    });
});
