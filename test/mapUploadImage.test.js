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

/* Discord gets the full map as JPEG: the PNG of the photo-like map is about six times larger. */

const Assert = require('node:assert');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Test = require('node:test');

const { Jimp } = require('jimp');

const Client = require('../src/structures/clientRegistry.js');
const RustPlusMap = require('../src/structures/Map.js');

Client.client = { intlGet: (guildId, key) => key, log: () => undefined };

Test.describe('Map.writeUploadImage', () => {
    Test.it('writes a JPEG of the full map next to the PNG', async (t) => {
        const guildId = `test-${process.pid}-${Date.now()}`;
        const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-map-'));
        const clean = Path.join(dir, `${guildId}_map_clean.png`);
        const full = clean.replace('clean.png', 'full.png');
        const jpeg = RustPlusMap.uploadImagePath(guildId);

        t.after(() => {
            Fs.rmSync(dir, { recursive: true, force: true });
            Fs.rmSync(jpeg, { force: true });
        });

        /* Noise compresses badly as PNG, like the terrain of the map. */
        const image = new Jimp({ width: 256, height: 256 });
        image.scan(0, 0, 256, 256, (x, y, idx) => {
            for (let i = 0; i < 3; i++) image.bitmap.data[idx + i] = Math.floor(Math.random() * 256);
            image.bitmap.data[idx + 3] = 255;
        });
        await image.write(full);

        const warnings = [];
        await RustPlusMap.prototype.writeUploadImage.call({
            mapMarkerImageMeta: { map: { image: clean } },
            rustplus: { guildId: guildId, log: (cap, text) => warnings.push(text) },
        });

        Assert.deepStrictEqual(warnings, []);
        Assert.ok(Fs.existsSync(jpeg), 'the JPEG exists');
        Assert.strictEqual(Fs.readFileSync(jpeg).subarray(0, 2).toString('hex'), 'ffd8', 'it is a JPEG');
        Assert.ok(Fs.statSync(jpeg).size < Fs.statSync(full).size, 'it is smaller than the PNG');
        Assert.strictEqual(RustPlusMap.uploadImageName(guildId), Path.basename(jpeg));
    });

    Test.it('keeps going when the PNG is missing', async () => {
        const warnings = [];

        await RustPlusMap.prototype.writeUploadImage.call({
            mapMarkerImageMeta: { map: { image: Path.join(Os.tmpdir(), 'missing_map_clean.png') } },
            rustplus: { guildId: 'missing', log: (cap, text) => warnings.push(text) },
        });

        Assert.strictEqual(warnings.length, 1);
        Assert.match(warnings[0], /Could not write the map for Discord/);
    });
});
