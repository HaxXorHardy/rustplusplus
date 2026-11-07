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

const BattlemetricsTime = require('../src/util/battlemetricsTime.js');

Test.describe('BattlemetricsTime.getSessionSeconds', () => {
    Test.it('reads the session length from the metadata of the server request', () => {
        const meta = {
            metadata: [
                { key: 'firstTime', value: false },
                { key: 'score', value: 0 },
                { key: 'time', value: 17900.4375 },
            ],
        };

        Assert.strictEqual(BattlemetricsTime.getSessionSeconds(meta), 17900.4375);
    });

    Test.it('returns null when the metadata has no session', () => {
        Assert.strictEqual(BattlemetricsTime.getSessionSeconds({ metadata: [{ key: 'score', value: 0 }] }), null);
    });

    Test.it('returns null for a missing or malformed metadata', () => {
        Assert.strictEqual(BattlemetricsTime.getSessionSeconds(undefined), null);
        Assert.strictEqual(BattlemetricsTime.getSessionSeconds(null), null);
        Assert.strictEqual(BattlemetricsTime.getSessionSeconds({}), null);
        Assert.strictEqual(BattlemetricsTime.getSessionSeconds({ metadata: 'time' }), null);
    });

    Test.it('ignores a session that is not a finite number', () => {
        Assert.strictEqual(BattlemetricsTime.getSessionSeconds({ metadata: [{ key: 'time', value: '9' }] }), null);
        Assert.strictEqual(BattlemetricsTime.getSessionSeconds({ metadata: [{ key: 'time', value: null }] }), null);
    });
});

Test.describe('BattlemetricsTime.formatSeconds', () => {
    Test.it('formats a duration as HH:MM', () => {
        Assert.deepStrictEqual(BattlemetricsTime.formatSeconds(17900.4375), [17900, '04:58']);
        Assert.deepStrictEqual(BattlemetricsTime.formatSeconds(1159.9), [1159, '00:19']);
    });

    Test.it('keeps hours above a day', () => {
        Assert.deepStrictEqual(BattlemetricsTime.formatSeconds(39370), [39370, '10:56']);
        Assert.deepStrictEqual(BattlemetricsTime.formatSeconds(360000), [360000, '100:00']);
    });

    Test.it('floors partial seconds and clamps negative durations', () => {
        Assert.deepStrictEqual(BattlemetricsTime.formatSeconds(59.99), [59, '00:00']);
        Assert.deepStrictEqual(BattlemetricsTime.formatSeconds(-30), [0, '00:00']);
    });
});
