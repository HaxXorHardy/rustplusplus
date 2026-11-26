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

const KeyedThrottle = require('../src/util/keyedThrottle.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => new Promise((resolve) => setImmediate(resolve));

Test.describe('KeyedThrottle', () => {
    let throttle = null;
    Test.afterEach(() => { if (throttle) throttle.reset(); });

    Test.it('runs the first request at once and the pushes in the pause once after it', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 60);
        const runs = [];

        await throttle.request('k', async () => runs.push('first'));
        Assert.deepStrictEqual(runs, ['first']);

        /* A stream of pushes in the pause: none runs now, the newest job runs after the pause. */
        for (let i = 0; i < 20; i++) await throttle.request('k', async () => runs.push(`push ${i}`));
        Assert.deepStrictEqual(runs, ['first']);
        Assert.strictEqual(throttle.isPending('k'), true);

        await sleep(100);
        Assert.deepStrictEqual(runs, ['first', 'push 19']);
        Assert.strictEqual(throttle.isPending('k'), false);
    });

    Test.it('keeps the pause between two runs also when the pushes never stop', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 50);
        const startedAt = [];
        const job = async () => { startedAt.push(Date.now()); await sleep(10); };

        const until = Date.now() + 260;
        while (Date.now() < until) {
            throttle.request('k', job);
            await sleep(5);
        }
        await sleep(80);

        /* ~260 ms of pushes every 5 ms: about one run per 60 ms (pause + run), not fifty. */
        Assert.ok(startedAt.length >= 3 && startedAt.length <= 6, `runs: ${startedAt.length}`);
        for (let i = 1; i < startedAt.length; i++) {
            Assert.ok(startedAt[i] - startedAt[i - 1] >= 55, `gap ${startedAt[i] - startedAt[i - 1]} ms`);
        }
    });

    Test.it('runs an immediate request in the pause and cancels the run that was due', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 60);
        const runs = [];

        await throttle.request('k', async () => runs.push('first'));
        await throttle.request('k', async () => runs.push('push'));
        await throttle.request('k', async () => runs.push('button'), { immediate: true });
        Assert.deepStrictEqual(runs, ['first', 'button']);

        await sleep(100);
        Assert.deepStrictEqual(runs, ['first', 'button']);
    });

    Test.it('queues an immediate request right after the running run, without the pause', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 10000);
        let release = null;
        const runs = [];

        const first = throttle.request('k', () => new Promise((resolve) => { runs.push('first'); release = resolve; }));
        await throttle.request('k', async () => runs.push('push'));
        await throttle.request('k', async () => runs.push('round'), { immediate: true });
        Assert.deepStrictEqual(runs, ['first']);

        release();
        await first;
        await tick();
        Assert.deepStrictEqual(runs, ['first', 'round']);
    });

    Test.it('waits delayMs before the first run', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 0);
        const runs = [];

        await throttle.request('k', async () => runs.push('a'), { delayMs: 40 });
        await throttle.request('k', async () => runs.push('b'), { delayMs: 40 });
        Assert.deepStrictEqual(runs, []);

        await sleep(70);
        Assert.deepStrictEqual(runs, ['b']);
    });

    Test.it('with an interval of 0 only coalesces', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 0);
        let edits = 0;

        await throttle.request('k', async () => { edits++; });
        await throttle.request('k', async () => { edits++; });
        Assert.strictEqual(edits, 2);
    });

    Test.it('keeps keys apart', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 10000);
        const runs = [];

        await throttle.request('a', async () => runs.push('a'));
        await throttle.request('b', async () => runs.push('b'));
        Assert.deepStrictEqual(runs, ['a', 'b']);
    });

    Test.it('hands the error of a detached run to onError and carries on', async () => {
        const errors = [];
        throttle = KeyedThrottle.createKeyedThrottle(() => 20, (key, e) => errors.push(`${key}: ${e.message}`));
        const runs = [];

        await throttle.request('k', async () => runs.push('first'));
        await throttle.request('k', async () => { throw new Error('boom'); });
        await sleep(50);
        Assert.deepStrictEqual(errors, ['k: boom']);

        await sleep(30);
        await throttle.request('k', async () => runs.push('after'));
        Assert.deepStrictEqual(runs, ['first', 'after']);
    });

    Test.it('forgets an idle key after its pause, but keeps the pause until then', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        throttle = KeyedThrottle.createKeyedThrottle(() => 1000);
        const runs = [];

        await throttle.request('k', async () => runs.push('first'));
        Assert.strictEqual(throttle.size(), 1);

        t.mock.timers.tick(500);
        await throttle.request('k', async () => runs.push('in the pause'));
        Assert.deepStrictEqual(runs, ['first'], 'the pause still holds');

        t.mock.timers.tick(500);
        await tick();
        Assert.deepStrictEqual(runs, ['first', 'in the pause']);
        Assert.strictEqual(throttle.size(), 1, 'kept for the pause after the run');

        t.mock.timers.tick(1000);
        Assert.strictEqual(throttle.size(), 0, 'forgotten when idle');
        Assert.strictEqual(throttle.isPending('k'), false);

        await throttle.request('k', async () => runs.push('later'));
        Assert.deepStrictEqual(runs, ['first', 'in the pause', 'later']);
    });

    Test.it('with an interval of 0 an idle key is forgotten at once', async () => {
        throttle = KeyedThrottle.createKeyedThrottle(() => 0);

        await throttle.request('k', async () => undefined);
        Assert.strictEqual(throttle.size(), 0);
    });
});
