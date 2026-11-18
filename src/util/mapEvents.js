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
    The map events of the Rust+ API: cargo ship, patrol helicopter, chinook, oil rig crates, vending machines (and the
    deep sea derived from them), traveling vendor. Facepunch stopped sending these map markers (live 2026-11-18: players
    only). The code stays for the day they come back, but it does not run while RPP_MAP_EVENTS_ENABLED is off (default):
    no tracking of these markers in the poll, no vending machine subscriptions, no event section in the information
    channel, no custom timers button, the in-game event commands and /market do nothing.
*/

const Config = require('../../config');

/* In-game commands that only answer from the event markers (exact or with arguments). */
const EXACT_COMMANDS = ['commandSyntaxCargo', 'commandSyntaxChinook', 'commandSyntaxHeli', 'commandSyntaxLarge',
    'commandSyntaxSmall', 'commandSyntaxTravelingVendor', 'commandSyntaxDeepSea'];
const PREFIX_COMMANDS = ['commandSyntaxEvents'];
const ARGUMENT_COMMANDS = ['commandSyntaxMarket'];

/* Slash commands that only work with the event markers. */
const SLASH_COMMANDS = ['market'];

function enabled() {
    return Config.general.mapEventsEnabled === true;
}

/* Is the (lower case) in-game command one of the event commands, in English or the guild language? */
function isEventCommand(client, guildId, prefix, commandLowerCase) {
    const syntaxes = (key) => [client.intlGet('en', key), client.intlGet(guildId, key)]
        .map((syntax) => `${prefix}${syntax}`.toLowerCase());

    for (const key of EXACT_COMMANDS) {
        if (syntaxes(key).includes(commandLowerCase)) return true;
    }
    for (const key of PREFIX_COMMANDS) {
        if (syntaxes(key).some((syntax) => commandLowerCase.startsWith(syntax))) return true;
    }
    for (const key of ARGUMENT_COMMANDS) {
        if (syntaxes(key).some((syntax) => commandLowerCase.startsWith(`${syntax} `))) return true;
    }

    return false;
}

/* The slash command modules to register: without the event markers /market is left out. */
function filterSlashCommands(modules) {
    if (enabled()) return modules;

    return modules.filter((module) => !SLASH_COMMANDS.includes(module.name));
}

module.exports = {
    enabled: enabled,
    isEventCommand: isEventCommand,
    filterSlashCommands: filterSlashCommands,
};
