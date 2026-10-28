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
    Shapes of the persisted domain state. These are JSDoc types only (no runtime code) so editors and
    the staged type-check can follow the instance/settings objects that handlers mutate.
*/

/**
 * Notification channel flags for one notification setting.
 * @typedef {Object} NotificationSetting
 * @property {boolean} discord
 * @property {boolean} inGame
 * @property {boolean} voice
 */

/**
 * General (per guild) settings as persisted in instances/<guildId>.json.
 * @typedef {Object} GeneralSettings
 * @property {string} language
 * @property {string} prefix
 * @property {boolean} inGameCommandsEnabled
 * @property {boolean} muteInGameBotMessages
 * @property {boolean} connectionNotify
 * @property {boolean} afkNotify
 * @property {boolean} teamChat
 */

/**
 * One Rust server inside the server list.
 * @typedef {Object} ServerEntry
 * @property {string} title
 * @property {string} ip
 * @property {string} port
 * @property {Object} switches
 * @property {Object} alarms
 * @property {Object} storageMonitors
 */

/**
 * Persisted state for one Discord guild.
 * @typedef {Object} Instance
 * @property {string} guildId
 * @property {boolean} firstTime
 * @property {string|null} role
 * @property {string|null} activeServer
 * @property {{category: (string|null), information: (string|null), servers: (string|null),
 *   settings: (string|null), commands: (string|null), teamchat: (string|null),
 *   switches: (string|null), switchGroups: (string|null), storageMonitors: (string|null),
 *   alarms: (string|null), activity: (string|null), trackers: (string|null)}} channelId
 * @property {GeneralSettings} generalSettings
 * @property {Object<string, NotificationSetting>} notificationSettings
 * @property {Object<string, ServerEntry>} serverList
 * @property {{discordIds: string[]}} blacklist
 * @property {Array<{alias: string, value: string, index: number}>} aliases
 */

module.exports = {};
