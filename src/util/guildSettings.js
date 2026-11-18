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
    Settings of the alarms, the upkeep warning and the time zone, set per guild in the settings channel. A guild that
    never chose a value uses the environment (RPP_ALARM_COOLDOWN, RPP_RAID_MODE, RPP_UPKEEP_WARNING_HOURS,
    RPP_TIMEZONE) - the values are not in the settings template on purpose, a template value would hide them.
*/

const Config = require('../../config');

const ALARM_COOLDOWN_OPTIONS = [0, 30, 60, 120, 300, 600];
const UPKEEP_WARNING_OPTIONS = [0, 1, 2, 4, 6, 12, 24];
const TIME_ZONE_OPTIONS = [
    'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Helsinki', 'Europe/Moscow', 'Europe/Istanbul',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney',
    'Pacific/Auckland'
];

function isValidTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: timeZone });
        return true;
    }
    catch (e) {
        return false;
    }
}

function settingsOf(guildId) {
    const Client = require('../structures/clientRegistry.js');
    const client = Client.client;
    if (!client || typeof client.getInstance !== 'function' || !guildId) return {};

    const instance = client.getInstance(guildId);
    return instance && instance.generalSettings ? instance.generalSettings : {};
}

function numberOr(value, fallback) {
    const n = Number(value);
    return value !== undefined && value !== null && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

function alarmCooldownSeconds(guildId) {
    return numberOr(settingsOf(guildId).alarmCooldownSeconds, numberOr(Config.general.alarmCooldownSeconds, 60));
}

function raidModeEnabled(guildId) {
    const value = settingsOf(guildId).raidModeEnabled;
    return typeof value === 'boolean' ? value : Config.general.raidModeEnabled !== false;
}

function upkeepWarningHours(guildId) {
    return numberOr(settingsOf(guildId).upkeepWarningHours, numberOr(Config.general.upkeepWarningHours, 6));
}

function timeZone(guildId) {
    const own = settingsOf(guildId).timeZone;
    if (own && isValidTimeZone(own)) return own;

    const configured = Config.general.scheduleTimeZone;
    return configured && isValidTimeZone(configured) ? configured : 'UTC';
}

module.exports = {
    ALARM_COOLDOWN_OPTIONS: ALARM_COOLDOWN_OPTIONS,
    UPKEEP_WARNING_OPTIONS: UPKEEP_WARNING_OPTIONS,
    TIME_ZONE_OPTIONS: TIME_ZONE_OPTIONS,
    isValidTimeZone: isValidTimeZone,
    alarmCooldownSeconds: alarmCooldownSeconds,
    raidModeEnabled: raidModeEnabled,
    upkeepWarningHours: upkeepWarningHours,
    timeZone: timeZone,
};
