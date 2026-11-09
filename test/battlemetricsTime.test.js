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

const Battlemetrics = require('../src/structures/Battlemetrics.js');
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

/*
    Build an instance with players but without a request, so the getters can be tested on their own.
*/
function fakeBattlemetrics(players) {
    const bmInstance = new Battlemetrics(1234567, 'Test Server');
    for (const [playerId, player] of Object.entries(players)) {
        bmInstance.players[playerId] = player;
    }

    bmInstance.onlinePlayers = Object.keys(players).filter((playerId) => players[playerId].status === true);
    bmInstance.offlinePlayers = Object.keys(players).filter((playerId) => players[playerId].status === false);

    return bmInstance;
}

Test.describe('Battlemetrics.getOnlineTime', () => {
    Test.it('reports the length of the current session', () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Kælle', status: true, sessionTime: 35983.58984375 },
        });

        Assert.deepStrictEqual(bmInstance.getOnlineTime('15046681'), [35983, '09:59']);
    });

    /*
        A failed request (rate limit, 5xx, timeout) must not hide the session of the last successful one, otherwise
        a single error response blanks the time of every player in the embed.
    */
    Test.it('keeps reporting the session when the latest request failed', () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Kælle', status: true, sessionTime: 35983.58984375 },
        });

        bmInstance.lastUpdateSuccessful = false;

        Assert.deepStrictEqual(bmInstance.getOnlineTime('15046681'), [35983, '09:59']);
    });

    Test.it('returns null for an unknown player or without a reported session', () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'NoSession', status: true, sessionTime: null },
            '15046682': { id: '15046682', name: 'TextSession', status: true, sessionTime: '9' },
            '15046683': { id: '15046683', name: 'MissingSession', status: true },
        });

        Assert.strictEqual(bmInstance.getOnlineTime('15046681'), null);
        Assert.strictEqual(bmInstance.getOnlineTime('15046682'), null);
        Assert.strictEqual(bmInstance.getOnlineTime('15046683'), null);
        Assert.strictEqual(bmInstance.getOnlineTime('404'), null);
    });
});

Test.describe('Battlemetrics.getOfflineTime', () => {
    Test.it('reports the time since the player logged out', () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': {
                id: '15046681', name: 'Fronk', status: false,
                logoutDate: new Date(Date.now() - (5400 * 1000)).toISOString(),
            },
        });

        const time = bmInstance.getOfflineTime('15046681');

        Assert.ok(Math.abs(time[0] - 5400) <= 2, `expected about 5400 seconds, got ${time[0]}`);
        Assert.strictEqual(time[1], '01:30');
    });

    Test.it('keeps reporting the time offline when the latest request failed', () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': {
                id: '15046681', name: 'Fronk', status: false,
                logoutDate: new Date(Date.now() - (5400 * 1000)).toISOString(),
            },
        });

        bmInstance.lastUpdateSuccessful = false;

        const time = bmInstance.getOfflineTime('15046681');

        Assert.ok(Math.abs(time[0] - 5400) <= 2, `expected about 5400 seconds, got ${time[0]}`);
        Assert.strictEqual(time[1], '01:30');
    });

    Test.it('returns null without a logout date or for an unknown player', () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'NeverSeen', status: false, logoutDate: null },
        });

        Assert.strictEqual(bmInstance.getOfflineTime('15046681'), null);
        Assert.strictEqual(bmInstance.getOfflineTime('404'), null);
    });
});
