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
    The Rust+ token bucket (24 tokens, 3 per second). It used to be refilled only by a setInterval that a late
    'disconnected' event of a previous socket could clear - the bot then polled a dead connection for days and logged
    "Tokens did not replenish in time" every poll. The bucket is refilled from the elapsed time now, so it cannot starve.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const RustPlus = require('../src/structures/RustPlus.js');

/* Only the intl lookup of the client is used by the token bucket. */
Client.client = { intlGet: (guildId, key) => key };

function bucket(tokens, msAgo = 0) {
    const rustplus = Object.create(RustPlus.prototype);

    rustplus.tokens = tokens;
    rustplus.tokensUpdatedMs = Date.now() - msAgo;
    rustplus.logs = [];
    rustplus.log = (title, text, level) => rustplus.logs.push({ title: title, text: text, level: level });

    return rustplus;
}

Test.describe('RustPlus token bucket', () => {
    Test.it('refills three tokens per elapsed second', () => {
        const rustplus = bucket(0, 5000);

        rustplus.replenishTokens();

        Assert.strictEqual(rustplus.tokens, 15);
    });

    Test.it('never refills more than the limit', () => {
        const rustplus = bucket(20, 60000);

        rustplus.replenishTokens();

        Assert.strictEqual(rustplus.tokens, 24);
    });

    Test.it('does not refill before a second has passed', () => {
        const rustplus = bucket(0, 400);

        rustplus.replenishTokens();

        Assert.strictEqual(rustplus.tokens, 0);
    });

    Test.it('takes a token when one is free', async () => {
        const rustplus = bucket(5);

        Assert.strictEqual(await rustplus.waitForAvailableTokens(1), true);
        Assert.strictEqual(rustplus.tokens, 4);
    });

    Test.it('waits until a token has been replenished', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

        const rustplus = bucket(0);
        const promise = rustplus.waitForAvailableTokens(1);

        t.mock.timers.tick(1500);

        Assert.strictEqual(await promise, true);
        Assert.strictEqual(rustplus.tokens, 2);
        Assert.strictEqual(rustplus.logs.length, 0);
    });

    Test.it('gives up after the timeout and warns instead of failing hard', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

        const rustplus = bucket(0);
        const promise = rustplus.waitForAvailableTokens(1000);

        t.mock.timers.tick(31000);

        Assert.strictEqual(await promise, false);
        Assert.strictEqual(rustplus.logs.length, 1);
        Assert.strictEqual(rustplus.logs[0].level, 'warn');
    });

    /* A request that never left is a local condition, isResponseValid logs it as a warning. */
    Test.it('marks the empty bucket as a local error', () => {
        const rustplus = bucket(0);
        const response = rustplus.tokenErrorResponse();

        Assert.strictEqual(response.localError, 'tokensDidNotReplenish');
        Assert.ok(typeof (response.error) === 'string');
    });
});
