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
    A device setup step that timed out keeps running. A reconnect ran the same setup again next to it (duplicate
    messages, racing message id writes), and a retired connection still set up the devices of the guild.
*/

const Assert = require('node:assert');
const Path = require('node:path');
const Test = require('node:test');

const Connected = require('../src/rustplusEvents/connected.js');

const SETUP_PATH = Path.join(__dirname, '..', 'src', 'discordTools', 'SetupSwitches.js');

const client = { intlGet: (guildId, key) => key };
let current = null;

function fakeRustPlus(name) {
    const rustplus = {
        name: name,
        guildId: 'setupguild',
        logs: [],
        log: (title, text, level) => rustplus.logs.push({ text, level }),
        isCurrentInstance: () => current === rustplus,
    };

    return rustplus;
}

/* Replaces the setup module in the cache, connected.js requires it by the same file. */
function stubSetup(t, setup) {
    const resolved = require.resolve(SETUP_PATH);
    const original = require.cache[resolved];

    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: setup };
    t.after(() => {
        if (original) require.cache[resolved] = original;
        else delete require.cache[resolved];
    });
}

Test.describe('connected.runSetup', () => {
    Test.it('runs the setup of a reconnect after the late step, and never for a retired connection', async (t) => {
        const calls = [];
        let finishFirst = null;

        stubSetup(t, (c, rustplus) => {
            calls.push(rustplus.name);
            if (calls.length === 1) return new Promise((resolve) => { finishFirst = resolve; });
            return undefined;
        });

        const old = fakeRustPlus('old');
        current = old;

        /* The step of the old connection times out and keeps running. */
        await Connected.runSetup(client, old, 'the smart switches', SETUP_PATH, 20);
        Assert.deepStrictEqual(calls, ['old']);
        Assert.ok(old.logs.some((line) => line.level === 'warn'));

        /* The reconnect waits for it instead of running the same setup next to it. */
        const fresh = fakeRustPlus('fresh');
        current = fresh;

        const pending = Connected.runSetup(client, fresh, 'the smart switches', SETUP_PATH, 1000);
        await new Promise((resolve) => setTimeout(resolve, 20));
        Assert.deepStrictEqual(calls, ['old']);

        finishFirst();
        await pending;
        Assert.deepStrictEqual(calls, ['old', 'fresh']);

        /* The retired connection does not set up the devices anymore. */
        await Connected.runSetup(client, old, 'the smart switches', SETUP_PATH, 1000);
        Assert.deepStrictEqual(calls, ['old', 'fresh']);
    });
});
