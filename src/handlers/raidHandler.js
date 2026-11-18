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
    Smart alarms of the connected server, beyond the single trigger message:

    - cooldown: an alarm that fires again within RPP_ALARM_COOLDOWN seconds posts no new message, the next posted
      one says how many were left out (a raid used to flood the activity channel),
    - escalation: an alarm that fires ESCALATE_AFTER times within ESCALATION_WINDOW_MS mentions @everyone,
    - raid mode: an alarm while nobody of the team is online starts a raid - the registered Discord users get a direct
      message (once per raid), the teammates that come online are noted, and after RAID_QUIET_MS without an alarm a
      raid report goes to the activity channel.

    Everything is in memory per guild and server; a restart forgets a running raid.
*/

const GuildSettings = require('../util/guildSettings.js');

const ESCALATION_WINDOW_MS = 5 * 60 * 1000;
const ESCALATE_AFTER = 2;
const RAID_QUIET_MS = 10 * 60 * 1000;

const states = new Map();   /* `${guildId}:${serverId}` -> { alarms: { [id]: { lastPostedMs, suppressed, times } }, raid } */

function stateOf(guildId, serverId) {
    const key = `${guildId}:${serverId}`;
    let state = states.get(key);

    if (state === undefined) {
        state = { alarms: {}, raid: null };
        states.set(key, state);
    }

    return state;
}

function cooldownMs(guildId) {
    const seconds = GuildSettings.alarmCooldownSeconds(guildId);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

/*
    An alarm of the connected server fired. Returns what to do with it:
    { post, suppressed, everyone, directMessage, raidStarted }
    post: send the trigger message (false within the cooldown), suppressed: how many were left out before this one,
    everyone: mention @everyone (escalation), directMessage: send the raid direct message now.
*/
function onAlarm(rustplus, alarmId, now = Date.now()) {
    const state = stateOf(rustplus.guildId, rustplus.serverId);
    const id = `${alarmId}`;
    const alarm = state.alarms[id] || (state.alarms[id] = { lastPostedMs: null, suppressed: 0, times: [] });

    alarm.times = alarm.times.filter((t) => now - t < ESCALATION_WINDOW_MS);
    alarm.times.push(now);

    const decision = { post: true, suppressed: 0, everyone: false, directMessage: false, raidStarted: false };

    if (alarm.lastPostedMs !== null && now - alarm.lastPostedMs < cooldownMs(rustplus.guildId)) {
        alarm.suppressed += 1;
        decision.post = false;
    }
    else {
        decision.suppressed = alarm.suppressed;
        alarm.suppressed = 0;
        alarm.lastPostedMs = now;
    }

    if (alarm.times.length >= ESCALATE_AFTER) decision.everyone = true;

    const teamOffline = Boolean(rustplus.team && rustplus.team.allOffline);
    if (GuildSettings.raidModeEnabled(rustplus.guildId) && (teamOffline || state.raid !== null)) {
        if (state.raid === null) {
            state.raid = { startedMs: now, lastAlarmMs: now, alarms: {}, cameOnline: [], directMessageSent: false };
            decision.raidStarted = true;
        }

        state.raid.lastAlarmMs = now;
        state.raid.alarms[id] = (state.raid.alarms[id] || 0) + 1;

        if (!state.raid.directMessageSent && teamOffline) {
            state.raid.directMessageSent = true;
            decision.directMessage = true;
        }
    }

    return decision;
}

/* A teammate came online: noted in the report of a running raid. */
function onTeamOnline(rustplus, name, now = Date.now()) {
    const state = states.get(`${rustplus.guildId}:${rustplus.serverId}`);
    if (!state || state.raid === null) return;

    state.raid.cameOnline.push({ name: `${name}`, atMs: now });
}

/* Every poll: a raid without an alarm for RAID_QUIET_MS is over. Returns the finished raid, or null. */
function takeFinishedRaid(rustplus, now = Date.now()) {
    const state = states.get(`${rustplus.guildId}:${rustplus.serverId}`);
    if (!state || state.raid === null || now - state.raid.lastAlarmMs < RAID_QUIET_MS) return null;

    const raid = state.raid;
    state.raid = null;
    return raid;
}

function currentRaid(rustplus) {
    const state = states.get(`${rustplus.guildId}:${rustplus.serverId}`);
    return state ? state.raid : null;
}

/* The poll step: posts the report of a raid that is over. */
async function handler(rustplus, client) {
    const raid = takeFinishedRaid(rustplus);
    if (raid === null) return;

    const DiscordMessages = require('../discordTools/discordMessages.js');
    rustplus.log(client.intlGet(null, 'infoCap'),
        `The raid alarm of ${rustplus.serverId} is quiet for ${RAID_QUIET_MS / 60000} minutes, the raid report is posted.`);
    await DiscordMessages.sendRaidReportMessage(rustplus.guildId, rustplus.serverId, raid);
}

/* A map wipe: the raid and the alarm history of the server are over. */
function clearServer(guildId, serverId) {
    states.delete(`${guildId}:${serverId}`);
}

/* For tests. */
function reset() {
    states.clear();
}

module.exports = {
    ESCALATION_WINDOW_MS: ESCALATION_WINDOW_MS,
    ESCALATE_AFTER: ESCALATE_AFTER,
    RAID_QUIET_MS: RAID_QUIET_MS,
    onAlarm: onAlarm,
    onTeamOnline: onTeamOnline,
    takeFinishedRaid: takeFinishedRaid,
    currentRaid: currentRaid,
    handler: handler,
    clearServer: clearServer,
    reset: reset,
};
