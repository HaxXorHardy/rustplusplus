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

const Battlemetrics = require('../src/structures/Battlemetrics.js');

function playerResponse(positiveMatch) {
    const server = (id, game, timePlayed) => ({
        type: 'server', id: id, relationships: { game: { data: { id: game } } }, meta: { timePlayed: timePlayed }
    });
    return {
        data: { attributes: { positiveMatch: positiveMatch } },
        included: [server('1234567', 'rust', 3600), server('7654321', 'rust', 7200), server('42', 'ark', 99999)]
    };
}

async function fetchWith(response) {
    const bmInstance = new Battlemetrics(1234567, 'Test Server');
    bmInstance.request = async () => response;
    return bmInstance.fetchTimesPlayed('1');
}

Test.describe('Battlemetrics.fetchTimesPlayed', () => {
    Test.it('sums all Rust servers for a player matched by Steam id (RCON)', async () => {
        Assert.deepStrictEqual(await fetchWith(playerResponse(true)), { server: 3600, total: 10800 });
    });

    Test.it('uses the server hours for a player only matched by name (no RCON)', async () => {
        Assert.deepStrictEqual(await fetchWith(playerResponse(false)), { server: 3600, total: 3600 });
    });

    Test.it('treats a missing positiveMatch as a name match', async () => {
        const response = playerResponse(true);
        delete response.data.attributes.positiveMatch;
        Assert.deepStrictEqual(await fetchWith(response), { server: 3600, total: 3600 });
    });
});
