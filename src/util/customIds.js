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
    Discord allows a custom id of 100 characters; a longer one makes @sapphire/shapeshift throw, and its message
    ("Invalid string length") says nothing about the cause. A relay server key is 42 characters
    (`relay-<uuid>`), so the JSON identifier of a device
    (`StorageMonitorContainerDelete{"serverId":"relay-…","entityId":"230296"}`) was 106 characters and the storage
    monitors of such a server could not be set up at all.

    The identifier is built with a separator instead: `|relay-<uuid>|230296` keeps every device button far below the
    limit. parse() still understands the JSON form, so messages that were posted by an older version keep working.
*/

const SEPARATOR = '|';

/* The longest custom id Discord accepts, enforced in discordButtons.getButton. */
const CUSTOM_ID_MAX_LENGTH = 100;

/* The identifier that is appended to the prefix of a button, for example `|relay-<uuid>|230296`. */
function identifier(parts) {
    return `${SEPARATOR}${(Array.isArray(parts) ? parts : [parts]).map((part) => `${part}`).join(SEPARATOR)}`;
}

/*
    The values of a custom id. `keys` names the parts in the order they were put in; an id of an older version is JSON
    and is still parsed. A missing part is null, so a caller can bail out instead of comparing undefined.
*/
function parse(customId, prefixes, keys) {
    const list = Array.isArray(prefixes) ? prefixes : [prefixes];
    let rest = `${customId === undefined || customId === null ? '' : customId}`;

    const prefix = list.find((candidate) => rest.startsWith(candidate));
    if (prefix) rest = rest.slice(prefix.length);

    if (rest.startsWith('{')) {
        try {
            return JSON.parse(rest);
        }
        catch (e) {
            /* Not valid JSON: fall through to the separator format, the id is broken either way. */
        }
    }

    const parts = rest.startsWith(SEPARATOR) ? rest.slice(SEPARATOR.length).split(SEPARATOR) : [];
    const result = {};

    for (const [index, key] of (Array.isArray(keys) ? keys : []).entries()) {
        const value = parts[index];
        result[key] = (value === undefined || value === '') ? null : value;
    }

    return result;
}

module.exports = {
    CUSTOM_ID_MAX_LENGTH,
    identifier,
    parse,
};
