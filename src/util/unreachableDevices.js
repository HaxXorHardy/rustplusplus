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
    A device that the server does not know anymore answers `not_found` to every getEntityInfo of it: it was destroyed
    in game, paired with another server, or lost with a wipe. The device round (switches, alarms, storage monitors) runs
    every 30 polls, so such a device used to produce one ERROR line every five minutes, hours after it was gone.

    It is asked once an hour instead. The list lives on the instance (in memory): the first round after a reconnect
    asks every device again, which is exactly the recovery path - a device that is back is picked up there.
*/

const RETRY_MS = 60 * 60 * 1000;

function table(rustplus) {
    if (!rustplus.unreachableDeviceRetryMs || typeof rustplus.unreachableDeviceRetryMs !== 'object') {
        rustplus.unreachableDeviceRetryMs = new Object();
    }

    return rustplus.unreachableDeviceRetryMs;
}

/* True when the device answered not_found and is not due for another try. */
function isUnreachable(rustplus, entityId, now = Date.now()) {
    const retryAt = table(rustplus)[`${entityId}`];

    return typeof retryAt === 'number' && now < retryAt;
}

/* The device answered not_found: do not ask it again for a while. */
function markUnreachable(rustplus, entityId, now = Date.now()) {
    table(rustplus)[`${entityId}`] = now + RETRY_MS;
}

/* The device answered, so it is asked again on every round. */
function markReachable(rustplus, entityId) {
    delete table(rustplus)[`${entityId}`];
}

module.exports = {
    RETRY_MS: RETRY_MS,
    isUnreachable: isUnreachable,
    markUnreachable: markUnreachable,
    markReachable: markReachable,
};
