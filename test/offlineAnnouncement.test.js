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
    A 15 second reconnect used to post `server just went offline` and one reconnect later `server just went online`.
    The announcement waits for the delay, a reconnect in between drops it.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const OfflineAnnouncement = require('../src/util/offlineAnnouncement.js');

function fakeClient() {
    return new Object();
}

/* The timer callback is async, one event loop turn runs it to the end of its await. */
function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

Test.describe('OfflineAnnouncement', () => {
    Test.it('announces an outage only after the delay', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const client = fakeClient();
        let sent = 0;

        OfflineAnnouncement.schedule(client, 'guild', async () => { sent += 1; });
        Assert.strictEqual(sent, 0);

        t.mock.timers.tick(OfflineAnnouncement.OFFLINE_DELAY_MS - 1);
        await flush();
        Assert.strictEqual(sent, 0, 'a blip within the delay is no outage');

        t.mock.timers.tick(1);
        await flush();
        Assert.strictEqual(sent, 1);

        Assert.strictEqual(OfflineAnnouncement.takeAnnounced(client, 'guild'), true);
        Assert.strictEqual(OfflineAnnouncement.takeAnnounced(client, 'guild'), false, 'online is posted once per outage');
    });

    Test.it('drops the announcement when the reconnect comes in time', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const client = fakeClient();
        let sent = 0;

        OfflineAnnouncement.schedule(client, 'guild', async () => { sent += 1; });
        Assert.strictEqual(OfflineAnnouncement.cancel(client, 'guild'), true);

        t.mock.timers.tick(OfflineAnnouncement.OFFLINE_DELAY_MS * 2);
        await flush();

        Assert.strictEqual(sent, 0);
        Assert.strictEqual(OfflineAnnouncement.takeAnnounced(client, 'guild'), false);
        Assert.strictEqual(OfflineAnnouncement.cancel(client, 'guild'), false, 'nothing is pending anymore');
    });

    Test.it('keeps one announcement per guild', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const client = fakeClient();
        let first = 0;
        let second = 0;

        OfflineAnnouncement.schedule(client, 'guild', async () => { first += 1; });
        OfflineAnnouncement.schedule(client, 'guild', async () => { second += 1; });

        t.mock.timers.tick(OfflineAnnouncement.OFFLINE_DELAY_MS);
        await flush();

        Assert.strictEqual(first, 0, 'the replaced announcement is dropped');
        Assert.strictEqual(second, 1);
    });

    Test.it('keeps the guilds apart', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const client = fakeClient();
        const sent = [];

        OfflineAnnouncement.schedule(client, 'guild-a', async () => { sent.push('a'); });
        OfflineAnnouncement.schedule(client, 'guild-b', async () => { sent.push('b'); });

        OfflineAnnouncement.cancel(client, 'guild-a');

        t.mock.timers.tick(OfflineAnnouncement.OFFLINE_DELAY_MS);
        await flush();

        Assert.deepStrictEqual(sent, ['b']);
    });

    Test.it('survives a post that fails', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const client = fakeClient();

        OfflineAnnouncement.schedule(client, 'guild', async () => { throw new Error('Discord is down'); });

        t.mock.timers.tick(OfflineAnnouncement.OFFLINE_DELAY_MS);
        await flush();

        /* The outage was announced, so the reconnect answers with an `online` message. */
        Assert.strictEqual(OfflineAnnouncement.takeAnnounced(client, 'guild'), true);
    });
});
