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

const UpkeepWarning = require('../src/util/upkeepWarning.js');

const HOUR = 60 * 60;
const now = 1800000000;

Test.describe('upkeep early warning', () => {
    Test.it('warns once when the upkeep left drops below the threshold', () => {
        const tc = { upkeepWarned: false };

        Assert.strictEqual(UpkeepWarning.check(tc, now + 10 * HOUR, now, 6), null, 'plenty left');
        Assert.strictEqual(UpkeepWarning.check(tc, now + 5 * HOUR, now, 6), 'warn');

        tc.upkeepWarned = true;
        Assert.strictEqual(UpkeepWarning.check(tc, now + 4 * HOUR, now, 6), null, 'not again');
    });

    Test.it('warns again only after the cupboard was filled up past the threshold and a margin', () => {
        const tc = { upkeepWarned: true };

        Assert.strictEqual(UpkeepWarning.check(tc, now + 6 * HOUR + 30 * 60, now, 6), null, 'within the margin');
        Assert.strictEqual(UpkeepWarning.check(tc, now + 8 * HOUR, now, 6), 'rearm');
    });

    Test.it('leaves a decaying cupboard to its own message, and is off with 0 hours', () => {
        Assert.strictEqual(UpkeepWarning.check({ upkeepWarned: false }, 0, now, 6), null);
        Assert.strictEqual(UpkeepWarning.check({ upkeepWarned: false }, now + HOUR, now, 0), null);
    });
});

/* The cycle reads the monitors at once after a connect and then every 5 minutes; the warning reaches Discord and the chat. */
Test.describe('storage monitor cycle and upkeep warning', () => {
    const Registry = require('../src/structures/clientRegistry.js');
    const DiscordMessages = require('../src/discordTools/discordMessages.js');
    const StorageMonitorHandler = require('../src/handlers/storageMonitorHandler.js');

    Test.it('reads the monitors in the first cycle, then every 5th', async () => {
        const instance = { serverList: { s: { storageMonitors: {} } } };
        const client = { getInstance: () => instance, setInstance: () => undefined };
        const rustplus = { guildId: 'g', serverId: 's', storageMonitorIntervalCounter: null };

        const counters = [];
        for (let i = 0; i < 7; i++) {
            await StorageMonitorHandler.handler(rustplus, client);
            counters.push(rustplus.storageMonitorIntervalCounter);
        }
        Assert.deepStrictEqual(counters, [0, 1, 2, 3, 4, 0, 1], '0 = the monitors are read');
    });

    Test.it('warns in Discord and in game once, below the guild setting', (t) => {
        const monitor = { name: 'TC', inGame: true };
        const instance = { generalSettings: { upkeepWarningHours: 2 }, serverList: { s: { storageMonitors: { e: monitor } } } };
        const client = {
            getInstance: () => instance,
            setInstance: () => undefined,
            intlGet: (guildId, key, args) => `${key} ${args ? args.device : ''}`,
        };
        const discord = [];
        const chat = [];
        const rustplus = { guildId: 'g', sendInGameMessage: (text) => chat.push(text) };

        const originalClient = Registry.client;
        const originalSend = DiscordMessages.sendUpkeepWarningMessage;
        Registry.client = client;
        DiscordMessages.sendUpkeepWarningMessage = async (...args) => { discord.push(args); };
        t.after(() => {
            Registry.client = originalClient;
            DiscordMessages.sendUpkeepWarningMessage = originalSend;
        });

        const nowSeconds = Math.floor(Date.now() / 1000);
        StorageMonitorHandler.warnUpkeep(rustplus, client, 's', 'e', nowSeconds + 3 * HOUR);
        Assert.strictEqual(discord.length, 0, '3 h left: above 2 h');

        StorageMonitorHandler.warnUpkeep(rustplus, client, 's', 'e', nowSeconds + HOUR + 53 * 60);
        StorageMonitorHandler.warnUpkeep(rustplus, client, 's', 'e', nowSeconds + HOUR + 50 * 60);
        Assert.strictEqual(discord.length, 1, '1h53m left: warned once');
        Assert.deepStrictEqual(chat, ['upkeepRunsOut TC']);
        Assert.strictEqual(monitor.upkeepWarned, true);
    });
});
