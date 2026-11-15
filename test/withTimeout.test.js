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
    A step of the poll that hangs (a Discord call waiting on a rate limit) used to freeze the whole cycle. It gets a
    deadline now, so the cycle moves on and the hang shows up in the log as a step timeout.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const withTimeout = require('../src/util/withTimeout.js');

Test.describe('withTimeout', () => {
    Test.it('resolves with the value of a step that finishes in time', async () => {
        Assert.strictEqual(await withTimeout.withTimeout(Promise.resolve(42), 1000, 'the step'), 42);
    });

    Test.it('rejects with ESTEPTIMEOUT when the step hangs', async () => {
        const error = await withTimeout.withTimeout(new Promise(() => undefined), 20, 'the information')
            .then(() => null, (e) => e);

        Assert.strictEqual(error.code, 'ESTEPTIMEOUT');
        Assert.match(error.message, /the information did not finish/);
    });

    Test.it('passes the error of the step through', async () => {
        const error = await withTimeout.withTimeout(Promise.reject(new Error('Discord is down')), 1000, 'the step')
            .then(() => null, (e) => e);

        Assert.strictEqual(error.message, 'Discord is down');
        Assert.strictEqual(error.code, undefined);
    });

    /* The late answer of a step that already timed out must not settle the promise a second time. */
    Test.it('ignores the answer of a step that timed out already', async () => {
        let finish = null;
        const late = new Promise((resolve) => { finish = resolve; });

        const error = await withTimeout.withTimeout(late, 20, 'the step').then(() => null, (e) => e);
        Assert.strictEqual(error.code, 'ESTEPTIMEOUT');

        finish('too late');
        await new Promise((resolve) => setImmediate(resolve));
    });

    Test.it('uses a default deadline of ten seconds', () => {
        Assert.strictEqual(withTimeout.DEFAULT_TIMEOUT_MS, 10 * 1000);
    });
});
