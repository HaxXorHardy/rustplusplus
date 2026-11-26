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
const DiscordTools = require('../src/discordTools/discordTools.js');
const LogChannelRelay = require('../src/util/logChannelRelay.js');

const GUILD_ID = '100000000000000007';

/*
    The relay talks to the client and to DiscordTools, both are stubbed here. Nothing is sent to Discord, the
    configured flush delay is long so the tests drive the flush with flushNow().
*/
function fakeClient(instance) {
    const client = {
        sent: [],
        intlGet: (guildId, id, variables = {}) =>
            (variables.hasOwnProperty('count') ? `${id}:${variables.count}` : id),
        getInstance: () => instance,
        messageSend: async (channel, content) => {
            client.sent.push({ channelId: channel.id, content: content.content });

            return { id: `message-${client.sent.length}` };
        },
    };

    return client;
}

function fakeInstance(channelId = 'channel-old') {
    return {
        channelId: { category: 'category', log: channelId },
        generalSettings: { serverLogLevel: 'info' },
    };
}

Test.describe('LogChannelRelay', () => {
    let originalGetTextChannelById = null;

    Test.beforeEach(() => {
        originalGetTextChannelById = DiscordTools.getTextChannelById;

        /* The relay reads the channel id from the instance on every flush, like the real code does. */
        DiscordTools.getTextChannelById = (guildId, channelId) => (channelId ? { id: channelId } : null);

        LogChannelRelay.configure({ flushDelayMs: 60000, minSendIntervalMs: 0 });
    });

    Test.afterEach(() => {
        LogChannelRelay.stopAll();
        DiscordTools.getTextChannelById = originalGetTextChannelById;
        Client.client = null;
    });

    Test.it('batches several lines into one message', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'line 1', 'info');
        LogChannelRelay.push(GUILD_ID, 'line 2', 'info');
        LogChannelRelay.push(GUILD_ID, 'line 3', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 1);
        Assert.strictEqual(Client.client.sent[0].channelId, 'channel-old');
        Assert.match(Client.client.sent[0].content, /line 1\nline 2\nline 3/);
        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 0);
    });

    Test.it('splits the lines into messages of at most ten lines', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);

        for (let i = 0; i < 25; i++) LogChannelRelay.push(GUILD_ID, `line ${i}`, 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 3);
        for (const message of Client.client.sent) {
            Assert.ok(message.content.length <= 2000, `message too long: ${message.content.length}`);
        }
    });

    Test.it('cuts a single very long line so the message stays inside the Discord limit', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'x'.repeat(5000), 'info');
        LogChannelRelay.push(GUILD_ID, 'after the long line', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        for (const message of Client.client.sent) {
            Assert.ok(message.content.length <= 2000, `message too long: ${message.content.length}`);
        }
        Assert.match(Client.client.sent[1].content, /after the long line/);
    });

    Test.it('posts nothing when the level is off', async () => {
        const instance = fakeInstance();
        instance.generalSettings.serverLogLevel = 'off';
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'an error', 'error');
        LogChannelRelay.pushStartLine(GUILD_ID, 'started');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 0);
        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 0);
    });

    Test.it('drops the lines the level does not allow', async () => {
        const instance = fakeInstance();
        instance.generalSettings.serverLogLevel = 'error';
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'info line', 'info');
        LogChannelRelay.push(GUILD_ID, 'warning line', 'warning');
        LogChannelRelay.push(GUILD_ID, 'error line', 'error');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 1);
        Assert.match(Client.client.sent[0].content, /error line/);
        Assert.doesNotMatch(Client.client.sent[0].content, /info line/);
        Assert.doesNotMatch(Client.client.sent[0].content, /warning line/);
    });

    Test.it('posts the start line for every level except off', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);

        for (const level of ['error', 'info', 'full']) {
            instance.generalSettings.serverLogLevel = level;
            LogChannelRelay.pushStartLine(GUILD_ID, `started ${level}`);
        }
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 1);
        Assert.match(Client.client.sent[0].content, /started error/);
        Assert.match(Client.client.sent[0].content, /started info/);
        Assert.match(Client.client.sent[0].content, /started full/);
    });

    Test.it('resolves the channel on every flush so a recreated channel is used', async () => {
        const instance = fakeInstance('channel-old');
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'old channel line', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        /* /reset discord: the channel is deleted, a new one is created and its id is stored. */
        LogChannelRelay.reset(GUILD_ID);
        instance.channelId.log = 'channel-new';

        LogChannelRelay.push(GUILD_ID, 'new channel line', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 2);
        Assert.strictEqual(Client.client.sent[0].channelId, 'channel-old');
        Assert.strictEqual(Client.client.sent[1].channelId, 'channel-new');
        Assert.match(Client.client.sent[1].content, /new channel line/);
    });

    Test.it('reset() drops what is queued and stops a flush that is sending', async () => {
        const instance = fakeInstance('channel-old');
        Client.client = fakeClient(instance);

        let release = null;
        Client.client.messageSend = async (channel, content) => {
            Client.client.sent.push({ channelId: channel.id, content: content.content });
            await new Promise((resolve) => { release = resolve; });

            return { id: 'message' };
        };

        LogChannelRelay.push(GUILD_ID, 'in flight', 'info');
        LogChannelRelay.push(GUILD_ID, 'still queued', 'info');
        const pending = LogChannelRelay.flushNow(GUILD_ID);

        /* Give the flush the chance to reach the send. */
        await new Promise((resolve) => setImmediate(resolve));

        LogChannelRelay.reset(GUILD_ID);
        release();
        await pending;

        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 0);
        Assert.strictEqual(Client.client.sent.length, 1);
    });

    Test.it('drops the lines when the channel does not exist', async () => {
        const instance = fakeInstance(null);
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'nobody reads this', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 0);
        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 0);
    });

    Test.it('keeps the queue bounded and tells how many lines were dropped', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);

        for (let i = 0; i < 510; i++) LogChannelRelay.push(GUILD_ID, `line ${i}`, 'info');

        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 500);

        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.match(Client.client.sent[0].content, /serverLogLinesDropped:10/);
    });

    Test.it('keeps the lines queued when the send fails', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);
        LogChannelRelay.configure({ flushDelayMs: 60000, minSendIntervalMs: 60000 });

        /* client.messageSend() reports the failure and returns undefined. */
        Client.client.messageSend = async () => undefined;

        LogChannelRelay.push(GUILD_ID, 'line 1', 'info');
        LogChannelRelay.push(GUILD_ID, 'line 2', 'info');
        LogChannelRelay.push(GUILD_ID, 'line 3', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        /* Nothing is lost: the lines are only removed after a successful send. */
        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 3);
    });

    Test.it('doubles the retry delay with every failed send up to the limit', () => {
        LogChannelRelay.configure({ minSendIntervalMs: 1000, maxRetryDelayMs: 300000 });

        try {
            Assert.deepStrictEqual([1, 2, 3, 4].map(LogChannelRelay.getRetryDelay), [2000, 4000, 8000, 16000]);
            Assert.strictEqual(LogChannelRelay.getRetryDelay(50), 300000);
        }
        finally {
            LogChannelRelay.configure({ maxRetryDelayMs: 5 * 60 * 1000 });
        }
    });

    /* The retry used to be scheduled while the flush was still marked as sending, so it never ran. */
    Test.it('retries a failed send on its own', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);
        LogChannelRelay.configure({ flushDelayMs: 60000, minSendIntervalMs: 1 });

        const send = Client.client.messageSend;
        let attempts = 0;
        Client.client.messageSend = async (channel, content, options) => {
            attempts++;
            if (attempts === 1) {
                options.onError(Object.assign(new Error('Service Unavailable'), { status: 503 }));
                return undefined;
            }
            return send(channel, content);
        };

        LogChannelRelay.push(GUILD_ID, 'line 1', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);
        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 1);

        const deadline = Date.now() + 2000;
        while (Client.client.sent.length === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        Assert.strictEqual(attempts, 2);
        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 0);
    });

    Test.it('stops posting into a channel that rejects the bot until the channel changes', async () => {
        const instance = fakeInstance('channel-old');
        Client.client = fakeClient(instance);
        const warnings = [];
        Client.client.log = (title, text) => warnings.push(text);

        const send = Client.client.messageSend;
        let attempts = 0;
        Client.client.messageSend = async (channel, content, options) => {
            attempts++;
            if (channel.id === 'channel-old') {
                options.onError(Object.assign(new Error('Missing Access'), { status: 403, code: 50001 }));
                return undefined;
            }
            return send(channel, content);
        };

        LogChannelRelay.push(GUILD_ID, 'line 1', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(attempts, 1);
        Assert.strictEqual(LogChannelRelay.getPendingLineCount(GUILD_ID), 0);
        Assert.strictEqual(warnings.length, 1);

        /* Further lines for the same channel are not queued, so nothing is sent again. */
        LogChannelRelay.push(GUILD_ID, 'line 2', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);
        Assert.strictEqual(attempts, 1);

        /* A new channel (setup, /reset discord) is posted into again. */
        instance.channelId.log = 'channel-new';
        LogChannelRelay.push(GUILD_ID, 'line 3', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(attempts, 2);
        Assert.strictEqual(Client.client.sent.length, 1);
        Assert.match(Client.client.sent[0].content, /line 3/);
    });

    Test.it('posts into a rejecting channel again after the guild was set up again', async () => {
        const instance = fakeInstance('channel-old');
        Client.client = fakeClient(instance);

        const send = Client.client.messageSend;
        let rejected = true;
        Client.client.messageSend = async (channel, content, options) => {
            if (rejected) {
                options.onError(Object.assign(new Error('Unknown Channel'), { status: 404, code: 10003 }));
                return undefined;
            }
            return send(channel, content);
        };

        LogChannelRelay.push(GUILD_ID, 'line 1', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        rejected = false;
        LogChannelRelay.resume(GUILD_ID);
        LogChannelRelay.push(GUILD_ID, 'line 2', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent.length, 1);
        Assert.match(Client.client.sent[0].content, /line 2/);
    });

    Test.it('flushAll() sends what is queued for every guild', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'line 1', 'info');
        LogChannelRelay.push('100000000000000008', 'line 2', 'info');
        await LogChannelRelay.flushAll();

        Assert.strictEqual(Client.client.sent.length, 2);
    });

    Test.it('neutralises backticks so a line cannot close the code block', async () => {
        const instance = fakeInstance();
        Client.client = fakeClient(instance);

        LogChannelRelay.push(GUILD_ID, 'value ``` inside', 'info');
        await LogChannelRelay.flushNow(GUILD_ID);

        Assert.strictEqual(Client.client.sent[0].content, "```\nvalue ''' inside\n```");
    });

    Test.it('formats the start line timestamp like the Logger', () => {
        Assert.strictEqual(LogChannelRelay.formatTime(new Date(2026, 10, 8, 9, 5, 3)), '2026-11-08 09:05:03');
    });
});
