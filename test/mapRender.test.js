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

/* The map render: shared marker sprites, the clean map file and one render at a time per instance. */

const Assert = require('node:assert');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Test = require('node:test');

const { Jimp } = require('jimp');

const Client = require('../src/structures/clientRegistry.js');
const RustPlusMap = require('../src/structures/Map.js');

Client.client = { intlGet: (guildId, key) => key, log: () => undefined, rustplusMaps: {} };

function fakeRustplus(guildId, markers = []) {
    return {
        guildId: guildId,
        info: { mapSize: 1000 },
        generalSettings: { language: 'en' },
        mapMarkers: { types: { CargoShip: 5 } },
        log: () => undefined,
        getMapMarkersAsync: async () => ({ mapMarkers: { markers: markers } }),
        isResponseValid: async () => true,
    };
}

Test.describe('Map.mapAppendMarkers', () => {
    Test.it('rotates a copy of the shared sprite for every marker', async () => {
        const sprite = new Jimp({ width: 20, height: 10, color: 0xff0000ff });
        const map = new Jimp({ width: 200, height: 200, color: 0x000000ff });
        const before = Buffer.from(sprite.bitmap.data);

        const instance = Object.create(RustPlusMap.prototype);
        instance._width = 200;
        instance._height = 200;
        instance._oceanMargin = 0;
        instance._rustplus = fakeRustplus('g', [
            { type: 1, x: 100, y: 100, rotation: 90 },
            { type: 1, x: 500, y: 500, rotation: 90 },
        ]);
        instance._mapMarkerImageMeta = {
            map: { size: null, type: null, jimp: map },
            player: { size: 20, type: 1, jimp: sprite },
        };

        await instance.mapAppendMarkers();

        Assert.strictEqual(sprite.bitmap.width, 20);
        Assert.strictEqual(sprite.bitmap.height, 10);
        Assert.ok(before.equals(sprite.bitmap.data), 'the shared sprite is unchanged');
    });
});

Test.describe('Map.writeMapClean', () => {
    Test.it('creates the maps directory first', async (t) => {
        const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-map-'));
        t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));

        const clean = Path.join(dir, 'maps', 'g_map_clean.png');
        Client.client.rustplusMaps['g'] = Buffer.from('png');

        await RustPlusMap.prototype.writeMapClean.call({
            mapMarkerImageMeta: { map: { image: clean } },
            rustplus: { guildId: 'g' },
        });

        Assert.strictEqual(Fs.readFileSync(clean).toString(), 'png');
    });
});

Test.describe('Map render queue', () => {
    function newMap(guildId) {
        const instance = new RustPlusMap({ width: 100, height: 100, oceanMargin: 0, monuments: [], background: null,
            jpgImage: Buffer.from('jpg') }, fakeRustplus(guildId));
        /* Replaced before the queued constructor reset runs (it starts on the next microtask). */
        instance.resetImageAndMeta = async () => undefined;
        return instance;
    }

    Test.it('runs one render at a time and keeps going after a failure', async () => {
        const instance = newMap(`queue-${process.pid}`);
        const events = [];
        let running = 0;
        let call = 0;

        instance.writeUploadImage = async () => undefined;
        instance.writeMapPng = async () => {
            const index = call++;
            running += 1;
            events.push(running);
            await new Promise((resolve) => setTimeout(resolve, 10));
            running -= 1;
            if (index === 0) throw new Error('render failed');
        };

        const first = instance.writeMap(false, true);
        const second = instance.writeMap(false, true);
        const third = instance.writeMap(true, true);

        await Assert.rejects(first, /render failed/);
        await second;
        await third;

        Assert.deepStrictEqual(events, [1, 1, 1]);
    });

    Test.it('logs a failed reset of the constructor instead of rejecting unhandled', async () => {
        const warnings = [];
        const rustplus = fakeRustplus(`reset-${process.pid}`);
        rustplus.log = (cap, text) => warnings.push(text);

        const instance = new RustPlusMap({ width: 100, height: 100, oceanMargin: 0, monuments: [], background: null,
            jpgImage: Buffer.from('jpg') }, rustplus);
        instance.resetImageAndMeta = async () => { throw new Error('no font'); };

        await instance.updateMap({ width: 100, height: 100, oceanMargin: 0, monuments: [], background: null,
            jpgImage: Buffer.from('jpg') });

        Assert.strictEqual(warnings.length, 2);
        Assert.match(warnings[0], /Could not prepare the map images: no font/);
    });
});
