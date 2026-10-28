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
const Test = require('node:test');

const Config = require('../config');
const DiscordBot = require('../src/structures/DiscordBot.js');

/* These tests exercise the authorisation predicates without constructing a bot: the methods only read
   Config.discord.needAdminPrivileges and the interaction they are given. */
function fakeBot(isAdministrator, isBlacklisted) {
    return {
        isAdministrator: () => isAdministrator,
        isBlacklisted: () => isBlacklisted,
    };
}

Test.describe('DiscordBot authorisation helpers', () => {
    Test.it('hasAdminPrivileges follows the configured policy', () => {
        const original = Config.discord.needAdminPrivileges;

        try {
            Config.discord.needAdminPrivileges = true;
            Assert.strictEqual(
                DiscordBot.prototype.hasAdminPrivileges.call(fakeBot(true, false), {}), true);
            Assert.strictEqual(
                DiscordBot.prototype.hasAdminPrivileges.call(fakeBot(false, false), {}), false);

            Config.discord.needAdminPrivileges = false;
            Assert.strictEqual(
                DiscordBot.prototype.hasAdminPrivileges.call(fakeBot(false, false), {}), true);
        }
        finally {
            Config.discord.needAdminPrivileges = original;
        }
    });

    Test.it('isAllowedUser rejects blacklisted non-admins only', () => {
        Assert.strictEqual(DiscordBot.prototype.isAllowedUser.call(fakeBot(false, true), {}), false);
        Assert.strictEqual(DiscordBot.prototype.isAllowedUser.call(fakeBot(true, true), {}), true);
        Assert.strictEqual(DiscordBot.prototype.isAllowedUser.call(fakeBot(false, false), {}), true);
    });
});
