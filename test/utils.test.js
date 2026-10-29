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

const Utils = require('../src/util/utils.js');

Test.describe('Utils.parseArgs', () => {
    Test.it('splits on single spaces and trims surrounding whitespace', () => {
        Assert.deepStrictEqual(Utils.parseArgs('  a b  c '), ['a', 'b', 'c']);
    });

    Test.it('returns a single element for a one-token string', () => {
        Assert.deepStrictEqual(Utils.parseArgs('solo'), ['solo']);
    });
});

Test.describe('Utils.getArgs', () => {
    Test.it('returns every argument when n is 0', () => {
        Assert.deepStrictEqual(Utils.getArgs('a b c'), ['a', 'b', 'c']);
    });

    Test.it('returns every argument when n is smaller than the argument count', () => {
        Assert.deepStrictEqual(Utils.getArgs('a b', 5), ['a', 'b']);
    });

    Test.it('keeps the remainder as one argument starting at n', () => {
        Assert.deepStrictEqual(Utils.getArgs('a b c d', 3), ['a', 'b', 'c d']);
    });

    Test.it('treats a non-numeric n as 0', () => {
        Assert.deepStrictEqual(Utils.getArgs('a b', 'x'), ['a', 'b']);
    });
});

Test.describe('Utils.removeInvisibleCharacters', () => {
    Test.it('strips zero-width and control characters', () => {
        Assert.strictEqual(Utils.removeInvisibleCharacters('a\u200Bb\u0000c'), 'abc');
    });
});

Test.describe('Utils.findClosestString', () => {
    const names = ['wood', 'stone', 'metal'];

    Test.it('finds an exact match', () => {
        Assert.strictEqual(Utils.findClosestString('stone', names), 'stone');
    });

    Test.it('finds a near match within the default threshold', () => {
        Assert.strictEqual(Utils.findClosestString('ston', names), 'stone');
    });

    Test.it('returns null when nothing is close enough', () => {
        Assert.strictEqual(Utils.findClosestString('completely different', names), null);
    });
});
