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

/*
    Warns the Discord user of a steam account when the stored Rust+ login (credentials/rustplusAuth/<steamId>.json) is
    about to expire or has expired. The account token lives ~14 days. A stored Steam refresh token lets the bot renew it
    on its own, so only an account without one (or an expired token) needs the user.
*/

const Config = require('../../config');
const DiscordButtons = require('../discordTools/discordButtons.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const CredentialOwner = require('../util/credentialOwner.js');
const InstanceUtils = require('../util/instanceUtils.js');
const RustPlusAuth = require('../util/rustplusAuth.js');

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
    Resolve the expiry state of the given token expiry. Returns one of the STATE_* constants or null when no
    notification is due yet.
*/
function getExpiryState(expireDate, now, warningSeconds) {
    if (expireDate <= now) return STATE_EXPIRED;
    if ((expireDate - now) <= warningSeconds) return STATE_EXPIRING_SOON;
    return null;
}

/* The Discord user that logged in with this steam account, null when the guild does not know it. */
async function getOwner(guildId, steamId) {
    return await CredentialOwner.getOwner(guildId, steamId);
}

/* Every state is announced once per token: a renewed token carries a new expiry and is announced again. */
function alreadyNotified(client, key) {
    if (!client.credentialsExpiryNotified) client.credentialsExpiryNotified = new Object();

    return client.credentialsExpiryNotified[key] === true;
}

function markNotified(client, key) {
    if (!client.credentialsExpiryNotified) client.credentialsExpiryNotified = new Object();

    client.credentialsExpiryNotified[key] = true;
}

/* The steam accounts registered in the guild (the keys of its credentials file, without the hoster). */
function getGuildSteamIds(guildId) {
    let credentials = null;
    try {
        credentials = InstanceUtils.readCredentialsFile(guildId);
    }
    catch (e) {
        return [];
    }

    if (!credentials || typeof credentials !== 'object') return [];
    return Object.keys(credentials).filter((key) => key !== 'hoster');
}

async function handleGuild(client, guildId, now, warningSeconds) {
    /*
        Only the logins of accounts this guild lists are checked, the token file is the only source of the token state.
        The other guilds' accounts have no owner here and would only log "owner not found" every hour.
    */
    const guildSteamIds = getGuildSteamIds(guildId);

    for (const steamId of RustPlusAuth.listSteamIds().filter((id) => guildSteamIds.includes(`${id}`))) {
        const auth = RustPlusAuth.readAuth(steamId);
        if (auth === null) continue;

        const expiresAt = RustPlusAuth.getTokenExpiry(auth);
        if (expiresAt === null) continue;

        const state = getExpiryState(expiresAt, now, warningSeconds);
        if (state === null) continue;

        /* An account that can renew itself needs no user, the hourly check of util/tokenRecovery.js renews it. */
        if (state === STATE_EXPIRING_SOON && auth.steamRefreshToken) continue;
        if (alreadyNotified(client, `${steamId}:${state}:${expiresAt}`)) continue;

        const user = await getOwner(guildId, steamId);
        if (!user) {
            client.log(client.intlGet(null, 'warningCap'),
                client.intlGet(guildId, 'credentialsExpiryUserNotFound', {
                    discordUserId: '-',
                    steamId: steamId
                }));
            continue;
        }

        const expired = state === STATE_EXPIRED;

        await client.messageSend(user, {
            embeds: [DiscordEmbeds.getCredentialsExpiryEmbed(guildId, steamId, expiresAt, expired)],
            components: [DiscordButtons.getCredentialsExpiryButton(guildId)]
        });

        markNotified(client, `${steamId}:${state}:${expiresAt}`);

        client.log(client.intlGet(null, 'infoCap'),
            `${expired ? 'The Rust+ login has expired' : 'The Rust+ login expires soon'}, the owner of ${steamId} ` +
            'was notified.');
    }
}
