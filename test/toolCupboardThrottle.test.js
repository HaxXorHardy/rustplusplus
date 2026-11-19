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

const Constants = require('../src/util/constants.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const Message = require('../src/rustplusEvents/message.js');
const StorageAlerts = require('../src/util/storageAlerts.js');
const StorageMonitorHandler = require('../src/handlers/storageMonitorHandler.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Issue #8: a tool cupboard pushes a change every few seconds; each push read it and edited its message. */
Test.describe('tool cupboard pushes', () => {
    const originals = {
        now: DiscordMessages.sendStorageMonitorMessageNow,
        interval: DiscordMessages.storageMonitorEditIntervalMs,
        check: StorageAlerts.check,
        warnUpkeep: StorageMonitorHandler.warnUpkeep,
        delay: Message.toolCupboardReadDelayMs,
    };

    Test.afterEach(() => {
        DiscordMessages.sendStorageMonitorMessageNow = originals.now;
        DiscordMessages.storageMonitorEditIntervalMs = originals.interval;
        StorageAlerts.check = originals.check;
        StorageMonitorHandler.warnUpkeep = originals.warnUpkeep;
        Message.toolCupboardReadDelayMs = originals.delay;
        DiscordMessages.resetStorageMonitorUpdates();
        Message.resetToolCupboardUpdates();
    });

    function setup() {
        const counts = { reads: 0, edits: 0, alerts: 0, upkeep: [] };
        let expiry = 1000;

        const instance = {
            serverList: {
                s: { storageMonitors: { 7: { type: 'toolCupboard', decaying: false, inGame: false, name: 'TC' } } }
            }
        };
        const client = {
            getInstance: () => instance,
            setInstance: () => undefined,
            intlGet: (guildId, key) => key,
        };
        const rustplus = {
            guildId: 'g',
            serverId: 's',
            isOperational: true,
            storageMonitors: {},
            log: () => undefined,
            isResponseValid: async () => true,
            getEntityInfoAsync: async () => {
                counts.reads++;
                return { entityInfo: { payload: { items: [], protectionExpiry: expiry, capacity: 24 } } };
            },
        };

        DiscordMessages.storageMonitorEditIntervalMs = () => 60;
        Message.toolCupboardReadDelayMs = 10;
        DiscordMessages.sendStorageMonitorMessageNow = async () => { counts.edits++; };
        StorageAlerts.check = async () => { counts.alerts++; };
        StorageMonitorHandler.warnUpkeep = (r, c, serverId, entityId, value) => counts.upkeep.push(value);

        const push = () => Message.messageBroadcastEntityChangedStorageMonitor(rustplus, client, {
            broadcast: {
                entityChanged: {
                    entityId: 7,
                    payload: { value: false, capacity: Constants.STORAGE_MONITOR_TOOL_CUPBOARD_CAPACITY, items: [] }
                }
            }
        });

        return { counts, push, instance, setExpiry: (value) => { expiry = value; } };
    }

    Test.it('reads and edits once per pause, with the latest state', async () => {
        const { counts, push, setExpiry } = setup();

        /* The first push: read after the short delay, one edit. */
        await push();
        await sleep(30);
        Assert.deepStrictEqual([counts.reads, counts.edits, counts.alerts], [1, 1, 1]);

        /* Ten pushes in the pause: nothing now, one read after it, with what the server says then. */
        for (let i = 0; i < 10; i++) await push();
        setExpiry(2000);
        Assert.strictEqual(counts.reads, 1);

        await sleep(100);
        Assert.deepStrictEqual([counts.reads, counts.edits, counts.alerts], [2, 2, 2]);
        Assert.deepStrictEqual(counts.upkeep, [1000, 2000]);
    });

    Test.it('skips the read of a monitor removed before it', async () => {
        const { counts, push, instance } = setup();

        await push();
        delete instance.serverList.s.storageMonitors[7];
        await sleep(30);
        Assert.deepStrictEqual([counts.reads, counts.edits], [0, 0]);
    });
});
