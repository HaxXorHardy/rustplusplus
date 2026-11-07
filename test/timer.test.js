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

const Timer = require('../src/util/timer.js');

Test.describe('Timer.getSecondsFromStringTime', () => {
    Test.it('parses days, hours, minutes and seconds', () => {
        Assert.strictEqual(Timer.getSecondsFromStringTime('1d2h3m4s'), 93784);
    });

    Test.it('adds repeated units', () => {
        Assert.strictEqual(Timer.getSecondsFromStringTime('1h30m'), 5400);
    });

    Test.it('returns null when the string has no duration', () => {
        Assert.strictEqual(Timer.getSecondsFromStringTime('nothing here'), null);
    });
});

Test.describe('Timer.convertDecimalToHoursMinutes', () => {
    Test.it('pads hours and minutes to two digits', () => {
        Assert.strictEqual(Timer.convertDecimalToHoursMinutes(3.5), '03:30');
    });

    Test.it('keeps values above nine hours unpadded', () => {
        Assert.strictEqual(Timer.convertDecimalToHoursMinutes(12.25), '12:15');
    });
});

Test.describe('Timer.secondsToCompactHours', () => {
    Test.it('reports whole hours below 1000h', () => {
        Assert.strictEqual(Timer.secondsToCompactHours(3 * 3600 + 59), '3h');
    });

    Test.it('compacts thousands of hours', () => {
        Assert.strictEqual(Timer.secondsToCompactHours(1500 * 3600), '1.5k');
        Assert.strictEqual(Timer.secondsToCompactHours(2000 * 3600), '2k');
    });
});

Test.describe('Timer.sleep', () => {
    Test.it('resolves after the requested delay', async () => {
        const start = Date.now();

        await Timer.sleep(15);

        Assert.ok(Date.now() - start >= 10);
    });
});
