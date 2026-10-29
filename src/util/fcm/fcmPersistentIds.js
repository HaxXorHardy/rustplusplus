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

const getRuntimeDataStorage = require('../storage/getRuntimeDataStorage.js');

/* Namespace used to store the fcm state inside the runtime data storage. */
const STATE_NAMESPACE = 'fcm';

/* Maximum number of processed notification ids to remember. Older ids are dropped to keep the stored
   list bounded. Firebase only redelivers recent unacknowledged notifications, so a small window is
   enough to recognize a redelivered notification. */
const MAX_PROCESSED_PERSISTENT_IDS = 100;

/* Runtime persistence is optional: when it is unavailable the bot keeps working, but the processed
   notification ids only live in memory. Report that once instead of hiding the failure silently. */
let persistenceUnavailableReported = false;

function reportPersistenceUnavailable(error) {
    if (persistenceUnavailableReported) return;
    persistenceUnavailableReported = true;
    console.warn(`FCM notification ids will not be remembered across restarts: ${error.message}`);
}

function readProcessed(guildId, key) {
    try {
        const stored = getRuntimeDataStorage().getServerState(guildId, STATE_NAMESPACE, key);
        if (Array.isArray(stored)) {
            return stored.filter(e => typeof e === 'string' && e !== '');
        }
    }
    catch (e) {
        reportPersistenceUnavailable(e);
    }

    return [];
}

module.exports = {
    /**
     * Get the notification ids that were already processed in previous sessions. These are passed to
     * the FCM client on construction so Firebase acknowledges them and stops redelivering (and thus
     * re-announcing) notifications that were already handled.
     * @param {string} guildId The guild id.
     * @param {string} key The stream key, unique per FCM credential (e.g. `host:<steamId>`).
     * @return {Array<string>} The processed notification ids.
     */
    getProcessed: function (guildId, key) {
        return readProcessed(guildId, key);
    },

    /**
     * Check if a notification id was already processed.
     * @param {string} guildId The guild id.
     * @param {string} key The stream key, unique per FCM credential (e.g. `host:<steamId>`).
     * @param {string} persistentId The notification id.
     * @return {boolean} True if the notification id was already processed, false otherwise.
     */
    isProcessed: function (guildId, key, persistentId) {
        if (typeof persistentId !== 'string' || persistentId === '') return false;
        return readProcessed(guildId, key).includes(persistentId);
    },

    /**
     * Remember that a notification id was processed.
     * @param {string} guildId The guild id.
     * @param {string} key The stream key, unique per FCM credential (e.g. `host:<steamId>`).
     * @param {string} persistentId The notification id.
     */
    markProcessed: function (guildId, key, persistentId) {
        if (typeof persistentId !== 'string' || persistentId === '') return;

        const processed = readProcessed(guildId, key);
        if (processed.includes(persistentId)) return;

        processed.push(persistentId);
        if (processed.length > MAX_PROCESSED_PERSISTENT_IDS) {
            processed.splice(0, processed.length - MAX_PROCESSED_PERSISTENT_IDS);
        }

        try {
            getRuntimeDataStorage().setServerState(guildId, STATE_NAMESPACE, key, processed);
        }
        catch (e) {
            reportPersistenceUnavailable(e);
        }
    }
};
