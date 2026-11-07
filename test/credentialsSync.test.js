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

const Assert = require('node:assert');
const Fs = require('node:fs');
const Path = require('node:path');
const Test = require('node:test');

const DiscordBot = require('../src/structures/DiscordBot.js');
const InstanceUtils = require('../src/util/instanceUtils.js');

/* The guild id is only used as the file name of the credentials file. */
const GUILD_ID = '100000000000000001';
const GUILD_NAME = 'Test Guild';
const MEMBER_ID = '100000000000000002';
const STEAM_ID = '76561198000000010';
const STEAM_ID_LITE = '76561198000000011';

function credentialsPath() {
    return Path.join(__dirname, '..', 'credentials', `${GUILD_ID}.json`);
}

function writeCredentials(credentials) {
    InstanceUtils.writeCredentialsFile(GUILD_ID, credentials);
}

function readCredentials() {
    return JSON.parse(Fs.readFileSync(credentialsPath(), 'utf8'));
}

function fakeBot() {
    return {
        warnings: [],
        log(title, text) {
            this.warnings.push(text);
        },
        intlGet: () => 'WARNING',
    };
}

function fakeGuild(memberIds) {
    const members = new Map();
    for (const id of memberIds) members.set(id, { id: id });

    return { id: GUILD_ID, name: GUILD_NAME, members: { fetch: async () => members } };
}

Test.describe('DiscordBot.syncCredentialsWithUsers', () => {
    Test.afterEach(() => {
        if (Fs.existsSync(credentialsPath())) Fs.unlinkSync(credentialsPath());
    });

    Test.it('keeps the credentials of guild members', async () => {
        writeCredentials({ hoster: STEAM_ID, [STEAM_ID]: { discord_user_id: MEMBER_ID } });

        const bot = fakeBot();
        await DiscordBot.prototype.syncCredentialsWithUsers.call(bot, fakeGuild([MEMBER_ID]));

        Assert.deepStrictEqual(readCredentials(), { hoster: STEAM_ID, [STEAM_ID]: { discord_user_id: MEMBER_ID } });
        Assert.strictEqual(bot.warnings.length, 0);
    });

    Test.it('removes credentials of a user that is not in the guild anymore', async () => {
        writeCredentials({ hoster: STEAM_ID, [STEAM_ID]: { discord_user_id: MEMBER_ID } });

        const bot = fakeBot();
        await DiscordBot.prototype.syncCredentialsWithUsers.call(bot, fakeGuild(['100000000000000099']));

        const credentials = readCredentials();
        Assert.strictEqual(STEAM_ID in credentials, false);
        Assert.strictEqual(credentials.hoster, null);
        Assert.strictEqual(bot.warnings.length, 1);
        Assert.match(bot.warnings[0], new RegExp(`stored credentials of ${STEAM_ID}`));
    });

    Test.it('removes credentials without an owner', async () => {
        writeCredentials({ hoster: null, [STEAM_ID_LITE]: { gcm: { android_id: 'a', security_token: 'b' } } });

        const bot = fakeBot();
        await DiscordBot.prototype.syncCredentialsWithUsers.call(bot, fakeGuild([MEMBER_ID]));

        Assert.strictEqual(STEAM_ID_LITE in readCredentials(), false);
        Assert.strictEqual(bot.warnings.length, 1);
        Assert.match(bot.warnings[0], /have no Discord user/);
    });
});
