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

const Keywords = require('../src/util/keywords.js');

const client = { intlGet: (guildId, key) => key };

Test.describe('Keywords.getListOfCommandKeywords', () => {
    Test.it('returns the command syntax keys in a stable order', () => {
        const keywords = Keywords.getListOfCommandKeywords(client, 'guild');

        Assert.ok(Array.isArray(keywords));
        Assert.ok(keywords.length > 0);
        Assert.strictEqual(keywords[0], 'commandSyntaxAfk');
    });

    Test.it('asks for both the guild locale and the English fallback', () => {
        const requested = [];
        Keywords.getListOfCommandKeywords({
            intlGet: (guildId, key) => { requested.push(guildId); return key; }
        }, 'guild-42');

        Assert.ok(requested.includes('guild-42'), 'localized keywords must be included');
        Assert.ok(requested.includes('en'), 'English keywords must be included');
    });

    Test.it('returns the localized and English variant of every keyword', () => {
        const keywords = Keywords.getListOfCommandKeywords(client, 'guild');
        const counts = new Map();

        for (const keyword of keywords) {
            counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
        }

        Assert.strictEqual(keywords.length % 2, 0);
        Assert.ok([...counts.values()].every(count => count === 2),
            'each keyword appears once for the guild locale and once for English');
    });
});
