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

const Fs = require('fs');
const Path = require('path');

const AtomicWriteFile = require('./atomicWriteFile.js');
const Client = require('../structures/clientRegistry.js');

module.exports = {
    /*
        The Discord users that registered a steam account of this guild, the hoster first. A direct message (death
        notification, see credentialLoginHandler.registerCredentials) can only go to them.
    */
    getRegisteredDiscordUserIds: function (guildId) {
        const credentials = module.exports.readCredentialsFile(guildId);
        const userIds = [];

        const hoster = credentials.hoster;
        if (hoster && credentials[hoster] && credentials[hoster].discord_user_id) {
            userIds.push(`${credentials[hoster].discord_user_id}`);
        }

        for (const [steamId, content] of Object.entries(credentials)) {
            if (steamId === 'hoster' || !content || !content.discord_user_id) continue;

            const userId = `${content.discord_user_id}`;
            if (!userIds.includes(userId)) userIds.push(userId);
        }

        return userIds;
    },

    getSmartDevice: function (guildId, entityId) {
        /* Temporary function till discord modals gets more functional */
        const instance = Client.client.getInstance(guildId);

        for (const serverId in instance.serverList) {
            for (const switchId in instance.serverList[serverId].switches) {
                if (entityId === switchId) return { type: 'switch', serverId: serverId }
            }
            for (const alarmId in instance.serverList[serverId].alarms) {
                if (entityId === alarmId) return { type: 'alarm', serverId: serverId }
            }
            for (const storageMonitorId in instance.serverList[serverId].storageMonitors) {
                if (entityId === storageMonitorId) return { type: 'storageMonitor', serverId: serverId }
            }
        }
        return null;
    },

    /*
        Drops the ids of the information channel messages, for example after the channel was emptied or recreated.
        The next information cycle then posts the sections again instead of editing messages that are gone.
    */
    clearInformationMessageIds: function (instance) {
        for (const messageType in instance.informationMessageId) {
            instance.informationMessageId[messageType] = null;
        }
    },

    /* Drops the ids of the messages that were posted for the server list, the smart devices and the trackers. */
    clearEntityMessageIds: function (instance) {
        for (const serverId in instance.serverList) {
            const server = instance.serverList[serverId];

            server.messageId = null;
            for (const switchId in server.switches) server.switches[switchId].messageId = null;
            for (const alarmId in server.alarms) server.alarms[alarmId].messageId = null;
            for (const storageMonitorId in server.storageMonitors) {
                server.storageMonitors[storageMonitorId].messageId = null;
            }
            for (const groupId in server.switchGroups) server.switchGroups[groupId].messageId = null;
        }

        for (const trackerId in instance.trackers) {
            instance.trackers[trackerId].messageId = null;
        }
    },

    readInstanceFile: function (guildId) {
        const targetPath = Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
        const tempPath = targetPath + '.tmp';
        if (Fs.existsSync(tempPath)) {
            try {
                Fs.unlinkSync(tempPath);
            }
            catch (e) {
                console.warn(`Failed to remove stale temporary file: ${tempPath}`, e);
            }
        }

        return JSON.parse(Fs.readFileSync(targetPath, 'utf8'));
    },

    writeInstanceFile: function (guildId, instance) {
        const targetPath = Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
        AtomicWriteFile(targetPath, JSON.stringify(instance, null, 2));
    },

    readCredentialsFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        return JSON.parse(Fs.readFileSync(path, 'utf8'));
    },

    writeCredentialsFile: function (guildId, credentials) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        AtomicWriteFile(path, JSON.stringify(credentials, null, 2));
    },

    /**
     * Move a JSON file that cannot be parsed aside as <file>.corrupt-<timestamp>, so the caller can create a fresh
     * one with the defaults instead of failing on every start. The broken file is kept for a manual repair.
     * @param {string} path The JSON file.
     * @param {Date} [now]
     * @returns {(string|null)} The path the file was moved to, null when it is missing or valid.
     */
    quarantineCorruptJsonFile: function (path, now = new Date()) {
        if (!Fs.existsSync(path)) return null;

        try {
            JSON.parse(Fs.readFileSync(path, 'utf8'));
            return null;
        }
        catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
        }

        const target = `${path}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}`;
        Fs.renameSync(path, target);

        return target;
    },

    /**
     * Check the instance and credentials file of a guild before they are read on startup or when the bot joins.
     * A corrupt file is moved aside (see quarantineCorruptJsonFile) and reported loudly; the caller recreates it
     * with the defaults.
     * @param {string} guildId
     * @param {function(string): void} report Receives the error text for every file that was moved aside.
     * @returns {string[]} The paths the corrupt files were moved to.
     */
    quarantineCorruptGuildFiles: function (guildId, report) {
        const moved = [];

        for (const directory of ['instances', 'credentials']) {
            const path = Path.join(__dirname, '..', '..', directory, `${guildId}.json`);
            const target = module.exports.quarantineCorruptJsonFile(path);

            if (target !== null) {
                moved.push(target);
                report(`${directory}/${guildId}.json is not valid JSON. It was moved to ${Path.basename(target)} ` +
                    'and recreated with the defaults: the settings of this guild are reset' +
                    (directory === 'credentials' ? ' and its Rust+ credentials have to be added again.' : '.'));
            }
        }

        return moved;
    },
}
