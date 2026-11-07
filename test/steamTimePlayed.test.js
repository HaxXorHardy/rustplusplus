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

const SteamTimePlayed = require('../src/util/steamTimePlayed.js');

Test.describe('SteamTimePlayed.parseOwnedGamesPayload', () => {
    Test.it('reads the rust playtime (minutes of the steam profile)', () => {
        const payload = { response: { games: [{ appid: 252490, playtime_forever: 79212, playtime_2weeks: 4068 }] } };

        Assert.deepStrictEqual(SteamTimePlayed.parseOwnedGamesPayload(payload),
            { totalMinutes: 79212, twoWeeksMinutes: 4068 });
    });

    Test.it('reports the playtime without a two week value', () => {
        const payload = { response: { games: [{ appid: 252490, playtime_forever: 600 }] } };

        Assert.deepStrictEqual(SteamTimePlayed.parseOwnedGamesPayload(payload),
            { totalMinutes: 600, twoWeeksMinutes: null });
    });

    Test.it('returns null for a private profile or another game', () => {
        Assert.strictEqual(SteamTimePlayed.parseOwnedGamesPayload({ response: {} }), null);
        Assert.strictEqual(SteamTimePlayed.parseOwnedGamesPayload(null), null);
        Assert.strictEqual(SteamTimePlayed.parseOwnedGamesPayload({ response: { games: [{ appid: 10, playtime_forever: 5 }] } }), null);
    });
});
