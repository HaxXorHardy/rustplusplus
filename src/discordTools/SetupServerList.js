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
const DiscordTools = require('./discordTools.js');

/*
    Posting the server messages of a guild.

    A server is adopted while the bot runs when it is paired in-game (see util/rustplusHistory.js). That path has no
    Discord message of its own: the servers channel only listed what was posted at startup, on a login or on a connect,
    so a server that was paired while the bot was running never appeared in the list. The startup and the pairing
    refresh both run postMissingServerMessages, so the list heals itself instead of waiting for a restart.

    /reset (commands/reset.js) rebuilds the channel instead: postServerMessages empties it and posts every server again.
    Both entry points live here, a caller must not call the module itself anymore.
*/

/* The address or the pairing id the embed reads, without either of them there is nothing to show. */
function needsServerMessage(server) {
    if (!server || server.messageId) return false;

    return Boolean(server.guid || (server.serverIp && server.appPort));
}

/* One message; the client stores the id, so a message that is gone is posted again (see discordMessages.sendMessage). */
async function postServerMessage(client, guildId, serverId) {
    try {
        await DiscordMessages.sendServerMessage(guildId, serverId);
        return true;
    }
    catch (e) {
        client.log(client.intlGet(null, 'warningCap'),
            `Could not post the server message of ${serverId}: ${e && e.message ? e.message : e}`, 'warn');
        return false;
    }
}

async function postMissingServerMessages(client, guildId) {
    const instance = client.getInstance(guildId);
    const posted = [];

    for (const serverId in (instance.serverList || {})) {
        if (!needsServerMessage(instance.serverList[serverId])) continue;

        if (await postServerMessage(client, guildId, serverId)) posted.push(serverId);
    }

    return posted;
}

/*
    Empties the servers channel and posts the message of every server, the result a reset of the channel needs. The
    stored ids are dead after the channel was emptied, they are not used as a filter here: sendServerMessage fetches a
    missing message, posts a new one and stores its id.
*/
async function postServerMessages(client, guildId) {
    const instance = client.getInstance(guildId);

    await DiscordTools.clearTextChannel(guildId, instance.channelId.servers, 100);

    let posted = 0;

    for (const serverId in (instance.serverList || {})) {
        if (await postServerMessage(client, guildId, serverId)) posted += 1;
    }

    return posted;
}

module.exports = {
    needsServerMessage: needsServerMessage,
    postServerMessages: postServerMessages,
    postMissingServerMessages: postMissingServerMessages,
};
