/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

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

const Info = require('../structures/Info');
const CameraWatchHandler = require('../handlers/cameraWatchHandler.js');
const InformationHandler = require('../handlers/informationHandler.js');
const MapMarkers = require('../structures/MapMarkers.js');
const SmartAlarmHandler = require('../handlers/smartAlarmHandler.js');
const SmartSwitchHandler = require('../handlers/smartSwitchHandler.js');
const StorageMonitorHandler = require('../handlers/storageMonitorHandler.js');
const Team = require('../structures/Team');
const TeamHandler = require('../handlers/teamHandler.js');
const Time = require('../structures/Time');
const TimeHandler = require('../handlers/timeHandler.js');
const VendingMachines = require('../handlers/vendingMachineHandler.js');

/*
    Runs one handler of the poll. A failing handler must not stop the others and must not end as an unhandled rejection
    on every poll (the poll runs every few seconds).
*/
async function runHandler(rustplus, client, label, handler) {
    try {
        await handler();
    }
    catch (e) {
        rustplus.log(client.intlGet(null, 'warningCap'),
            `The handler for ${label} failed: ${e && e.message ? e.message : e}`, 'warn');
    }
}

/* A poll cycle can wait up to 30 s for a free token or a request timeout - the interval must not stack cycles. */
const MAX_FAILED_POLLS = 6;

/* Stops the polling loop of an instance that must not poll anymore. */
function stopPolling(rustplus) {
    clearInterval(rustplus.pollingTaskId);
    rustplus.pollingTaskId = 0;
}

/*
    Is this instance still the one that speaks for its guild? A reconnect can replace an instance while its polling loop
    keeps running; the old one would then poll forever without anyone reading its results.
*/
function isCurrentInstance(rustplus, client) {
    if (rustplus.isDeleted) return false;

    const instances = client.rustplusInstances;
    if (!instances || !Object.prototype.hasOwnProperty.call(instances, rustplus.guildId)) return true;

    return instances[rustplus.guildId] === rustplus;
}

/*
    A connection that keeps failing is torn down and rebuilt instead of polling a dead socket forever (that state used to
    survive for days, with one ERROR per minute for every request). disconnect() starts the regular reconnect with the
    growing delay (see rustplusEvents/disconnected.js).
*/
function updatePollHealth(rustplus, client, success) {
    if (success) {
        rustplus.consecutiveFailedPolls = 0;
        return;
    }

    rustplus.consecutiveFailedPolls = (rustplus.consecutiveFailedPolls || 0) + 1;
    if (rustplus.consecutiveFailedPolls < MAX_FAILED_POLLS) return;

    rustplus.consecutiveFailedPolls = 0;

    rustplus.log(client.intlGet(null, 'warningCap'),
        `${MAX_FAILED_POLLS} polls in a row got no valid answer from the server, reconnecting.`, 'warn');

    forceReconnect(rustplus, client);
}

/*
    Tear the connection down and let the client build a fresh instance. A socket that is already closed does not emit
    'disconnected' (there is nothing to close), so the instance is replaced here as well - otherwise the same dead
    connection would be polled forever.
*/
function forceReconnect(rustplus, client) {
    rustplus.disconnect();

    const timer = setTimeout(() => {
        if (rustplus.isDeleted) return;
        if (!client.rustplusInstances || client.rustplusInstances[rustplus.guildId] !== rustplus) return;

        stopPolling(rustplus);
        rustplus.isDeleted = true;
        delete client.rustplusInstances[rustplus.guildId];

        client.createRustplusInstance(rustplus.guildId, rustplus.server, rustplus.port, rustplus.playerId,
            rustplus.playerToken);
    }, 5000);

    if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
    pollingHandler: async function (rustplus, client) {
        /* One cycle at a time: the previous one may still wait for a token or for a response. */
        if (rustplus.isPolling) return;

        if (!isCurrentInstance(rustplus, client)) {
            stopPolling(rustplus);
            rustplus.log(client.intlGet(null, 'infoCap'),
                'The instance was replaced, its polling loop stopped.', 'debug');
            return;
        }

        rustplus.isPolling = true;

        let success = false;
        try {
            success = await module.exports.poll(rustplus, client);
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The poll failed: ${e && e.message ? e.message : e}`, 'warn');
        }
        finally {
            rustplus.isPolling = false;
        }

        updatePollHealth(rustplus, client, success);
    },

    /* One poll cycle, true when every request of the cycle was answered. */
    poll: async function (rustplus, client) {
        /* Poll information such as info, mapMarkers, teamInfo and time */
        let info = await rustplus.getInfoAsync();
        if (!(await rustplus.isResponseValid(info))) return false;
        let mapMarkers = await rustplus.getMapMarkersAsync();
        if (!(await rustplus.isResponseValid(mapMarkers))) return false;
        let teamInfo = await rustplus.getTeamInfoAsync();
        if (!(await rustplus.isResponseValid(teamInfo))) return false;
        let time = await rustplus.getTimeAsync();
        if (!(await rustplus.isResponseValid(time))) return false;

        if (rustplus.isFirstPoll) {
            rustplus.info = new Info(info.info);
            rustplus.time = new Time(time.time, rustplus, client);
            rustplus.team = new Team(teamInfo.teamInfo, rustplus);
            rustplus.mapMarkers = new MapMarkers(mapMarkers.mapMarkers, rustplus, client);
            rustplus.restorePersistentRuntimeState();
        }

        await module.exports.handlers(rustplus, client, info, mapMarkers, teamInfo, time);

        /* Cheap (one file read per hour): keeps the stored account token fresh while the connection runs. */
        await rustplus.checkAuthTokenRenewal();

        rustplus.isFirstPoll = false;

        return true;
    },

    handlers: async function (rustplus, client, info, mapMarkers, teamInfo, time) {
        await runHandler(rustplus, client, 'the team', () => TeamHandler.handler(rustplus, client, teamInfo.teamInfo));
        rustplus.team.updateTeam(teamInfo.teamInfo);

        await runHandler(rustplus, client, 'the smart switches',
            () => SmartSwitchHandler.handler(rustplus, client, time.time));
        await runHandler(rustplus, client, 'the time', () => TimeHandler.handler(rustplus, client, time.time));
        await runHandler(rustplus, client, 'the vending machines',
            () => VendingMachines.handler(rustplus, client, mapMarkers.mapMarkers));

        rustplus.time.updateTime(time.time);
        rustplus.info.updateInfo(info.info);
        rustplus.mapMarkers.updateMapMarkers(mapMarkers.mapMarkers);

        await runHandler(rustplus, client, 'the information', () => InformationHandler.handler(rustplus));
        await runHandler(rustplus, client, 'the storage monitors',
            () => StorageMonitorHandler.handler(rustplus, client));
        await runHandler(rustplus, client, 'the smart alarms', () => SmartAlarmHandler.handler(rustplus, client));

        /*
            The camera watch runs detached: a check needs a photo's worth of frames (seconds), the poll must not wait for
            it. It guards itself (one round at a time, an interval, a pause while the paired account is on the server).
        */
        CameraWatchHandler.handler(rustplus, client).catch((e) => {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The camera watch failed: ${e && e.message ? e.message : e}`, 'warn');
        });
    },
};
