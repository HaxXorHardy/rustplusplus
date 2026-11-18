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
    A map wipe of the connected server (rustplusEvents/connected.js detects it): what belonged to the old map is
    cleared - the death log, the running switch timers, the raid in progress, the alert and upkeep states - and a
    checklist with the devices that have to be paired again goes to the activity channel.
*/

const DeathLog = require('../util/deathLog.js');
const RaidHandler = require('./raidHandler.js');
const SwitchTimeouts = require('../util/switchTimeouts.js');

/* Clears the state of the old map. Returns the counts for the checklist. */
function clearOldMap(client, guildId, serverId) {
    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server) return null;

    DeathLog.clear(client, guildId, serverId);

    for (const key of Object.keys(server.pendingTimers || {})) SwitchTimeouts.cancel(guildId, serverId, key);
    for (const key of Object.keys(SwitchTimeouts.of(guildId, serverId))) SwitchTimeouts.cancel(guildId, serverId, key);

    RaidHandler.clearServer(guildId, serverId);

    for (const monitor of Object.values(server.storageMonitors || {})) {
        monitor.upkeepWarned = false;
        for (const rule of monitor.alerts || []) rule.triggered = false;
    }
    client.setInstance(guildId, instance);

    return {
        switches: Object.keys(server.switches || {}).length,
        alarms: Object.keys(server.alarms || {}).length,
        storageMonitors: Object.keys(server.storageMonitors || {}).length,
        groups: Object.keys(server.switchGroups || {}).length,
    };
}

async function onWipe(client, rustplus) {
    const counts = clearOldMap(client, rustplus.guildId, rustplus.serverId);
    if (counts === null) return;

    rustplus.log(client.intlGet(null, 'infoCap'),
        `Map wipe: the death log, the switch timers and the raid state of the old map were cleared.`);

    const DiscordMessages = require('../discordTools/discordMessages.js');
    await DiscordMessages.sendWipeChecklistMessage(rustplus.guildId, rustplus.serverId, counts);
}

module.exports = {
    clearOldMap: clearOldMap,
    onWipe: onWipe,
};
