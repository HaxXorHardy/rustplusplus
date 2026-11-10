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
    Without a token every Battlemetrics request is answered with 401, so the bot must not send any. These tests stub the
    HTTP client and pin that nothing leaves the process while RPP_BATTLEMETRICS_TOKEN is empty.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Axios = require('axios');

const Battlemetrics = require('../src/structures/Battlemetrics.js');
const Client = require('../src/structures/clientRegistry.js');
const Config = require('../config');

const SERVER_ID = 31619741;

/* Counts the requests instead of sending them. */
function stubAxios(t) {
    const original = Axios.get;
    const calls = [];

    Axios.get = async (url) => {
        calls.push(url);
        return { status: 200, data: { data: { id: SERVER_ID, attributes: {} }, included: [] } };
    };

    t.after(() => {
        Axios.get = original;
    });

    return calls;
}

/* An empty token is what a user without the Battlemetrics integration has. */
function setToken(t, token) {
    const original = Config.battlemetrics.token;
    Config.battlemetrics.token = token;
    t.after(() => {
        Config.battlemetrics.token = original;
    });
}

function stubClient(t) {
    const logged = [];

    Client.client = {
        log: (title, text, level) => logged.push({ text: text, level: level }),
        intlGet: (guildId, key) => key,
    };

    t.after(() => {
        Client.client = null;
    });

    return logged;
}

Test.describe('Battlemetrics without a token', () => {
    Test.beforeEach((t) => {
        setToken(t, '');
        stubClient(t);
    });

    Test.it('sends no request', async (t) => {
        const calls = stubAxios(t);
        const bmInstance = new Battlemetrics(SERVER_ID);

        Assert.strictEqual(await bmInstance.request(bmInstance.GET_SERVER_DATA_API_CALL(SERVER_ID)), null);
        Assert.deepStrictEqual(calls, []);
    });

    Test.it('does not evaluate and does not log a failure', async (t) => {
        const calls = stubAxios(t);
        const logged = stubClient(t);
        const bmInstance = new Battlemetrics(SERVER_ID);

        Assert.strictEqual(await bmInstance.evaluation(), null);
        Assert.deepStrictEqual(calls, []);
        Assert.deepStrictEqual(logged, []);
        Assert.strictEqual(bmInstance.lastUpdateSuccessful, null);
    });

    Test.it('does not set up the instance', async (t) => {
        const calls = stubAxios(t);
        const bmInstance = new Battlemetrics(null, 'Some Server');

        await bmInstance.setup();

        Assert.deepStrictEqual(calls, []);
        Assert.strictEqual(bmInstance.ready, false);
    });

    Test.it('does not search a server by name', async (t) => {
        const calls = stubAxios(t);
        const bmInstance = new Battlemetrics(null, 'Some Server');

        Assert.strictEqual(await bmInstance.getServerIdFromName('Some Server'), null);
        Assert.deepStrictEqual(calls, []);
    });

    Test.it('warms neither the time played nor the session cache', async (t) => {
        const calls = stubAxios(t);
        const bmInstance = new Battlemetrics(SERVER_ID);
        bmInstance.players['15046681'] = { id: '15046681', name: 'Sickboy', status: true, sessionTime: null };

        await bmInstance.warmTimePlayedCache();
        await bmInstance.warmSessionStarts();

        Assert.deepStrictEqual(calls, []);
    });

    Test.it('does not read a profile', async (t) => {
        const calls = stubAxios(t);
        const bmInstance = new Battlemetrics(SERVER_ID);

        Assert.deepStrictEqual(await bmInstance.getProfileData('15046681'), []);
        Assert.deepStrictEqual(calls, []);
    });

    Test.it('clears the instances of the bot', async (t) => {
        const calls = stubAxios(t);
        const DiscordBot = require('../src/structures/DiscordBot.js');

        const bot = { battlemetricsInstances: { [SERVER_ID]: { id: SERVER_ID } }, guilds: { cache: new Map() } };
        await DiscordBot.prototype.updateBattlemetricsInstances.call(bot);

        Assert.deepStrictEqual(bot.battlemetricsInstances, {});
        Assert.deepStrictEqual(calls, []);
    });
});

Test.describe('Battlemetrics with a token', () => {
    Test.it('sends the request', async (t) => {
        setToken(t, 'test-token');
        stubClient(t);
        const calls = stubAxios(t);
        const bmInstance = new Battlemetrics(SERVER_ID);

        await bmInstance.request(bmInstance.GET_SERVER_DATA_API_CALL(SERVER_ID));

        Assert.deepStrictEqual(calls, [bmInstance.GET_SERVER_DATA_API_CALL(SERVER_ID)]);
    });
});
