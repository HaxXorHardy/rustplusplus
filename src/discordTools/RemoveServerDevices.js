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

const DiscordTools = require('./discordTools.js');

/*
    Removes the Discord messages of the devices of a server.

    Only the devices of the connected server are listed, so the messages of the previous server have to go when
    another server is connected or the connection is ended. Their message ids are cleared as well: a message id that
    points nowhere is reposted by discordMessages.sendMessage, so the devices of a server that is connected again get
    fresh messages instead of edits of deleted ones.
*/

/* The device collections of a server and the channel each of them is posted in. */
const DEVICE_CHANNELS = [
    { collection: 'switches', channel: 'switches' },
    { collection: 'switchGroups', channel: 'switchGroups' },
    { collection: 'alarms', channel: 'alarms' },
    { collection: 'storageMonitors', channel: 'storageMonitors' },
];

async function removeServerDevices(client, guildId, serverId) {
    const instance = client.getInstance(guildId);
    const server = (instance && instance.serverList) ? instance.serverList[serverId] : null;

    if (!server) return 0;

    let removed = 0;

    for (const entry of DEVICE_CHANNELS) {
        const channelId = instance.channelId ? instance.channelId[entry.channel] : null;
        const devices = server[entry.collection] || {};

        for (const deviceId of Object.keys(devices)) {
            const device = devices[deviceId];

            /* A device without a message (never posted, or removed already) has nothing to delete. */
            if (!device || !device.messageId) continue;

            await DiscordTools.deleteMessageById(guildId, channelId, device.messageId);
            device.messageId = null;
            removed += 1;
        }
    }

    if (removed !== 0) client.setInstance(guildId, instance);

    return removed;
}

module.exports = removeServerDevices;
