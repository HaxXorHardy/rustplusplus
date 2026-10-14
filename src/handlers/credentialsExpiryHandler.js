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

const Config = require('../../config');
const DiscordButtons = require('../discordTools/discordButtons.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordTools = require('../discordTools/discordTools.js');
const InstanceUtils = require('../util/instanceUtils.js');

const STATE_EXPIRED = 'expired';
const STATE_EXPIRING_SOON = 'expiringSoon';

module.exports = {
    handler: async function (client, firstTime = false) {
        const now = Math.floor(Date.now() / 1000);
        const warningSeconds = Config.general.credentialsExpiryWarningSeconds;

        for (const guildItem of client.guilds.cache) {
            await handleGuild(client, guildItem[0], now, warningSeconds);
        }
    },
};

/*
    Resolve the expiry state of the given credentials. Returns one of the STATE_*
    constants or null when no notification is due yet.
*/
function getExpiryState(expireDate, now, warningSeconds) {
    if (expireDate <= now) return STATE_EXPIRED;
    if ((expireDate - now) <= warningSeconds) return STATE_EXPIRING_SOON;
    return null;
}

async function handleGuild(client, guildId, now, warningSeconds) {
    let credentials = null;
    try {
        credentials = InstanceUtils.readCredentialsFile(guildId);
    }
    catch (e) {
        client.log(client.intlGet(null, 'warningCap'),
            client.intlGet(null, 'credentialsNotRegisteredForGuild', { id: guildId }));
        return;
    }

    let changed = false;

    for (const steamId of Object.keys(credentials)) {
        if (steamId === 'hoster') continue;

        const credential = credentials[steamId];
        if (!credential || !credential.expire_date) continue;

        const expireDate = Number(credential.expire_date);
        if (!Number.isFinite(expireDate)) continue;

        const state = getExpiryState(expireDate, now, warningSeconds);
        if (state === null) continue;

        /* Never notify the same user twice for the same credential state. */
        if (state === STATE_EXPIRED && credential.expireNotified) continue;
        if (state === STATE_EXPIRING_SOON && credential.expireWarned) continue;

        const expired = state === STATE_EXPIRED;
        const user = await DiscordTools.getUserById(guildId, credential.discord_user_id);
        if (!user) {
            client.log(client.intlGet(null, 'warningCap'),
                client.intlGet(guildId, 'credentialsExpiryUserNotFound', {
                    discordUserId: credential.discord_user_id,
                    steamId: steamId
                }));
            continue;
        }

        await client.messageSend(user, {
            embeds: [DiscordEmbeds.getCredentialsExpiryEmbed(guildId, steamId, expireDate, expired)],
            components: [DiscordButtons.getCredentialsExpiryButton(guildId)]
        });

        if (expired) {
            credential.expireNotified = true;
        }
        else {
            credential.expireWarned = true;
        }
        changed = true;

        client.log(client.intlGet(null, 'infoCap'),
            client.intlGet(guildId, expired ?
                'credentialsExpiredNotified' : 'credentialsExpiringSoonNotified', {
                    discordUserId: credential.discord_user_id,
                    steamId: steamId
                }));
    }

    if (changed) {
        InstanceUtils.writeCredentialsFile(guildId, credentials);
    }
}
