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
const Config = require('../config');
const ReconnectBackoff = require('../src/util/reconnectBackoff.js');
const RustPlusLite = require('../src/structures/RustPlusLite.js');

const GUILD_ID = 'guild';

function fakeClient() {
    return {
        intlGet: (guildId, key) => key,
        activeRustplusInstances: { [GUILD_ID]: true },
        rustplusReconnectTimers: {},
        rustplusLiteReconnectTimers: {},
    };
}

/* A lite instance without the constructor, which would build a library client. */
function fakeLite(overrides = {}) {
    const lite = Object.create(RustPlusLite.prototype);

    return Object.assign(lite, {
        guildId: GUILD_ID,
        isActive: true,
        logged: [],
        log: (title, text, level) => lite.logged.push({ title, text, level }),
        rustplus: { leaderReconnectAttempts: 0, updateLeaderRustPlusLiteInstance: () => undefined },
    }, overrides);
}

Test.describe('RustPlusLite entity requests', () => {
    /* entityId is a field of AppRequest; nested in the payload the encoder dropped it. */
    Test.it('sends the entity id at the top level of the request', async () => {
        const sent = [];
        const lite = fakeLite({ sendRequestAsync: async (request) => { sent.push(request); return {}; } });

        await lite.getEntityInfoAsync(11);
        await lite.checkSubscriptionAsync(12);
        await lite.setEntityValueAsync(13, true);

        Assert.deepStrictEqual(sent, [
            { entityId: 11, getEntityInfo: {} },
            { entityId: 12, checkSubscription: {} },
            { entityId: 13, setEntityValue: { value: true } },
        ]);
    });
});

Test.describe('RustPlusLite reconnect', () => {
    Test.it('clears its own reconnect timer when connected, not the one of the main instance', async (t) => {
        const client = fakeClient();
        Client.client = client;

        const mainTimer = setTimeout(() => undefined, 60000);
        const liteTimer = setTimeout(() => undefined, 60000);
        t.after(() => { clearTimeout(mainTimer); clearTimeout(liteTimer); });

        client.rustplusReconnectTimers[GUILD_ID] = mainTimer;
        client.rustplusLiteReconnectTimers[GUILD_ID] = liteTimer;

        const lite = fakeLite({ getInfoAsync: async () => ({ info: {} }), isResponseValid: () => true });
        lite.rustplus.leaderReconnectAttempts = 4;

        await RustPlusLite.rustPlusLiteConnectedEvent(lite);

        Assert.strictEqual(client.rustplusReconnectTimers[GUILD_ID], mainTimer);
        Assert.strictEqual(client.rustplusLiteReconnectTimers[GUILD_ID], null);
        Assert.strictEqual(lite.rustplus.leaderReconnectAttempts, 0);
    });

    Test.it('waits longer with every failed leader reconnect', async (t) => {
        const client = fakeClient();
        Client.client = client;

        const delays = [];
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = (fn, delay) => { delays.push(delay); return { delay }; };
        t.after(() => { global.setTimeout = originalSetTimeout; });

        const lite = fakeLite();
        const original = clearTimeout;
        global.clearTimeout = () => undefined;
        t.after(() => { global.clearTimeout = original; });

        for (let i = 0; i < 3; i++) await RustPlusLite.rustPlusLiteDisconnectedEvent(lite);

        const interval = Config.general.reconnectIntervalMs;
        const max = Config.general.reconnectIntervalMaxMs;
        Assert.deepStrictEqual(delays, [1, 2, 3].map((attempt) => ReconnectBackoff(attempt, interval, max)));
        Assert.ok(delays[1] > delays[0] || delays[0] === max);
        Assert.strictEqual(lite.rustplus.leaderReconnectAttempts, 3);
    });
});
