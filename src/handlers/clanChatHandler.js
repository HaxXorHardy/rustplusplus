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

const Clan = require('../structures/Clan.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const { CHANNELS, getConfiguredChannel } = require('../util/inGameChat.js');
const { isResponseFailure, describeResponse } = require('../util/responseUtils.js');

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
        const response = await rustplus.getClanInfoAsync();
        rustplus.clanInfo = Clan.fromResponse(response);

        if (getConfiguredChannel(rustplus.generalSettings) !== CHANNELS.CLAN) {
            return rustplus.clanInfo;
        }

        if (isResponseFailure(response)) {
            rustplus.log(client.intlGet(rustplus.guildId, 'errorCap'),
                'The in-game chat channel is set to the clan chat, but the clan info could not be read: ' +
                `${describeResponse(response)}. No in-game messages are written until the clan is known.`,
                'warn');
        }
        else if (rustplus.clanInfo === null) {
            rustplus.log(client.intlGet(rustplus.guildId, 'errorCap'),
                'The in-game chat channel is set to the clan chat, but the paired steam account is not in a clan.',
                'warn');
        }
        else {
            /* The clan is known, in-game messages can be written to the clan chat again. */
            rustplus.inGameChatChannelUnavailable = false;

            rustplus.log(client.intlGet(rustplus.guildId, 'infoCap'),
                `In-game messages are written to the clan chat (clan "${rustplus.clanInfo.name}", ` +
                `${rustplus.clanInfo.memberCount}/${rustplus.clanInfo.maxMemberCount} members).`);
        }

        return rustplus.clanInfo;
    },
};

