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
    A socket that reconnects after a few seconds is no outage. The `server just went offline` embed and the grey server
    message used to be posted on every close, followed by `online` one reconnect later - a 15 second blip produced a
    pair of messages in the activity channel.

    The announcement is armed instead: it is posted only when the guild is still not connected after OFFLINE_DELAY_MS.
    A reconnect in between drops it, and `online` is only posted when the outage was announced.
*/

const OFFLINE_DELAY_MS = 60 * 1000;

function tables(client) {
    if (!client.rustplusOfflineTimers || typeof client.rustplusOfflineTimers !== 'object') {
        client.rustplusOfflineTimers = new Object();
    }

    if (!client.rustplusOfflineAnnounced || typeof client.rustplusOfflineAnnounced !== 'object') {
        client.rustplusOfflineAnnounced = new Object();
    }
}

/* Arms the announcement, `send` posts the offline messages when the guild is still down after the delay. */
function schedule(client, guildId, send, delayMs = OFFLINE_DELAY_MS) {
    tables(client);
    cancel(client, guildId);

    const timer = setTimeout(async () => {
        client.rustplusOfflineTimers[guildId] = null;
        client.rustplusOfflineAnnounced[guildId] = true;

        try {
            await send();
        }
        catch (e) {
            /* A failed post must not end as an unhandled rejection of a timer. */
        }
    }, delayMs);

    if (typeof timer.unref === 'function') timer.unref();

    client.rustplusOfflineTimers[guildId] = timer;

    return timer;
}

/* Drops a pending announcement, true when one was armed. */
function cancel(client, guildId) {
    tables(client);

    const pending = client.rustplusOfflineTimers[guildId];
    if (!pending) return false;

    clearTimeout(pending);
    client.rustplusOfflineTimers[guildId] = null;

    return true;
}

/* True when the outage was announced, and forgets it - so `online` is posted once per outage. */
function takeAnnounced(client, guildId) {
    tables(client);

    const announced = client.rustplusOfflineAnnounced[guildId] === true;
    client.rustplusOfflineAnnounced[guildId] = false;

    return announced;
}

module.exports = {
    OFFLINE_DELAY_MS: OFFLINE_DELAY_MS,
    schedule: schedule,
    cancel: cancel,
    takeAnnounced: takeAnnounced,
};
