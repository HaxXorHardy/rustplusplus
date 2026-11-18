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
    The information embeds and the storage monitors used to be awaited inside the poll, where one slow Discord call
    froze every poll-based update. They run in their own cycle now.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const BackgroundHandler = require('../src/handlers/backgroundHandler.js');
const InformationHandler = require('../src/handlers/informationHandler.js');
const StorageMonitorHandler = require('../src/handlers/storageMonitorHandler.js');

function fakeRustplus(overrides = {}) {
    const rustplus = {
        guildId: 'guild',
        isDeleted: false,
        isBackgroundRunning: false,
        backgroundTaskId: 0,
        logs: [],
        log: (cap, text, level) => rustplus.logs.push({ cap: cap, text: text, level: level }),
    };

    return Object.assign(rustplus, overrides);
}

function fakeClient() {
    return { intlGet: (guildId, key) => key };
}

function stubHandlers(t, calls, info = async () => calls.push('information')) {
    const originalInfo = InformationHandler.handler;
    const originalStorage = StorageMonitorHandler.handler;

    InformationHandler.handler = info;
    StorageMonitorHandler.handler = async () => calls.push('storage');

    t.after(() => {
        InformationHandler.handler = originalInfo;
        StorageMonitorHandler.handler = originalStorage;
    });
}

Test.describe('BackgroundHandler', () => {
    Test.it('runs the information embeds and the storage monitors', async (t) => {
        const calls = [];
        stubHandlers(t, calls);

        const rustplus = fakeRustplus();
        await BackgroundHandler.run(rustplus, fakeClient());

        Assert.deepStrictEqual(calls, ['information', 'storage']);
        Assert.strictEqual(rustplus.isBackgroundRunning, false);
    });

    Test.it('skips a tick while the previous cycle is still running', async (t) => {
        const calls = [];
        stubHandlers(t, calls);

        const rustplus = fakeRustplus({ isBackgroundRunning: true });
        await BackgroundHandler.run(rustplus, fakeClient());

        Assert.deepStrictEqual(calls, []);
        Assert.ok(rustplus.logs.some((line) => line.text.includes('still running')));
    });

    Test.it('stops the timer of a deleted instance', async (t) => {
        const calls = [];
        stubHandlers(t, calls);

        const rustplus = fakeRustplus({ isDeleted: true, backgroundTaskId: 12345 });
        await BackgroundHandler.run(rustplus, fakeClient());

        Assert.strictEqual(rustplus.backgroundTaskId, 0);
        Assert.deepStrictEqual(calls, []);
    });

    Test.it('keeps going when a step fails', async (t) => {
        const calls = [];
        stubHandlers(t, calls, async () => { throw new Error('Discord is down'); });

        const rustplus = fakeRustplus();
        await BackgroundHandler.run(rustplus, fakeClient());

        Assert.deepStrictEqual(calls, ['storage']);
        Assert.ok(rustplus.logs.some((line) => line.level === 'warn' && line.text.includes('Discord is down')));
    });

    Test.it('skips a step that is still pending, then gives it up after the hard limit', async (t) => {
        const calls = [];
        stubHandlers(t, calls);

        /* The storage monitors started 1 minute ago: still within the limit, skipped. */
        const rustplus = fakeRustplus({
            backgroundPending: { 'the storage monitors': { startedMs: Date.now() - 60 * 1000 } },
        });
        await BackgroundHandler.run(rustplus, fakeClient());

        Assert.deepStrictEqual(calls, ['information']);
        Assert.ok(rustplus.logs.some((line) => line.text.includes('the storage monitors is still running')));

        /* The same step hung for 7 hours (1.41.6): given up and run again. */
        calls.length = 0;
        rustplus.backgroundPending['the storage monitors'] = { startedMs: Date.now() - 7 * 60 * 60 * 1000 };
        await BackgroundHandler.run(rustplus, fakeClient());

        Assert.deepStrictEqual(calls, ['information', 'storage']);
        Assert.ok(rustplus.logs.some((line) => line.level === 'warn' && line.text.includes('given up')));
        Assert.strictEqual(rustplus.backgroundPending['the storage monitors'], undefined);
    });

    Test.it('a given-up run that settles late does not clear the flag of its replacement', async (t) => {
        const originalAbandon = BackgroundHandler.STEP_ABANDON_MS;
        const originalInfo = InformationHandler.handler;
        const originalStorage = StorageMonitorHandler.handler;
        t.after(() => {
            BackgroundHandler.STEP_ABANDON_MS = originalAbandon;
            InformationHandler.handler = originalInfo;
            StorageMonitorHandler.handler = originalStorage;
        });

        BackgroundHandler.STEP_ABANDON_MS = 0;
        InformationHandler.handler = async () => undefined;

        /* First run hangs until released, the second one hangs for good. */
        let releaseFirst;
        const runs = [new Promise((resolve) => { releaseFirst = resolve; }), new Promise(() => undefined)];
        let runIndex = 0;
        StorageMonitorHandler.handler = () => runs[runIndex++];

        const rustplus = fakeRustplus();
        const step = () => { BackgroundHandler.run(rustplus, fakeClient()); };

        /* Not awaited: both runs stay pending, the 15 s step deadline is not part of this test. */
        step();
        await new Promise((resolve) => setImmediate(resolve));
        const firstToken = rustplus.backgroundPending['the storage monitors'];

        rustplus.isBackgroundRunning = false;
        step();
        await new Promise((resolve) => setImmediate(resolve));
        const secondToken = rustplus.backgroundPending['the storage monitors'];

        Assert.ok(firstToken && secondToken && firstToken !== secondToken);

        releaseFirst();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        Assert.strictEqual(rustplus.backgroundPending['the storage monitors'], secondToken);
    });

    Test.it('starts and stops the interval', () => {
        const rustplus = fakeRustplus();

        BackgroundHandler.start(rustplus, fakeClient());
        Assert.notStrictEqual(rustplus.backgroundTaskId, 0);

        BackgroundHandler.stop(rustplus);
        Assert.strictEqual(rustplus.backgroundTaskId, 0);

        /* A second stop is harmless. */
        BackgroundHandler.stop(rustplus);
        Assert.strictEqual(rustplus.backgroundTaskId, 0);
    });
});
