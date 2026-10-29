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

const Decay = require('../src/util/decay.js');

/* The intl lookup is the only dependency of the decay maths. intlGet returns the localized wall name
   (e.g. 'twig'), so the stub derives it from the key. */
const client = {
    intlGet: (guildId, key) => key.replace('commandSyntax', '').toLowerCase()
};

const TWIG = 'twig';
const WOOD = 'wood';

Test.describe('Decay.getTimeLeftSeconds', () => {
    Test.it('returns the full decay time at full health', () => {
        Assert.strictEqual(
            Decay.getTimeLeftSeconds(client, TWIG, Decay.TwigWallMaxHp),
            Decay.TwigWallDecayTimeSeconds);
    });

    Test.it('scales linearly with the remaining health', () => {
        Assert.strictEqual(
            Decay.getTimeLeftSeconds(client, WOOD, Decay.WoodWallMaxHp / 2),
            Math.floor(Decay.WoodWallDecayTimeSeconds / 2));
    });

    Test.it('returns null for health above the wall maximum', () => {
        Assert.strictEqual(Decay.getTimeLeftSeconds(client, WOOD, Decay.WoodWallMaxHp + 1), null);
    });

    Test.it('returns null for negative health', () => {
        Assert.strictEqual(Decay.getTimeLeftSeconds(client, TWIG, -1), null);
    });

    Test.it('returns null when health is not a number', () => {
        Assert.strictEqual(Decay.getTimeLeftSeconds(client, TWIG, 'not-a-number'), null);
    });

    Test.it('returns undefined for an unknown wall type', () => {
        Assert.strictEqual(Decay.getTimeLeftSeconds(client, 'unobtainium', 10), undefined);
    });

    Test.it('accepts the wall type case-insensitively', () => {
        Assert.strictEqual(
            Decay.getTimeLeftSeconds(client, TWIG.toUpperCase(), Decay.TwigWallMaxHp),
            Decay.TwigWallDecayTimeSeconds);
    });
});
