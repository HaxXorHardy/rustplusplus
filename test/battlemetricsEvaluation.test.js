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
    A response without rust_maps, details, included or player metadata threw inside evaluation() before update() ran:
    the instance stayed marked successful while its data was frozen.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Battlemetrics = require('../src/structures/Battlemetrics.js');
const Config = require('../config');

const SERVER_ID = 31619741;

function serverResponse(details, included) {
    const attributes = { name: 'Test Server', players: included ? included.length : 0 };
    if (details !== undefined) attributes.details = details;
    const response = { data: { id: SERVER_ID, attributes: attributes } };
    if (included !== undefined) response.included = included;
    return response;
}

function player(id, name, meta) {
    const entity = { type: 'player', id: id, attributes: { name: name } };
    if (meta !== undefined) entity.meta = meta;
    return entity;
}

function newInstance() {
    const bmInstance = new Battlemetrics(SERVER_ID, 'Test Server');
    bmInstance.request = async () => null;
    return bmInstance;
}

Test.describe('Battlemetrics.evaluation', () => {
    Test.beforeEach((t) => {
        const original = Config.battlemetrics.token;
        Config.battlemetrics.token = 'test-token';  /* enabled is derived from the token. */
        t.after(() => {
            Config.battlemetrics.token = original;
        });
    });

    Test.it('keeps updating after a poll without rust_maps (null monuments against an array)', async () => {
        const bmInstance = newInstance();
        const monuments = [{ type: 'harbor' }];

        await bmInstance.evaluation(serverResponse({ rust_maps: null }, []), true);
        Assert.strictEqual(bmInstance.map_monuments, null);

        const ok = await bmInstance.evaluation(serverResponse({ rust_maps: { monuments: monuments } }, []));
        Assert.strictEqual(ok, true);
        Assert.deepStrictEqual(bmInstance.map_monuments, monuments);
        Assert.deepStrictEqual(bmInstance.serverEvaluation.map_monuments, { from: null, to: monuments });

        const back = await bmInstance.evaluation(serverResponse({}, []));
        Assert.strictEqual(back, true);
        Assert.strictEqual(bmInstance.map_monuments, null);
    });

    Test.it('accepts a response without details, included or player metadata', async () => {
        const bmInstance = newInstance();

        Assert.strictEqual(await bmInstance.evaluation(serverResponse(undefined, undefined), true), true);

        const ok = await bmInstance.evaluation(serverResponse(undefined, [player('1', 'Alice'),
            player('2', 'Bob', {}), player('3', 'Carol', { metadata: null })]));
        Assert.strictEqual(ok, true);
        Assert.deepStrictEqual(bmInstance.onlinePlayers, ['1', '2', '3']);

        /* Existing players take the same path again. */
        Assert.strictEqual(await bmInstance.evaluation(serverResponse(undefined, [player('1', 'Alice')])), true);
        Assert.deepStrictEqual(bmInstance.logoutPlayers.sort(), ['2', '3']);
    });
});

Test.describe('Battlemetrics.updateStreamerMode', () => {
    Test.beforeEach((t) => {
        const original = Config.battlemetrics.token;
        Config.battlemetrics.token = 'test-token';
        t.after(() => {
            Config.battlemetrics.token = original;
        });
    });

    Test.it('ignores a response without a data array', async () => {
        const bmInstance = newInstance();
        bmInstance.request = async () => ({ links: {} });
        await bmInstance.updateStreamerMode();
        Assert.strictEqual(bmInstance.streamerMode, true);
    });
});
