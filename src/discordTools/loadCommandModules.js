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

const Fs = require('fs');
const Path = require('path');

/*
    Slash commands are discovered from src/commands at runtime instead of being listed explicitly.
    Keeping the discovery here means DiscordBot (dispatch) and RegisterSlashCommands (registration
    payload) always see the same set of modules.
*/
module.exports = function loadCommandModules() {
    const commandDirectory = Path.join(__dirname, '..', 'commands');

    return Fs.readdirSync(commandDirectory)
        .filter(file => file.endsWith('.js'))
        .map(file => require(Path.join(commandDirectory, file)));
};
