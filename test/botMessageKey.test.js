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

/* The bot recognizes its own chat messages when the game returns them with "<" and ">" changed. */

const Assert = require('node:assert');
const Test = require('node:test');

const Message = require('../src/rustplusEvents/message.js');

Test.describe('own chat messages', () => {
    Test.it('match without the markup the game changes', () => {
        const sent = 'Storage Monitor: High Quality Metal steht bei 199 (< 200)';
        for (const back of ['Storage Monitor: High Quality Metal steht bei 199 (&lt; 200)',
            'Storage Monitor: High Quality Metal steht bei 199 (<​ 200)',
            'Storage Monitor: High Quality Metal steht bei 199 (＜ 200)']) {
            Assert.strictEqual(Message.botMessageKey(back), Message.botMessageKey(sent), back);
        }
        Assert.strictEqual(Message.botMessageKey('Storage Monitor zerfällt!'), 'storagemonitorzerfällt');
        Assert.notStrictEqual(Message.botMessageKey('199 (< 200)'), Message.botMessageKey('199 (< 2000)'));
    });
});
