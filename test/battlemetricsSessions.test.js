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
const Config = require('../config');

const SERVER_ID = 31619741;

function fakeBattlemetrics(players) {
    const bmInstance = new Battlemetrics(SERVER_ID, 'Test Server');
    bmInstance.lastUpdateSuccessful = true;

    for (const [playerId, player] of Object.entries(players)) {
        bmInstance.players[playerId] = player;
    }

    bmInstance.onlinePlayers = Object.entries(players)
        .filter(([, player]) => player.status === true)
        .map(([playerId]) => playerId);

    return bmInstance;
}

/*
    Replace the request of the instance: every call returns the given sessions and is recorded in the returned array.
*/
function stubSessions(bmInstance, sessions) {
    const calls = [];

    bmInstance.request = async (apiCall) => {
        calls.push(apiCall);
        return { data: sessions };
    };

    return calls;
}

function openSession(secondsAgo) {
    return { type: 'session', attributes: { start: new Date(Date.now() - secondsAgo * 1000).toISOString(), stop: null } };
}

function closedSession(secondsAgo) {
    return {
        type: 'session',
        attributes: {
            start: new Date(Date.now() - secondsAgo * 1000).toISOString(),
            stop: new Date(Date.now() - (secondsAgo - 600) * 1000).toISOString(),
        },
    };
}

Test.describe('Battlemetrics.warmSessionStarts', () => {
    Test.beforeEach((t) => {
        const original = Config.battlemetrics.token;
        Config.battlemetrics.token = 'test-token';  /* enabled is derived from the token. */
        t.after(() => {
            Config.battlemetrics.token = original;
        });
    });

    /*
        Battlemetrics does not report the session in the metadata of the server request for every server. The session
        history of the player reports the same sessions and is the source for those servers.
    */
    Test.it('reads the start of the running session from the session history', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Sickboy', status: true, sessionTime: null, onlineSince: null },
        });

        const calls = stubSessions(bmInstance, [closedSession(10800), openSession(1200)]);

        await bmInstance.warmSessionStarts();

        Assert.strictEqual(calls.length, 1);
        Assert.match(calls[0], /\/players\/15046681\/relationships\/sessions/);
        Assert.match(calls[0], new RegExp(`filter\\[servers\\]=${SERVER_ID}`));
        Assert.ok(bmInstance.players['15046681'].onlineSince !== null);
    });

    Test.it('reports the session it read as the online time', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Sickboy', status: true, sessionTime: null, onlineSince: null },
        });

        stubSessions(bmInstance, [openSession(7860)]);

        Assert.strictEqual(bmInstance.getOnlineTime('15046681'), null);

        await bmInstance.warmSessionStarts();

        const time = bmInstance.getOnlineTime('15046681');
        Assert.ok(Math.abs(time[0] - 7860) <= 2, `expected about 7860 seconds, got ${time[0]}`);
        Assert.strictEqual(time[1], '02:11');
    });

    Test.it('ignores sessions that already ended and does not ask again right away', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'NeverOpen', status: true, sessionTime: null, onlineSince: null },
        });

        const calls = stubSessions(bmInstance, [closedSession(3600)]);

        await bmInstance.warmSessionStarts();
        Assert.strictEqual(bmInstance.players['15046681'].onlineSince, null);

        await bmInstance.warmSessionStarts();
        Assert.strictEqual(calls.length, 1, 'the failed lookup has to be cached');
    });

    Test.it('does not look up a player whose session battlemetrics reports', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Kælle', status: true, sessionTime: 35983.5, onlineSince: null },
        });

        const calls = stubSessions(bmInstance, [openSession(1200)]);

        await bmInstance.warmSessionStarts();

        Assert.strictEqual(calls.length, 0);
        Assert.deepStrictEqual(bmInstance.getOnlineTime('15046681'), [35983, '09:59']);
    });

    Test.it('does not look up a player whose login this instance saw', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': {
                id: '15046681', name: 'Sickboy', status: true, sessionTime: null,
                onlineSince: new Date(Date.now() - (600 * 1000)).toISOString(),
            },
        });

        const calls = stubSessions(bmInstance, [openSession(1200)]);

        await bmInstance.warmSessionStarts();

        Assert.strictEqual(calls.length, 0);
    });

    Test.it('does not look up offline players', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Gone', status: false, sessionTime: null, onlineSince: null },
        });

        const calls = stubSessions(bmInstance, [openSession(1200)]);

        await bmInstance.warmSessionStarts();

        Assert.strictEqual(calls.length, 0);
    });

    Test.it('stays within the number of lookups per call', async () => {
        const players = {};
        for (let i = 0; i < 5; i++) {
            players[String(15046680 + i)] =
                { id: String(15046680 + i), name: `Player${i}`, status: true, sessionTime: null, onlineSince: null };
        }

        const bmInstance = fakeBattlemetrics(players);
        const calls = stubSessions(bmInstance, [openSession(1200)]);

        await bmInstance.warmSessionStarts(2);

        Assert.strictEqual(calls.length, 2);
        Assert.strictEqual(Object.values(players).filter((player) => player.onlineSince !== null).length, 2);
    });

    Test.it('skips the lookups while the server request fails', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Sickboy', status: true, sessionTime: null, onlineSince: null },
        });
        bmInstance.lastUpdateSuccessful = false;

        const calls = stubSessions(bmInstance, [openSession(1200)]);

        await bmInstance.warmSessionStarts();

        Assert.strictEqual(calls.length, 0);
    });

    Test.it('does nothing while battlemetrics is disabled', async () => {
        const bmInstance = fakeBattlemetrics({
            '15046681': { id: '15046681', name: 'Sickboy', status: true, sessionTime: null, onlineSince: null },
        });

        const calls = stubSessions(bmInstance, [openSession(1200)]);
        Config.battlemetrics.token = '';

        await bmInstance.warmSessionStarts();

        Assert.strictEqual(calls.length, 0);
    });
});
