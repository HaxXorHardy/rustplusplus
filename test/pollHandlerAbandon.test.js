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

const PollingHandler = require('../src/handlers/pollingHandler.js');

Test.describe('poll handlers that hang', () => {
    function pollSetup() {
        const logs = [];
        const rustplus = { log: (cap, text, level) => logs.push({ text, level }) };
        const client = { intlGet: (guildId, key) => key };
        return { rustplus, client, logs };
    }

    Test.it('skips a handler that is still running, then abandons it after the limit', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const { rustplus, client, logs } = pollSetup();

        let runs = 0;
        const hang = () => { runs += 1; return new Promise(() => undefined); };

        const first = PollingHandler.runHandler(rustplus, client, 'team', hang);
        t.mock.timers.tick(10 * 1000);
        await first;
        Assert.strictEqual(runs, 1);

        await PollingHandler.runHandler(rustplus, client, 'team', hang);
        Assert.strictEqual(runs, 1);

        t.mock.timers.tick(PollingHandler.HANDLER_ABANDON_MS);
        const third = PollingHandler.runHandler(rustplus, client, 'team', async () => { runs += 1; });
        t.mock.timers.tick(10 * 1000);
        await third;
        Assert.strictEqual(runs, 2);
        Assert.ok(logs.some((e) => /abandoned/.test(e.text)));
        Assert.strictEqual(rustplus.pollPending.team, undefined);
    });
});
