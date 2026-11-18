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
const RustPlusSync = require('../util/rustplusSync.js');
const SwitchTimeouts = require('../util/switchTimeouts.js');

/* The device collections, the channel their messages live in. */
const DEVICES = [
    { collection: 'switches', channel: 'switches' },
    { collection: 'alarms', channel: 'alarms' },
    { collection: 'storageMonitors', channel: 'storageMonitors' },
];

/* Clears the state of the old map. Returns the counts for the checklist. */
function clearOldMap(client, guildId, serverId) {
    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server) return null;

    DeathLog.clear(client, guildId, serverId);

    for (const key of Object.keys(server.pendingTimers || {})) SwitchTimeouts.cancel(guildId, serverId, key);
    for (const key of Object.keys(SwitchTimeouts.of(guildId, serverId))) SwitchTimeouts.cancel(guildId, serverId, key);

    RaidHandler.clearServer(guildId, serverId);

    /* The devices of the old map: what "remove the old devices" of the checklist removes (not ones paired later). */
    server.wipeOldDevices = { atMs: Date.now() };
    for (const entry of DEVICES) server.wipeOldDevices[entry.collection] = Object.keys(server[entry.collection] || {});

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

/* The devices that would be removed: those of the old map, or all with options.all. */
function devicesToRemove(server, options = {}) {
    const result = {};
    const old = options.all ? null : server.wipeOldDevices;

    for (const entry of DEVICES) {
        const existing = Object.keys(server[entry.collection] || {});
        result[entry.collection] = old && Array.isArray(old[entry.collection]) ?
            existing.filter((id) => old[entry.collection].includes(id)) : existing;
    }

    return result;
}

function countOf(devices) {
    return DEVICES.reduce((sum, entry) => sum + devices[entry.collection].length, 0);
}

/*
    Remove the devices of the old map after a wipe: their Discord messages, their entries (marked as deleted, so the
    pairing history cannot bring them back) and their place in the switch groups. The groups themselves stay (name,
    command, schedule, ...). Returns the removed counts. deps.deleteMessage for tests.
*/
async function removeOldDevices(client, guildId, serverId, options = {}, deps = {}) {
    const DiscordTools = require('../discordTools/discordTools.js');
    const deleteMessage = deps.deleteMessage || ((channelId, messageId) =>
        DiscordTools.deleteMessageById(guildId, channelId, messageId));

    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server) return null;

    const devices = devicesToRemove(server, options);
    const rustplus = client.rustplusInstances ? client.rustplusInstances[guildId] : null;
    const removed = { switches: 0, alarms: 0, storageMonitors: 0 };

    for (const entry of DEVICES) {
        const channelId = instance.channelId ? instance.channelId[entry.channel] : null;

        for (const id of devices[entry.collection]) {
            const device = server[entry.collection][id];
            if (!device) continue;

            if (device.messageId) {
                try {
                    await deleteMessage(channelId, device.messageId);
                }
                catch (e) {
                    /* Already gone. */
                }
            }

            if (entry.collection === 'switches') SwitchTimeouts.cancel(guildId, serverId, id);
            if (entry.collection === 'storageMonitors' && rustplus && rustplus.storageMonitors) {
                delete rustplus.storageMonitors[id];
            }

            RustPlusSync.markDeviceDeleted(instance, server, id);
            delete server[entry.collection][id];
            removed[entry.collection] += 1;
        }
    }

    const groupsChanged = [];
    for (const [groupId, group] of Object.entries(server.switchGroups || {})) {
        const switches = (group.switches || []).filter((id) => server.switches[id]);
        const alarms = Array.isArray(group.alarms) ? group.alarms.filter((id) => server.alarms[id]) : group.alarms;
        if (switches.length !== (group.switches || []).length ||
            (Array.isArray(alarms) && alarms.length !== group.alarms.length)) {
            group.switches = switches;
            if (Array.isArray(alarms)) group.alarms = alarms;
            groupsChanged.push(groupId);
        }
    }

    delete server.wipeOldDevices;
    client.setInstance(guildId, instance);

    if (!deps.skipGroupMessages) {
        const DiscordMessages = require('../discordTools/discordMessages.js');
        for (const groupId of groupsChanged) {
            DiscordMessages.sendSmartSwitchGroupMessage(guildId, serverId, groupId).catch(() => undefined);
        }
    }

    return removed;
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
    devicesToRemove: devicesToRemove,
    countOf: countOf,
    removeOldDevices: removeOldDevices,
    clearOldMap: clearOldMap,
    onWipe: onWipe,
};
