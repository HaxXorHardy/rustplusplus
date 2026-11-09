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

const DiscordMessages = require('./discordMessages.js');

/*
    Posts the message of every server that has none in the servers channel.

    A server is adopted while the bot runs when it is paired in-game (see util/rustplusHistory.js). That path has no
    Discord message of its own: the servers channel only listed what was posted at startup, on a login or on a connect,
    so a server that was paired while the bot was running never appeared in the list. The startup and the pairing
    refresh both run this, so the list heals itself instead of waiting for a restart.
*/

/* The address or the pairing id the embed reads, without either of them there is nothing to show. */
function needsServerMessage(server) {
    if (!server || server.messageId) return false;

    return Boolean(server.guid || (server.serverIp && server.appPort));
}

async function postMissingServerMessages(client, guildId) {
    const instance = client.getInstance(guildId);
    const posted = [];

    for (const serverId in (instance.serverList || {})) {
        if (!needsServerMessage(instance.serverList[serverId])) continue;

        try {
            await DiscordMessages.sendServerMessage(guildId, serverId);
            posted.push(serverId);
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `Could not post the server message of ${serverId}: ${e && e.message ? e.message : e}`, 'warning');
        }
    }

    return posted;
}

module.exports = {
    needsServerMessage: needsServerMessage,
    postMissingServerMessages: postMissingServerMessages,
};
