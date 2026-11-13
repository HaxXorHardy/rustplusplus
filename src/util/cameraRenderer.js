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
    Renders the ray data of a Rust+ camera to a PNG.

    A cameraRays broadcast never carries the whole picture: it contains the rays of the samples that changed, placed at
    the sample position given by `sampleOffset`. Sample index -> pixel is a shuffle (seeded xorshift, seed 1337, the same
    table the Rust+ app and @liamcottle/rustplus.js use), so one frame covers only a few percent of the image and the
    picture builds up while the frames arrive. At 320x180 that is ~30-40 frames; the library renders only the last 10 and
    ends up with a dotted pattern.

    The decoder is the one of the library (MIT, liamcottle/rustplus.js, camera.js), the accumulation over all frames is
    what makes a complete image.
*/

const COLOURS = [
    [0.5, 0.5, 0.5], [0.8, 0.7, 0.7], [0.3, 0.7, 1], [0.6, 0.6, 0.6],
    [0.7, 0.7, 0.7], [0.8, 0.6, 0.4], [1, 0.4, 0.4], [1, 0.1, 0.1],
];

const SKY_COLOUR = [208, 230, 252];

/* Seeded xorshift the sample table is shuffled with (same generator as the app). */
class IndexGenerator {
    constructor(seed) {
        this.state = 0 | seed;
        this.nextState();
    }

    nextInt(max) {
        let value = ((this.nextState() * (0 | max)) / 4294967295) | 0;
        if (value < 0) value = max + value - 1;
        return 0 | value;
    }

    nextState() {
        let state = this.state;
        const previous = state;
        state = ((state = ((state = (state ^ ((state << 13) | 0)) | 0) ^ ((state >>> 17) | 0)) | 0) ^
            ((state << 5) | 0)) | 0;
        this.state = state;
        return previous >= 0 ? previous : 4294967295 + previous - 1;
    }
}

/* Sample index -> pixel index, built once per resolution. */
function buildSampleMap(width, height) {
    const map = new Int32Array(width * height);
    for (let index = 0; index < map.length; index++) map[index] = index;

    const generator = new IndexGenerator(1337);
    for (let i = map.length - 1; i >= 1; i--) {
        const j = generator.nextInt(i + 1);
        const swap = map[i];
        map[i] = map[j];
        map[j] = swap;
    }

    return map;
}

/*
    Decodes the rays of all frames into a pixel array.
    Returns { rays, filled } where `rays` is [distance, alignment, material] per pixel (undefined = never covered).
*/
function decodeFrames(frames, width, height) {
    const sampleMap = buildSampleMap(width, height);
    const rays = new Array(width * height);
    let filled = 0;

    for (const frame of frames) {
        const rayData = frame.rayData;
        if (!rayData) continue;

        let dataPointer = 0;
        let sample = frame.sampleOffset;
        const lookback = new Array(64).fill(null).map(() => [0, 0, 0]);

        while (dataPointer < rayData.length - 1) {
            let t, r, i;
            const n = rayData[dataPointer++];

            if (n === 255) {
                /* A complete sample: 10 bit distance, 6 bit alignment, 8 bit material. */
                const l = rayData[dataPointer++];
                const o = rayData[dataPointer++];
                const s = rayData[dataPointer++];
                t = ((l << 2) | (o >> 6));
                r = (63 & o);
                i = s;
                lookback[(3 * ((t / 128) | 0) + 5 * ((r / 16) | 0) + 7 * i) & 63] = [t, r, i];
            }
            else {
                const kind = 192 & n;

                if (kind === 0) {
                    /* Repetition of a lookback entry. */
                    const entry = lookback[63 & n];
                    t = entry[0];
                    r = entry[1];
                    i = entry[2];
                }
                else if (kind === 64) {
                    /* Small delta of distance and alignment of a lookback entry. */
                    const entry = lookback[63 & n];
                    const delta = rayData[dataPointer++];
                    t = entry[0] + ((delta >> 3) - 15);
                    r = entry[1] + ((7 & delta) - 3);
                    i = entry[2];
                }
                else if (kind === 128) {
                    /* Delta of the distance of a lookback entry. */
                    const entry = lookback[63 & n];
                    t = entry[0] + (rayData[dataPointer++] - 127);
                    r = entry[1];
                    i = entry[2];
                }
                else {
                    /* A complete sample whose material comes from the control byte. */
                    const a = rayData[dataPointer++];
                    const f = rayData[dataPointer++];
                    t = ((a << 2) | (f >> 6));
                    r = (63 & f);
                    i = 63 & n;
                    lookback[(3 * ((t / 128) | 0) + 5 * ((r / 16) | 0) + 7 * i) & 63] = [t, r, i];
                }
            }

            sample %= sampleMap.length;
            const pixel = sampleMap[sample++];
            if (rays[pixel] === undefined) filled += 1;
            rays[pixel] = [t / 1023, r / 63, i];
        }
    }

    return { rays, filled };
}

/* The colour of a decoded pixel, { r, g, b }; sky is the light blue of the app. */
function rayColour(ray) {
    if (ray[0] === 1 && ray[1] === 0 && ray[2] === 0) {
        return { r: SKY_COLOUR[0], g: SKY_COLOUR[1], b: SKY_COLOUR[2] };
    }

    const base = COLOURS[ray[2]] || COLOURS[0];
    return {
        r: Math.round(ray[1] * base[0] * 255),
        g: Math.round(ray[1] * base[1] * 255),
        b: Math.round(ray[1] * base[2] * 255),
    };
}

/*
    Renders the frames to a PNG buffer. `coverage` is the share of pixels that got data (0..1), so a caller can tell
    whether more frames are needed.
*/
async function renderPng(frames, width, height) {
    const Jimp = require('jimp');

    const { rays, filled } = decodeFrames(frames, width, height);
    const image = new Jimp(width, height);

    for (let pixel = 0; pixel < rays.length; pixel++) {
        const ray = rays[pixel];
        if (ray === undefined) continue;

        const colour = rayColour(ray);
        const x = pixel % width;
        /* The image is built top down, the samples come bottom up. */
        const y = height - 1 - Math.floor(pixel / width);
        image.setPixelColor(Jimp.rgbaToInt(colour.r, colour.g, colour.b, 255), x, y);
    }

    return {
        buffer: await image.getBufferAsync(Jimp.MIME_PNG),
        coverage: filled / (width * height),
        filled: filled,
        total: width * height,
    };
}

/* Share of the pixels that the frames of one camera cover. */
function coverage(frames, width, height) {
    const { filled } = decodeFrames(frames, width, height);
    return filled / (width * height);
}

module.exports = {
    decodeFrames: decodeFrames,
    rayColour: rayColour,
    renderPng: renderPng,
    coverage: coverage,
    buildSampleMap: buildSampleMap,
};
