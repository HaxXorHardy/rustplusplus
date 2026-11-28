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

const Schedule = require('../src/util/switchGroupSchedule.js');

const at = (iso) => new Date(iso);

Test.describe('switch group schedules', () => {
    Test.it('parses windows, the on/off words and an optional time zone', () => {
        const result = Schedule.parse('Europe/Berlin: 22:00-06:00 aus, 18:00-22:00 an; 25:00-26:00 on, junk',
            ['on', 'an'], ['off', 'aus']);

        Assert.strictEqual(result.schedule.timeZone, 'Europe/Berlin');
        Assert.deepStrictEqual(result.schedule.windows, [
            { from: 22 * 60, to: 6 * 60, value: false },
            { from: 18 * 60, to: 22 * 60, value: true },
        ]);
        Assert.deepStrictEqual(result.rejected, ['25:00-26:00 on', 'junk']);
        Assert.strictEqual(Schedule.format(result.schedule), 'Europe/Berlin: 22:00-06:00 off, 18:00-22:00 on');
        Assert.strictEqual(Schedule.parse('').schedule, null);
    });

    Test.it('knows windows over midnight', () => {
        const night = { from: 22 * 60, to: 6 * 60, value: false };

        Assert.strictEqual(Schedule.inside(night, 23 * 60), true);
        Assert.strictEqual(Schedule.inside(night, 5 * 60 + 59), true);
        Assert.strictEqual(Schedule.inside(night, 6 * 60), false);
        Assert.strictEqual(Schedule.inside(night, 12 * 60), false);
    });

    Test.it('reads the minute of the day in the time zone', () => {
        /* 21:30 UTC is 22:30 in Berlin in November (CET). */
        Assert.strictEqual(Schedule.minuteOfDay('Europe/Berlin', at('2026-11-18T21:30:00Z')), 22 * 60 + 30);
        Assert.strictEqual(Schedule.minuteOfDay('UTC', at('2026-11-18T21:30:00Z')), 21 * 60 + 30);
    });

    Test.it('switches only on the begin and the end of a window, the first check only records', () => {
        const schedule = Schedule.parse('UTC: 22:00-06:00 off').schedule;
        const state = {};

        Assert.deepStrictEqual(Schedule.transitions(schedule, state, at('2026-11-18T21:00:00Z')), [], 'first check');
        Assert.deepStrictEqual(Schedule.transitions(schedule, state, at('2026-11-18T21:59:00Z')), []);
        Assert.deepStrictEqual(Schedule.transitions(schedule, state, at('2026-11-18T22:00:00Z')),
            [{ index: 0, value: false }], 'the window begins: off');
        Assert.deepStrictEqual(Schedule.transitions(schedule, state, at('2026-11-19T03:00:00Z')), []);
        Assert.deepStrictEqual(Schedule.transitions(schedule, state, at('2026-11-19T06:00:00Z')),
            [{ index: 0, value: true }], 'the window ends: back on');
    });

    Test.it('makes one change per check for adjacent windows, the window that begins wins', () => {
        /* The "on" window begins when the "off" window ends: the group must stay on, not go off. */
        const schedule = Schedule.parse('UTC: 18:00-22:00 off, 22:00-23:00 on').schedule;
        const state = {};

        Schedule.transitions(schedule, state, at('2026-11-18T21:59:00Z'));
        Assert.deepStrictEqual(Schedule.transitions(schedule, state, at('2026-11-18T22:00:00Z')),
            [{ index: 1, value: true }]);

        /* In the other order of the list as well. */
        const reversed = Schedule.parse('UTC: 22:00-23:00 on, 18:00-22:00 off').schedule;
        const other = {};
        Schedule.transitions(reversed, other, at('2026-11-18T21:59:00Z'));
        Assert.deepStrictEqual(Schedule.transitions(reversed, other, at('2026-11-18T22:00:00Z')),
            [{ index: 0, value: true }]);
    });

    Test.it('the end of a window inside another one keeps the state of the one that still runs', () => {
        const schedule = Schedule.parse('UTC: 18:00-23:00 on, 19:00-20:00 on').schedule;
        const state = {};

        Schedule.transitions(schedule, state, at('2026-11-18T19:30:00Z'));
        Assert.deepStrictEqual(Schedule.transitions(schedule, state, at('2026-11-18T20:00:00Z')),
            [{ index: 0, value: true }], 'still on, not off');
    });

    Test.it('pendingTransition does not record the change until the caller does', () => {
        const schedule = Schedule.parse('UTC: 22:00-06:00 off').schedule;
        const state = {};

        Schedule.transitions(schedule, state, at('2026-11-18T21:59:00Z'));
        const first = Schedule.pendingTransition(schedule, state, at('2026-11-18T22:00:00Z'));
        Assert.deepStrictEqual(first.change, { index: 0, value: false });

        const again = Schedule.pendingTransition(schedule, state, at('2026-11-18T22:01:00Z'));
        Assert.deepStrictEqual(again.change, { index: 0, value: false }, 'still due');

        Object.assign(state, again.next);
        Assert.strictEqual(Schedule.pendingTransition(schedule, state, at('2026-11-18T22:02:00Z')).change, null);
    });
});
