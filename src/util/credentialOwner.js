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
    The Discord user that stored the Rust+ login of a steam account. Shared by the credentials expiry warning and the
    token recovery: both have to reach the same person when the login needs attention.
*/

const DiscordTools = require('../discordTools/discordTools.js');
const InstanceUtils = require('./instanceUtils.js');

/* The Discord user that logged in with this steam account, null when the guild does not know it. */
async function getOwner(guildId, steamId) {
    let credentials = null;

    try {
        credentials = InstanceUtils.readCredentialsFile(guildId);
    }
    catch (e) {
        return null;
    }

    const owner = (credentials && credentials[steamId]) ? credentials[steamId].discord_user_id : null;
    if (!owner) return null;

    try {
        return await DiscordTools.getUserById(guildId, owner);
    }
    catch (e) {
        return null;
    }
}

module.exports = {
    getOwner: getOwner,
};
