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
    A login that cannot renew itself (the pasted token has no Steam refresh token) has to reach its owner by DM before
    and after the token expired; a login with a refresh token is renewed by the bot and needs no reminder while it is
    still valid.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const CredentialsExpiryHandler = require('../src/handlers/credentialsExpiryHandler.js');
const DiscordTools = require('../src/discordTools/discordTools.js');
const InstanceUtils = require('../src/util/instanceUtils.js');
const RustPlusAuth = require('../src/util/rustplusAuth.js');

const GUILD_ID = '1474484924093432003';
const USER_ID = '1474484924093432999';
const STEAM_ID = '76561198190865617';

const DAY = 24 * 60 * 60;

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

/* Stubs the stored login, its owner and the Discord user; returns the captured direct messages. */
function stubAuth(t, auth) {
    const messages = [];
    const logged = [];

    const original = {
        listSteamIds: RustPlusAuth.listSteamIds,
        readAuth: RustPlusAuth.readAuth,
        readCredentialsFile: InstanceUtils.readCredentialsFile,
        getUserById: DiscordTools.getUserById,
    };

    RustPlusAuth.listSteamIds = () => [STEAM_ID];
    RustPlusAuth.readAuth = (steamId) => (`${steamId}` === STEAM_ID ? auth : null);
    InstanceUtils.readCredentialsFile = () => ({
        hoster: STEAM_ID,
        [STEAM_ID]: { discord_user_id: USER_ID, login: 'rustplus', updated_at: new Date().toISOString() },
    });
    DiscordTools.getUserById = async () => ({ id: USER_ID });

    t.after(() => {
        RustPlusAuth.listSteamIds = original.listSteamIds;
        RustPlusAuth.readAuth = original.readAuth;
        InstanceUtils.readCredentialsFile = original.readCredentialsFile;
        DiscordTools.getUserById = original.getUserById;
    });

    const client = {
        guilds: { cache: new Map([[GUILD_ID, {}]]) },
        intlGet: (guildId, key, variables = {}) => key,
        log: (title, text, level) => logged.push({ title, text, level }),
        messageSend: async (user, content) => {
            messages.push({ userId: user.id, content });
            return content;
        },
    };

    /* The embeds read the translations from the registry. */
    Client.client = client;
    t.after(() => {
        Client.client = null;
    });

    return { client, messages, logged };
}

Test.describe('CredentialsExpiryHandler', () => {
    Test.it('reminds the owner of a login that cannot renew itself', async (t) => {
        const { client, messages } = stubAuth(t, { token: 'abc', tokenExpiresAt: nowSeconds() + DAY });

        await CredentialsExpiryHandler.handler(client, false);

        Assert.strictEqual(messages.length, 1);
        Assert.strictEqual(messages[0].userId, USER_ID);
        Assert.strictEqual(messages[0].content.embeds[0].toJSON().title, 'credentialsExpiringSoonTitle');
    });

    Test.it('does not remind a login that renews itself', async (t) => {
        const { client, messages } = stubAuth(t, {
            token: 'abc', tokenExpiresAt: nowSeconds() + DAY, steamRefreshToken: 'refresh-token'
        });

        await CredentialsExpiryHandler.handler(client, false);

        Assert.deepStrictEqual(messages, []);
    });

    Test.it('reports an expired token of a login that renews itself', async (t) => {
        const { client, messages } = stubAuth(t, {
            token: 'abc', tokenExpiresAt: nowSeconds() - 60, steamRefreshToken: 'refresh-token'
        });

        await CredentialsExpiryHandler.handler(client, false);

        Assert.strictEqual(messages.length, 1);
        Assert.strictEqual(messages[0].content.embeds[0].toJSON().title, 'credentialsExpiredTitle');
    });

    Test.it('reports every state only once', async (t) => {
        const { client, messages } = stubAuth(t, { token: 'abc', tokenExpiresAt: nowSeconds() + DAY });

        await CredentialsExpiryHandler.handler(client, false);
        await CredentialsExpiryHandler.handler(client, false);

        Assert.strictEqual(messages.length, 1);
    });

    Test.it('stays quiet while the token is valid for a long time', async (t) => {
        const { client, messages } = stubAuth(t, { token: 'abc', tokenExpiresAt: nowSeconds() + (30 * DAY) });

        await CredentialsExpiryHandler.handler(client, false);

        Assert.deepStrictEqual(messages, []);
    });

    Test.it('logs a login without a resolvable owner instead of failing', async (t) => {
        const { client, messages, logged } = stubAuth(t, { token: 'abc', tokenExpiresAt: nowSeconds() + DAY });
        DiscordTools.getUserById = async () => null;

        await Assert.doesNotReject(CredentialsExpiryHandler.handler(client, false));

        Assert.deepStrictEqual(messages, []);
        Assert.ok(logged.some((entry) => entry.text === 'credentialsExpiryUserNotFound' ||
            String(entry.text).includes('credentialsExpiryUserNotFound')));
    });
});
