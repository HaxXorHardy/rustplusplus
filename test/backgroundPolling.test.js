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
