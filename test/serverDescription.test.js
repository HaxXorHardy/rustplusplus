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

'use strict';

const Test = require('node:test');
const Assert = require('node:assert');

const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');

Test('server description: escaped line breaks become real ones, spaces around them dropped', () => {
    const raw = String.raw`Welcome to Enjoy! \n\n • Teaming = Ban \n • Cheating = Ban \n\n\n\n Bye`;
    Assert.strictEqual(DiscordEmbeds.formatServerDescription(raw),
        'Welcome to Enjoy!\n\n• Teaming = Ban\n• Cheating = Ban\n\nBye');
});

Test('server description: real line breaks, \r\n and \t are handled, missing text is empty', () => {
    Assert.strictEqual(DiscordEmbeds.formatServerDescription(String.raw`a\r\nb\tc` + '\nd'), 'a\nb c\nd');
    Assert.strictEqual(DiscordEmbeds.formatServerDescription(undefined), '');
    Assert.strictEqual(DiscordEmbeds.formatServerDescription(null), '');
});
