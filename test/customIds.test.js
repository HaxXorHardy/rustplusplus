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

const Client = require('../src/structures/clientRegistry.js');
const CustomIds = require('../src/util/customIds.js');
const DiscordButtons = require('../src/discordTools/discordButtons.js');

const RELAY_SERVER_ID = 'relay-060300ac-5528-4f7a-b1bd-c8cf3d7aaf9b';
const ENTITY_ID = '230296';

Test.describe('CustomIds', () => {
    Test.it('builds and parses a separator identifier', () => {
        const identifier = CustomIds.identifier([RELAY_SERVER_ID, ENTITY_ID]);

        Assert.strictEqual(identifier, `|${RELAY_SERVER_ID}|${ENTITY_ID}`);
        Assert.deepStrictEqual(
            CustomIds.parse(`StorageMonitorEdit${identifier}`, 'StorageMonitorEdit', ['serverId', 'entityId']),
            { serverId: RELAY_SERVER_ID, entityId: ENTITY_ID });
    });

    /* Messages that were posted by an older version carry the JSON identifier and must keep working. */
    Test.it('still parses the JSON identifier of an older version', () => {
        const customId = 'StorageMonitorEdit' +
            JSON.stringify({ serverId: RELAY_SERVER_ID, entityId: ENTITY_ID });

        Assert.deepStrictEqual(
            CustomIds.parse(customId, 'StorageMonitorEdit', ['serverId', 'entityId']),
            { serverId: RELAY_SERVER_ID, entityId: ENTITY_ID });
    });

    Test.it('accepts several prefixes and reports missing parts as null', () => {
        const identifier = CustomIds.identifier([RELAY_SERVER_ID, ENTITY_ID]);

        Assert.deepStrictEqual(
            CustomIds.parse(`SmartSwitchOff${identifier}`, ['SmartSwitchOn', 'SmartSwitchOff'],
                ['serverId', 'entityId']),
            { serverId: RELAY_SERVER_ID, entityId: ENTITY_ID });

        Assert.deepStrictEqual(CustomIds.parse('GroupEdit', 'GroupEdit', ['serverId', 'entityId']),
            { serverId: null, entityId: null });
    });
});

/*
    Discord allows 100 characters per custom id. The JSON identifier of a device button was 106 characters for a relay
    server key, which made @sapphire/shapeshift throw "Invalid string length" and left the storage monitors of that
    server without messages.
*/
Test.describe('Custom ids of the storage monitor buttons', () => {
    Test.beforeEach(() => {
        Client.client = {
            intlGet: (guildId, key) => key,
            getInstance: () => ({
                serverList: {
                    [RELAY_SERVER_ID]: {
                        storageMonitors: { [ENTITY_ID]: { everyone: false, inGame: true } },
                    },
                },
            }),
        };
    });

    Test.afterEach(() => {
        Client.client = null;
    });

    function customIdsOf(row) {
        return row.components.map((component) => `${component.data.custom_id}`);
    }

    Test.it('stay below the limit of Discord for a relay server key', () => {
        const rows = [
            DiscordButtons.getStorageMonitorToolCupboardButtons('guildId', RELAY_SERVER_ID, ENTITY_ID),
            DiscordButtons.getStorageMonitorContainerButton('guildId', RELAY_SERVER_ID, ENTITY_ID),
        ];

        for (const row of rows) {
            for (const customId of customIdsOf(row)) {
                Assert.ok(customId.length <= CustomIds.CUSTOM_ID_MAX_LENGTH,
                    `custom id is ${customId.length} characters long: ${customId}`);
            }
        }
    });

    Test.it('parse back to the server and the entity', () => {
        const row = DiscordButtons.getStorageMonitorContainerButton('guildId', RELAY_SERVER_ID, ENTITY_ID);
        const prefixes = ['StorageMonitorEdit', 'StorageMonitorRecycle', 'StorageMonitorContainerDelete'];

        for (const customId of customIdsOf(row)) {
            const prefix = prefixes.find((candidate) => customId.startsWith(candidate));
            Assert.ok(prefix, `no prefix matches ${customId}`);

            Assert.deepStrictEqual(CustomIds.parse(customId, prefix, ['serverId', 'entityId']),
                { serverId: RELAY_SERVER_ID, entityId: ENTITY_ID });
        }
    });

    Test.it('refuse a custom id that is too long instead of throwing a cryptic error', () => {
        Assert.throws(() => DiscordButtons.getButton({ customId: 'x'.repeat(101) }),
            /is 101 characters long, Discord allows 100/);
    });
});
