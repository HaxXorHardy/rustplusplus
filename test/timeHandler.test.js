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

const TimeHandler = require('../src/handlers/timeHandler.js');

Test.describe('time handler', () => {
    Test.it('counts the real time between the calls, not one polling interval each', (t) => {
        t.mock.timers.enable({ apis: ['Date'] });

        const rustplus = {
            isFirstPoll: false,
            passedFirstSunriseOrSunset: true,
            startTimeObject: {},
            time: { timeTillActive: false, time: 8.0, startTime: 12, timeTillDay: {}, timeTillNight: {} },
            log: () => undefined,
        };
        const client = { pollingIntervalMs: 10000, intlGet: (g, key) => key };
        const day = (hour) => ({ time: hour, sunrise: 7, sunset: 19 });

        TimeHandler.checkChanges(rustplus, client, day(8.0));
        Assert.strictEqual(rustplus.time.timeTillNight[8.0], 0);

        /* A poll was skipped: 30 s passed, not 10. */
        rustplus.time.time = 8.0;
        t.mock.timers.tick(30000);
        TimeHandler.checkChanges(rustplus, client, day(8.1));

        Assert.strictEqual(rustplus.time.timeTillNight[8.0], 30);
        Assert.strictEqual(rustplus.time.timeTillNight[8.1], 0);
    });
});
