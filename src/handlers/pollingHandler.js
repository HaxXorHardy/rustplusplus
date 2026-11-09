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

module.exports = {
    pollingHandler: async function (rustplus, client) {
        /* Poll information such as info, mapMarkers, teamInfo and time */
        let info = await rustplus.getInfoAsync();
        if (!(await rustplus.isResponseValid(info))) return;
        let mapMarkers = await rustplus.getMapMarkersAsync();
        if (!(await rustplus.isResponseValid(mapMarkers))) return;
        let teamInfo = await rustplus.getTeamInfoAsync();
        if (!(await rustplus.isResponseValid(teamInfo))) return;
        let time = await rustplus.getTimeAsync();
        if (!(await rustplus.isResponseValid(time))) return;

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
    },
};
