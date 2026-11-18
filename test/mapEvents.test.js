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

/* The map events stay in the code but do not run while RPP_MAP_EVENTS_ENABLED is off (the API sends none). */

const Assert = require('node:assert');
const Test = require('node:test');

const Config = require('../config');
const MapEvents = require('../src/util/mapEvents.js');
const MapMarkers = require('../src/structures/MapMarkers.js');

const en = require('../src/languages/en.json');
const de = require('../src/languages/de.json');
const client = { intlGet: (guildId, key) => (guildId === 'en' ? en[key] : de[key]) || key };

function withEvents(t, value) {
    const original = Config.general.mapEventsEnabled;
    Config.general.mapEventsEnabled = value;
    t.after(() => { Config.general.mapEventsEnabled = original; });
}

Test.describe('map events switch', () => {
    Test.it('is off by default', () => {
        Assert.strictEqual(MapEvents.enabled(), false);
    });

    Test.it('recognizes the event commands and nothing else', () => {
        const is = (command) => MapEvents.isEventCommand(client, 'guild', '!', command);

        for (const command of ['!cargo', '!heli', '!chinook', '!small', '!large', '!vendor', '!deepsea', '!events',
            '!events cargo 2', '!market search sell ak']) {
            Assert.strictEqual(is(command), true, command);
        }
        for (const command of ['!craft ak', '!marker add stash', '!markers', '!upkeep', '!wipe', '!t on',
            '!cargoship', '!market']) {
            Assert.strictEqual(is(command), false, command);
        }
    });

    Test.it('leaves /market out of the slash commands while off', (t) => {
        const modules = [{ name: 'market' }, { name: 'status' }];

        withEvents(t, false);
        Assert.deepStrictEqual(MapEvents.filterSlashCommands(modules).map((m) => m.name), ['status']);

        Config.general.mapEventsEnabled = true;
        Assert.deepStrictEqual(MapEvents.filterSlashCommands(modules).map((m) => m.name), ['market', 'status']);
    });

    Test.it('tracks only the players of the map markers while off', (t) => {
        const calls = [];
        const fake = {};
        for (const name of ['updatePlayers', 'updateCargoShips', 'updatePatrolHelicopters', 'updateCH47s',
            'updateVendingMachines', 'updateGenericRadiuses', 'updateTravelingVendors']) {
            fake[name] = () => calls.push(name);
        }

        withEvents(t, false);
        MapMarkers.prototype.updateMapMarkers.call(fake, { markers: [] });
        Assert.deepStrictEqual(calls, ['updatePlayers']);

        calls.length = 0;
        Config.general.mapEventsEnabled = true;
        MapMarkers.prototype.updateMapMarkers.call(fake, { markers: [] });
        Assert.strictEqual(calls.length, 7, 'everything runs again when enabled');
    });
});
