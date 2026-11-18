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
    The death map: the clean map of the server with a red mark for every death of the team (util/deathLog.js),
    written as a JPEG next to the other map files.
*/

const Path = require('path');

const RADIUS = 9;
const JPEG_QUALITY = 80;

/* World position -> pixel, the same formula the map markers use (structures/Map.js). */
function toImage(x, y, width, height, oceanMargin, mapSize) {
    const px = x * ((width - 2 * oceanMargin) / mapSize) + oceanMargin;
    const py = height - (y * ((height - 2 * oceanMargin) / mapSize) + oceanMargin);

    return { x: Math.round(px), y: Math.round(py) };
}

function cleanMapPath(guildId) {
    return Path.join(__dirname, '..', '..', `maps/${guildId}_map_clean.png`);
}

function deathMapPath(guildId) {
    return Path.join(__dirname, '..', '..', `maps/${guildId}_death_map.jpg`);
}

/* A filled red circle with a white ring. */
function mark(Jimp, image, cx, cy) {
    const red = Jimp.rgbaToInt(220, 20, 20, 255);
    const white = Jimp.rgbaToInt(255, 255, 255, 255);
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    for (let dy = -RADIUS - 2; dy <= RADIUS + 2; dy++) {
        for (let dx = -RADIUS - 2; dx <= RADIUS + 2; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;

            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= RADIUS) image.setPixelColor(red, x, y);
            else if (distance <= RADIUS + 2) image.setPixelColor(white, x, y);
        }
    }
}

/*
    Render the deaths on the map of the connection. Returns the path of the image, or null when the map is not known
    yet. deps.Jimp for tests.
*/
async function render(rustplus, deaths, deps = {}) {
    const Jimp = deps.Jimp || require('jimp');
    const map = rustplus.map;
    const mapSize = rustplus.info ? rustplus.info.mapSize : null;
    if (!map || !mapSize) return null;

    const image = await Jimp.read(deps.source || cleanMapPath(rustplus.guildId));

    for (const death of deaths) {
        const point = toImage(death.x, death.y, map.width, map.height, map.oceanMargin, mapSize);
        mark(Jimp, image, point.x, point.y);
    }

    const target = deps.target || deathMapPath(rustplus.guildId);
    await image.quality(JPEG_QUALITY).writeAsync(target);

    return target;
}

module.exports = {
    toImage: toImage,
    render: render,
};
