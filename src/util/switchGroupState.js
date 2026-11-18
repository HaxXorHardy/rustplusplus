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
    The settings and the state of a switch group, read the same way by the handler and the Discord message. Groups
    created before these settings existed have none of the fields: every reader falls back to "off".
*/

/* group.autoDayNight */
const AUTO_OFF = 0;
const AUTO_DAY = 1;      /* on during the day, off at night */
const AUTO_NIGHT = 2;    /* on at night, off during the day */

function getAutoDayNight(group) {
    return [AUTO_DAY, AUTO_NIGHT].includes(group.autoDayNight) ? group.autoDayNight : AUTO_OFF;
}

/* The alarms that turn the group on, only those that still exist on the server. */
function getTriggerAlarms(server, group) {
    if (!Array.isArray(group.alarms)) return [];

    return group.alarms.filter((alarmId) => server.alarms && server.alarms.hasOwnProperty(alarmId));
}

/* Seconds after which a group turned on by an alarm turns off again, 0 = it stays on. */
function getAlarmOffAfterSeconds(group) {
    const seconds = parseInt(group.alarmOffAfterSeconds);

    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/* { on, total }: the switches of the group that are on, of those that exist and answer. */
function getGroupState(server, group) {
    let on = 0, total = 0;

    for (const entityId of group.switches) {
        const entity = server.switches[entityId];
        if (!entity || !entity.reachable) continue;

        total += 1;
        if (entity.active) on += 1;
    }

    return { on: on, total: total };
}

module.exports = {
    AUTO_OFF: AUTO_OFF,
    AUTO_DAY: AUTO_DAY,
    AUTO_NIGHT: AUTO_NIGHT,
    getAutoDayNight: getAutoDayNight,
    getTriggerAlarms: getTriggerAlarms,
    getAlarmOffAfterSeconds: getAlarmOffAfterSeconds,
    getGroupState: getGroupState,
};
