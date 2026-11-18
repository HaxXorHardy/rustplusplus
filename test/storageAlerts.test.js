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

const StorageAlerts = require('../src/util/storageAlerts.js');

const items = {
    items: {
        '-1211166256': { name: '5.56 Rifle Ammo', shortname: 'ammo.rifle' },
        '-946369541': { name: 'Low Grade Fuel', shortname: 'lowgradefuel' },
        '-1581843485': { name: 'Sulfur', shortname: 'sulfur' },
    },
    getName(id) { return this.items[id] ? this.items[id].name : undefined; },
    getClosestItemIdByName() { return null; },
};

Test.describe('storage alerts', () => {
    Test.it('parses names, short names, operators and amounts like 10k', () => {
        const result = StorageAlerts.parse(items, 'ammo.rifle < 100, low grade fuel <= 50\nSulfur > 10k; nonsense, Wood < x');

        Assert.deepStrictEqual(result.rules.map((r) => [r.itemId, r.op, r.amount]), [
            ['-1211166256', '<', 100],
            ['-946369541', '<=', 50],
            ['-1581843485', '>', 10000],
        ]);
        Assert.deepStrictEqual(result.rejected, ['nonsense', 'Wood < x']);
        Assert.strictEqual(StorageAlerts.format(items, result.rules),
            '5.56 Rifle Ammo < 100, Low Grade Fuel <= 50, Sulfur > 10000');
    });

    Test.it('fires once when a rule becomes true, again only after it was false', () => {
        const entity = { alerts: StorageAlerts.parse(items, 'ammo.rifle < 100').rules };
        const ammo = (quantity) => [{ itemId: -1211166256, quantity: quantity, itemIsBlueprint: false }];

        Assert.strictEqual(StorageAlerts.evaluate(entity, ammo(500)).fired.length, 0);

        const low = StorageAlerts.evaluate(entity, ammo(60));
        Assert.strictEqual(low.fired.length, 1);
        Assert.strictEqual(low.fired[0].quantity, 60);

        Assert.strictEqual(StorageAlerts.evaluate(entity, ammo(40)).fired.length, 0, 'still low: no repeat');
        Assert.strictEqual(StorageAlerts.evaluate(entity, ammo(300)).changed, true, 'refilled: rearmed');
        Assert.strictEqual(StorageAlerts.evaluate(entity, ammo(10)).fired.length, 1);
    });

    Test.it('adds up stacks, ignores blueprints and counts a missing item as 0', () => {
        const entity = { alerts: StorageAlerts.parse(items, 'sulfur >= 1500, lowgradefuel < 1').rules };
        const storage = [
            { itemId: -1581843485, quantity: 1000, itemIsBlueprint: false },
            { itemId: -1581843485, quantity: 500, itemIsBlueprint: false },
            { itemId: -946369541, quantity: 1, itemIsBlueprint: true },
        ];

        const result = StorageAlerts.evaluate(entity, storage);
        Assert.deepStrictEqual(result.fired.map((f) => f.quantity), [1500, 0]);
    });
});

/* The real item list of the game: names carry calibres and prefixes nobody types. */
Test.describe('storage alerts with the real item names', () => {
    const Items = require('../src/structures/Items');
    const realItems = new Items();
    const nameOf = (text) => {
        const result = StorageAlerts.parse(realItems, `${text} < 1`);
        return result.rules.length === 1 ? realItems.getName(result.rules[0].itemId) : null;
    };

    Test.it('finds the item players mean', () => {
        const expected = {
            'Rifle Ammo': '5.56 Rifle Ammo',
            'HV Rifle Ammo': 'HV 5.56 Rifle Ammo',
            'Pistol Ammo': 'Pistol Bullet',
            'Stone': 'Stones',
            'C4': 'Timed Explosive Charge',
            'HQM': 'High Quality Metal',
            'Shotgun Shells': '12 Gauge Buckshot',
            'Low Grade Fuel': 'Low Grade Fuel',
            'Sulfur Ore': 'Sulfur Ore',
            'ammo.rifle': '5.56 Rifle Ammo',
        };

        for (const [typed, name] of Object.entries(expected)) Assert.strictEqual(nameOf(typed), name, typed);
    });
});
