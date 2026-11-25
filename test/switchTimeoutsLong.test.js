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

const SwitchTimeouts = require('../src/util/switchTimeouts.js');

Test.describe('switch timers longer than setTimeout allows', () => {
    Test.it('a 25 day timer does not fire after 1 ms but when it is due', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        t.after(() => SwitchTimeouts.reset());

        const delay = 25 * 24 * 60 * 60 * 1000;
        let fired = 0;
        SwitchTimeouts.schedule('g', 's', 'lamp', delay, { kind: 'switch', id: 'lamp', value: false },
            async () => { fired += 1; });

        t.mock.timers.tick(1);
        Assert.strictEqual(fired, 0);

        t.mock.timers.tick(SwitchTimeouts.MAX_TIMEOUT_MS);
        Assert.strictEqual(fired, 0);
        Assert.notStrictEqual(SwitchTimeouts.getEnd('g', 's', 'lamp'), null);

        t.mock.timers.tick(delay - SwitchTimeouts.MAX_TIMEOUT_MS);
        Assert.strictEqual(fired, 1);
        Assert.strictEqual(SwitchTimeouts.of('g', 's').lamp, undefined);
    });

    Test.it('a timer that is cancelled during a later step does not fire', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        t.after(() => SwitchTimeouts.reset());

        let fired = 0;
        SwitchTimeouts.schedule('g', 's', 'lamp', SwitchTimeouts.MAX_TIMEOUT_MS + 1000,
            { kind: 'switch', id: 'lamp', value: false }, async () => { fired += 1; });

        t.mock.timers.tick(SwitchTimeouts.MAX_TIMEOUT_MS);
        SwitchTimeouts.cancel('g', 's', 'lamp');
        t.mock.timers.tick(1000);
        Assert.strictEqual(fired, 0);
    });
});
