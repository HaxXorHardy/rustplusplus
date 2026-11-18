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

const UpkeepWarning = require('../src/util/upkeepWarning.js');

const HOUR = 60 * 60;
const now = 1800000000;

Test.describe('upkeep early warning', () => {
    Test.it('warns once when the upkeep left drops below the threshold', () => {
        const tc = { upkeepWarned: false };

        Assert.strictEqual(UpkeepWarning.check(tc, now + 10 * HOUR, now, 6), null, 'plenty left');
        Assert.strictEqual(UpkeepWarning.check(tc, now + 5 * HOUR, now, 6), 'warn');

        tc.upkeepWarned = true;
        Assert.strictEqual(UpkeepWarning.check(tc, now + 4 * HOUR, now, 6), null, 'not again');
    });

    Test.it('warns again only after the cupboard was filled up past the threshold and a margin', () => {
        const tc = { upkeepWarned: true };

        Assert.strictEqual(UpkeepWarning.check(tc, now + 6 * HOUR + 30 * 60, now, 6), null, 'within the margin');
        Assert.strictEqual(UpkeepWarning.check(tc, now + 8 * HOUR, now, 6), 'rearm');
    });

    Test.it('leaves a decaying cupboard to its own message, and is off with 0 hours', () => {
        Assert.strictEqual(UpkeepWarning.check({ upkeepWarned: false }, 0, now, 6), null);
        Assert.strictEqual(UpkeepWarning.check({ upkeepWarned: false }, now + HOUR, now, 0), null);
    });
});
