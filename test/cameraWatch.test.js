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
    The stranger check of the camera watch: which player the camera saw is not in the team, and when it was reported
    last. The camera only sends names (no steam id), so the comparison is by name.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const CameraWatch = require('../src/util/cameraWatch.js');

Test.describe('CameraWatch.teamNameSet', () => {
    Test.it('collects the names of the team, normalized', () => {
        const names = CameraWatch.teamNameSet({ players: [{ name: 'Hardy' }, { name: ' ELMALO ' }, { name: '' }] });

        Assert.strictEqual(names.has('hardy'), true);
        Assert.strictEqual(names.has('elmalo'), true);
        Assert.strictEqual(names.size, 2);
    });

    Test.it('is empty without a team', () => {
        Assert.strictEqual(CameraWatch.teamNameSet(null).size, 0);
        Assert.strictEqual(CameraWatch.teamNameSet({}).size, 0);
    });
});

Test.describe('CameraWatch.findStrangers', () => {
    const names = CameraWatch.teamNameSet({ players: [{ name: 'Hardy' }, { name: '$krrtCobain' }] });

    Test.it('ignores the team, also with a different case', () => {
        const strangers = CameraWatch.findStrangers([{ name: 'hardy', entityId: 1 }, { name: '$KRRTCOBAIN', entityId: 2 }],
            names);

        Assert.deepStrictEqual(strangers, []);
    });

    Test.it('reports a player that is not in the team', () => {
        const strangers = CameraWatch.findStrangers([
            { name: 'Hardy', entityId: 1 },
            { name: 'Raider', entityId: 2, position: { x: 3, y: 0, z: 4 } },
            { name: 'Raider', entityId: 3 },
        ], names);

        Assert.strictEqual(strangers.length, 1);
        Assert.strictEqual(strangers[0].name, 'Raider');
        Assert.strictEqual(strangers[0].distance, 5);
    });

    Test.it('reports a player without a name', () => {
        const strangers = CameraWatch.findStrangers([{ entityId: 7 }], names);

        Assert.strictEqual(strangers.length, 1);
        Assert.strictEqual(strangers[0].name, null);
        Assert.strictEqual(strangers[0].entityId, 7);
    });

    Test.it('reports everybody when the team is unknown', () => {
        const strangers = CameraWatch.findStrangers([{ name: 'Hardy', entityId: 1 }], new Set());

        Assert.strictEqual(strangers.length, 1);
    });
});

Test.describe('CameraWatch.distanceOf', () => {
    Test.it('measures the distance to the camera', () => {
        Assert.strictEqual(CameraWatch.distanceOf({ position: { x: 3, y: 0, z: 4 } }), 5);
        Assert.strictEqual(CameraWatch.distanceOf({ position: { x: 0, y: 0, z: 2.25 } }), 2.3);
    });

    Test.it('returns null without a position', () => {
        Assert.strictEqual(CameraWatch.distanceOf({}), null);
        Assert.strictEqual(CameraWatch.distanceOf(null), null);
    });
});

Test.describe('CameraWatch cooldown', () => {
    Test.it('allows the first alert and blocks the next one', () => {
        const state = {};
        const key = CameraWatch.alertKey('cam69', { name: 'Raider', entityId: 2 });

        Assert.strictEqual(CameraWatch.isCooldownOver(state, key, 1000, 500), true);

        CameraWatch.markAlert(state, key, 1000);

        Assert.strictEqual(CameraWatch.isCooldownOver(state, key, 1200, 500), false);
        Assert.strictEqual(CameraWatch.isCooldownOver(state, key, 1500, 500), true);
    });

    Test.it('separates cameras and players', () => {
        const state = {};
        const raider = CameraWatch.alertKey('cam69', { name: 'Raider', entityId: 2 });
        const other = CameraWatch.alertKey('cam70', { name: 'Raider', entityId: 2 });
        const unnamed = CameraWatch.alertKey('cam69', { name: null, entityId: 3 });

        Assert.notStrictEqual(raider, other);
        Assert.notStrictEqual(raider, unnamed);

        CameraWatch.markAlert(state, raider, 1000);

        Assert.strictEqual(CameraWatch.isCooldownOver(state, other, 1100, 500), true);
    });

    Test.it('drops entries that are older than the cooldown', () => {
        const state = { old: 100, fresh: 900 };

        CameraWatch.pruneAlertState(state, 1000, 500);

        Assert.deepStrictEqual(Object.keys(state), ['fresh']);
    });
});

Test.describe('CameraWatch.normalizeIntervalSeconds', () => {
    Test.it('keeps a value the menu offers', () => {
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(60), 60);
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds('300'), 300);
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(900), 900);
    });

    Test.it('falls back to the default for a value that is no number', () => {
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(undefined), CameraWatch.INTERVAL_DEFAULT_SECONDS);
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(null), CameraWatch.INTERVAL_DEFAULT_SECONDS);
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds('abc'), CameraWatch.INTERVAL_DEFAULT_SECONDS);
    });

    Test.it('clamps a value into the allowed range', () => {
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(1), 30);
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(-600), 30);
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(99999), 3600);
    });

    Test.it('rounds a fraction', () => {
        Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(120.6), 121);
    });

    Test.it('offers the intervals of the menu in ascending order', () => {
        const options = CameraWatch.INTERVAL_OPTIONS;

        Assert.ok(options.length >= 2);
        Assert.deepStrictEqual([...options].sort((a, b) => a - b), options);

        for (const seconds of options) {
            Assert.strictEqual(CameraWatch.normalizeIntervalSeconds(seconds), seconds);
        }
    });
});
