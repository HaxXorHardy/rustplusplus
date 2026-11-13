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
    The camera renderer: a ray stream is a sequence of samples, each one either complete (control byte 255 followed by
    three bytes) or a repetition/delta of one of the last 64 samples. The tests build such a stream by hand, so the
    decoding, the sample -> pixel mapping and the accumulated image are covered without a server.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const CameraRenderer = require('../src/util/cameraRenderer.js');

/* A complete sample: control byte 255, then distance/alignment, then the material. */
function sampleBytes(distance, alignment, material) {
    return [255, (distance >> 2) & 0xFF, (((distance & 0x03) << 6) | (alignment & 0x3F)) & 0xFF, material & 0xFF];
}

function frameOf(samples, sampleOffset = 0) {
    const bytes = [].concat(...samples.map(([distance, alignment, material]) =>
        sampleBytes(distance, alignment, material)));

    return { sampleOffset: sampleOffset, rayData: Buffer.from(bytes) };
}

Test.describe('CameraRenderer', () => {
    Test.it('maps every sample index to its own pixel', () => {
        const map = CameraRenderer.buildSampleMap(8, 4);
        const seen = new Set(map);

        Assert.strictEqual(map.length, 32);
        Assert.strictEqual(seen.size, 32, 'the sample table must be a permutation');
    });

    Test.it('decodes a complete sample', () => {
        const frame = frameOf([[0, 63, 5]]);
        const { rays, filled } = CameraRenderer.decodeFrames([frame], 1, 1);

        Assert.strictEqual(filled, 1);
        Assert.deepStrictEqual(rays[0], [0, 1, 5]);
    });

    Test.it('counts every pixel once, also when frames overlap', () => {
        const frame = frameOf([[0, 63, 5], [0, 63, 5], [0, 63, 5], [0, 63, 5]]);
        const again = frameOf([[0, 63, 5], [0, 63, 5], [0, 63, 5], [0, 63, 5]]);

        const { filled } = CameraRenderer.decodeFrames([frame, again], 4, 2);

        Assert.strictEqual(filled, 4);
    });

    Test.it('reports the coverage of the collected frames', () => {
        const half = frameOf([[0, 63, 5], [0, 63, 5], [0, 63, 5], [0, 63, 5]]);

        Assert.strictEqual(CameraRenderer.coverage([half], 4, 2), 0.5);
        Assert.strictEqual(CameraRenderer.coverage([half, frameOf([[0, 63, 5], [0, 63, 5], [0, 63, 5], [0, 63, 5]],
            4)], 4, 2), 1);
    });

    Test.it('repeats a sample that is in the lookback window', () => {
        /*
            The lookback index is (3 * distance + 5 * (alignment / 16) + 7 * material) & 63, so a sample with
            distance 0, alignment 0 and material 0 lands in slot 0 - a control byte 0x00 repeats exactly that slot.
        */
        const bytes = Buffer.from([...sampleBytes(0, 0, 0), 0x00, ...sampleBytes(0, 0, 7)]);
        const { rays } = CameraRenderer.decodeFrames([{ sampleOffset: 0, rayData: bytes }], 3, 1);
        const materials = rays.map((ray) => ray[2]).sort();

        Assert.deepStrictEqual(materials, [0, 0, 7]);
    });

    Test.it('colours a material sample and the sky', () => {
        Assert.deepStrictEqual(CameraRenderer.rayColour([0, 1, 5]), { r: 204, g: 153, b: 102 });
        Assert.deepStrictEqual(CameraRenderer.rayColour([1, 0, 0]), { r: 208, g: 230, b: 252 });
    });

    Test.it('renders a png of the collected frames', async () => {
        const frame = frameOf([[0, 63, 5], [1023, 0, 0]], 0);
        const rendered = await CameraRenderer.renderPng([frame], 2, 1);

        Assert.ok(Buffer.isBuffer(rendered.buffer));
        Assert.deepStrictEqual([...rendered.buffer.subarray(0, 3)], [0x89, 0x50, 0x4E], 'png magic');
        Assert.strictEqual(rendered.coverage, 1);
        Assert.strictEqual(rendered.filled, 2);
    });

    Test.it('survives frames without ray data', async () => {
        const rendered = await CameraRenderer.renderPng([{ sampleOffset: 0 }], 2, 2);

        Assert.strictEqual(rendered.filled, 0);
        Assert.strictEqual(rendered.coverage, 0);
    });
});
