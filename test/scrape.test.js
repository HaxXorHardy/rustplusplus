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

/* The Steam scraper retries temporary failures and limits the size of an answer. */

const Assert = require('node:assert');
const Test = require('node:test');

const Axios = require('axios');

const Constants = require('../src/util/constants.js');
const Scrape = require('../src/util/scrape.js');
const Timer = require('../src/util/timer.js');

/* Answers with the given statuses one after another, an error status rejects like Axios does. */
function stubAxios(t, statuses) {
    const originalGet = Axios.get;
    const originalSleep = Timer.sleep;
    const calls = [];

    Axios.get = async (url, options) => {
        calls.push(options);
        const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
        if (status === 200) return { status: 200, data: 'ok' };
        const error = new Error(`HTTP ${status}`);
        error.response = { status: status };
        throw error;
    };
    Timer.sleep = async () => undefined;

    t.after(() => {
        Axios.get = originalGet;
        Timer.sleep = originalSleep;
    });

    return calls;
}

Test.describe('Scrape.scrape', () => {
    for (const status of [500, 502, 504, 503, 429]) {
        Test.it(`retries an HTTP ${status}`, async (t) => {
            const calls = stubAxios(t, [status, 200]);

            const response = await Scrape.scrape('https://steamcommunity.com/profiles/1');

            Assert.strictEqual(response.status, 200);
            Assert.strictEqual(calls.length, 2);
        });
    }

    Test.it('gives up after the last attempt and does not retry a 404', async (t) => {
        let calls = stubAxios(t, [502]);
        Assert.strictEqual((await Scrape.scrape('https://steamcommunity.com/profiles/1')).status, 502);
        Assert.strictEqual(calls.length, Constants.SCRAPE_MAX_ATTEMPTS);

        calls.length = 0;
        Axios.get = async (url, options) => {
            calls.push(options);
            const error = new Error('HTTP 404');
            error.response = { status: 404 };
            throw error;
        };
        Assert.strictEqual((await Scrape.scrape('https://steamcommunity.com/profiles/1')).status, 404);
        Assert.strictEqual(calls.length, 1);
    });

    Test.it('limits the size of the answer', async (t) => {
        const calls = stubAxios(t, [200]);

        await Scrape.scrape('https://steamcommunity.com/profiles/1');

        Assert.ok(Number.isFinite(calls[0].maxContentLength) && calls[0].maxContentLength > 0);
    });
});
