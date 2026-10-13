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

const DiscordMessages = require('../discordTools/discordMessages.js');
const { CHANNELS, getConfiguredChannel } = require('../util/inGameChat.js');
const { isResponseFailure } = require('../util/responseUtils.js');

module.exports = {
    /*
        An incoming clan chat message (AppBroadcast.clanMessage) is mirrored into the Discord clanchat channel.
        In-Game commands are read from the team chat and the clan chat, see rustplusEvents/message.js.
    */
    handler: async function (rustplus, client, message) {
        if (!message) return;

        /* Logged (debug) so it is visible whether the server pushes clan chat messages at all. */
        rustplus.log(client.intlGet(rustplus.guildId, 'infoCap'),
            `Clan chat: ${message.name} (${message.steamId}): ${message.message}`, 'debug');

        await DiscordMessages.sendClanChatMessage(rustplus.guildId, message);
    },

    /*
        Fetches the clan of the paired steam account from the game server and caches it on the rustplus instance.
        Everything clan chat related depends on it: whether the bot may write into the clan chat and whether the
        clan chat can be used at all. Called on every connect and whenever the clan membership changes.
    */
    updateClanInfo: async function (rustplus, client) {
        rustplus.clanInfo = parseClanInfo(await rustplus.getClanInfoAsync());

        if (getConfiguredChannel(rustplus.generalSettings) !== CHANNELS.CLAN) {
            return rustplus.clanInfo;
        }

        if (rustplus.clanInfo === null) {
            rustplus.log(client.intlGet(rustplus.guildId, 'errorCap'),
                'The in-game chat channel is set to the clan chat, but the paired steam account is not in a clan.',
                'warn');
        }
        else {
            rustplus.log(client.intlGet(rustplus.guildId, 'infoCap'),
                `In-game messages are written to the clan chat (clan "${rustplus.clanInfo.name}", ` +
                `${rustplus.clanInfo.memberCount}/${rustplus.clanInfo.maxMemberCount} members).`);
        }

        return rustplus.clanInfo;
    },
};

/* Parses the clan of a getClanInfo response. AppResponse.clanInfo is an AppClanInfo wrapper, the data is nested. */
function parseClanInfo(response) {
    if (isResponseFailure(response) || !response.clanInfo) return null;

    const clanInfo = response.clanInfo.clanInfo;
    if (!clanInfo) return null;

    return {
        clanId: clanInfo.clanId,
        name: clanInfo.name,
        memberCount: Array.isArray(clanInfo.members) ? clanInfo.members.length : 0,
        maxMemberCount: clanInfo.maxMemberCount
    };
}
