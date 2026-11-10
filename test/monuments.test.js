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
    The monument names of the map. A live server reported 40 different tokens; three of them (apartmentcomplex,
    jungle_ziggurat, radtown) were missing in the table of structures/Map.js, so /map monuments dropped them and the map
    drew the raw token. Those three are in the table now, everything else falls back to a formatted token.
*/

const Assert = require('node:assert');
const Fs = require('node:fs');
const Path = require('node:path');
const Test = require('node:test');

const Monuments = require('../src/util/monuments.js');
const RustPlus = require('../src/structures/RustPlus.js');

/* The tokens a live server (Rustpc.uk, 2026-11-10) sent, minus the intentionally skipped ones. */
const LIVE_TOKENS = [
    'AbandonedMilitaryBase', 'airfield_display_name', 'apartmentcomplex', 'arctic_base_a', 'bandit_camp',
    'dome_monument_name', 'excavator', 'ferryterminal', 'fishing_village_display_name', 'gas_station',
    'harbor_2_display_name', 'harbor_display_name', 'jungle_ziggurat', 'junkyard_display_name',
    'large_fishing_village_display_name', 'large_oil_rig', 'launchsite', 'lighthouse_display_name',
    'military_tunnels_display_name', 'mining_outpost_display_name', 'mining_quarry_hqm_display_name',
    'mining_quarry_stone_display_name', 'mining_quarry_sulfur_display_name', 'missile_silo_monument', 'oil_rig_small',
    'outpost', 'power_plant_display_name', 'radtown', 'satellite_dish_display_name', 'sewer_display_name',
    'stables_a', 'stables_b', 'supermarket', 'swamp_c', 'train_tunnel_display_name', 'train_tunnel_link_display_name',
    'train_yard_display_name', 'underwater_lab', 'water_treatment_plant_display_name',
];

Test.describe('Monuments.formatToken', () => {
    Test.it('builds a readable name from a token', () => {
        Assert.strictEqual(Monuments.formatToken('jungle_ziggurat'), 'Jungle Ziggurat');
        Assert.strictEqual(Monuments.formatToken('military_tunnels_display_name'), 'Military Tunnels');
        Assert.strictEqual(Monuments.formatToken('missile_silo_monument'), 'Missile Silo Monument');
        Assert.strictEqual(Monuments.formatToken('apartmentcomplex'), 'Apartmentcomplex');
        Assert.strictEqual(Monuments.formatToken('radtown'), 'Radtown');
    });

    Test.it('returns an empty name for a missing token', () => {
        Assert.strictEqual(Monuments.formatToken(undefined), '');
        Assert.strictEqual(Monuments.formatToken(null), '');
        Assert.strictEqual(Monuments.formatToken('   '), '');
    });
});

Test.describe('monument table of structures/Map.js', () => {
    const source = Fs.readFileSync(Path.join(__dirname, '..', 'src', 'structures', 'Map.js'), 'utf8');

    Test.it('has an entry for every monument a live server sends', () => {
        for (const token of LIVE_TOKENS) {
            Assert.ok(source.includes(`${token}: {`), `no entry for ${token}`);
        }
    });
});

Test.describe('RustPlus.getMonumentInformation', () => {
    function fakeInstance() {
        return {
            info: { correctedMapSize: 3000 },
            map: {
                monumentInfo: { gas_station: { clean: "Oxum's Gas Station" } },
                monuments: [
                    { token: 'gas_station', x: 100, y: 100 },
                    { token: 'gas_station', x: 2000, y: 2000 },
                    { token: 'jungle_ziggurat', x: 1500, y: 1500 },
                    { token: 'DungeonBase', x: 10, y: 10 },
                ],
            },
        };
    }

    Test.it('groups the known monuments', () => {
        const result = RustPlus.prototype.getMonumentInformation.call(fakeInstance());
        const gasStation = result.find((entry) => entry.name === "Oxum's Gas Station");

        Assert.ok(gasStation, 'the gas station is missing');
        Assert.strictEqual(gasStation.count, 2);
    });

    Test.it('names a monument that is not in the table instead of dropping it', () => {
        const result = RustPlus.prototype.getMonumentInformation.call(fakeInstance());

        Assert.ok(result.some((entry) => entry.name === 'Jungle Ziggurat'), 'the unknown monument was dropped');
    });

    Test.it('skips the dungeon base', () => {
        const result = RustPlus.prototype.getMonumentInformation.call(fakeInstance());

        Assert.ok(!result.some((entry) => entry.name.includes('Dungeon')));
    });

    Test.it('skips custom monument prefabs and empty tokens', () => {
        const instance = fakeInstance();
        instance.map.monuments.push({ token: 'assets/bundled/prefabs/autospawn/monument/x.prefab', x: 1, y: 1 });
        instance.map.monuments.push({ token: '', x: 2, y: 2 });

        const result = RustPlus.prototype.getMonumentInformation.call(instance);

        Assert.ok(!result.some((entry) => entry.name.toLowerCase().includes('assets')));
        Assert.ok(!result.some((entry) => entry.name === ''));
    });
});
