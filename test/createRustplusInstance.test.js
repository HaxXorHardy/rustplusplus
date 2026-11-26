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

/*
    The real RustPlus constructor opens the runtime storage. DiscordBot only needs a class it can build, so a stand-in
    is put into the module cache before DiscordBot is loaded (every test file runs in its own process).
*/
const rustPlusPath = require.resolve('../src/structures/RustPlus.js');

class FakeRustPlus {
    constructor(guildId, serverIp, appPort) {
        this.guildId = guildId;
        this.serverId = `${serverIp}-${appPort}`;
    }

    build() { this.built = true; }
}

require.cache[rustPlusPath] = { id: rustPlusPath, filename: rustPlusPath, loaded: true, exports: FakeRustPlus };

const DiscordBot = require('../src/structures/DiscordBot.js');

function fakeBot() {
    return {
        rustplusInstances: {},
        activeRustplusInstances: {},
        rustplusReconnectTimers: {},
        rustplusReconnecting: {},
        rustplusConnectFailures: {},
        log: () => undefined,
        intlGet: (guildId, key) => key,
    };
}

Test.describe('DiscordBot.createRustplusInstance', () => {
    /* A pending reconnect of the old server fired after the history activated another one and killed it. */
    Test.it('cancels a pending reconnect of the connection it replaces', () => {
        const bot = fakeBot();
        let fired = false;

        bot.rustplusReconnectTimers.g = setTimeout(() => { fired = true; }, 5);

        const rustplus = DiscordBot.prototype.createRustplusInstance.call(bot, 'g', '1.2.3.4', 28082, '7656', 1);

        Assert.strictEqual(bot.rustplusReconnectTimers.g, null);
        Assert.strictEqual(bot.rustplusInstances.g, rustplus);
        Assert.strictEqual(rustplus.built, true);

        return new Promise((resolve) => setTimeout(() => {
            Assert.strictEqual(fired, false);
            resolve();
        }, 20));
    });
});
