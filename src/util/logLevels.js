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
    Log levels of the server-log channel. They are also the values of the `serverLogLevel` setting, so the
    select menu, the relay and the tests all use the same list.

    off   - nothing is posted, the channel stays empty
    error - only errors are posted
    info  - informational messages, warnings and errors are posted
    full  - everything is posted, including debug lines (the Logger only writes them when RPP_DEBUG=true)
*/
const LOG_LEVELS = ['off', 'error', 'info', 'full'];

const DEFAULT_LOG_LEVEL = 'error';

/* A line is posted when its rank is not above the rank of the setting. */
const LEVEL_RANKS = { 'off': 0, 'error': 1, 'info': 2, 'full': 3 };

/*
    The Logger uses 'warn' (Winston) and 'warning' (the permission helpers) as well. Both are ranked like
    'info': warnings are interesting for exactly the same lines a user expects from the info level.
*/
const LINE_RANKS = { 'error': 1, 'warn': 2, 'warning': 2, 'info': 2, 'debug': 3 };

/**
 * Turn a stored setting value into one of LOG_LEVELS. Unknown values fall back to the default, so a
 * hand-edited instance file cannot silence the relay by accident.
 * @param {*} value Value read from the instance (or a select menu).
 * @returns {string} One of LOG_LEVELS.
 */
function normalizeLogLevel(value) {
    if (typeof value !== 'string') return DEFAULT_LOG_LEVEL;

    const level = value.trim().toLowerCase();
    return LOG_LEVELS.includes(level) ? level : DEFAULT_LOG_LEVEL;
}

/**
 * Decide whether a log line of the given level is posted with the given setting.
 * @param {*} setting The `serverLogLevel` setting.
 * @param {*} lineLevel Level the Logger used for the line (info, warning, error, debug, ...).
 * @returns {boolean} True when the line belongs into the server-log channel.
 */
function allowsLevel(setting, lineLevel) {
    const settingRank = LEVEL_RANKS[normalizeLogLevel(setting)];
    if (settingRank === 0) return false;

    const key = (typeof lineLevel === 'string') ? lineLevel.trim().toLowerCase() : '';
    /* An unknown level is treated as information, so nothing is lost silently. */
    const lineRank = LINE_RANKS.hasOwnProperty(key) ? LINE_RANKS[key] : LINE_RANKS['info'];

    return lineRank <= settingRank;
}

/**
 * True when the channel is switched off. Used by the lifecycle markers (start line, reset marker), which are
 * not log lines and therefore ignore the filter of the lower levels.
 * @param {*} setting The `serverLogLevel` setting.
 * @returns {boolean} True when nothing may be posted.
 */
function isOff(setting) {
    return normalizeLogLevel(setting) === 'off';
}

module.exports = {
    LOG_LEVELS,
    DEFAULT_LOG_LEVEL,
    normalizeLogLevel,
    allowsLevel,
    isOff,
};
