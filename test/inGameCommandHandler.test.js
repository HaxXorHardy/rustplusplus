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

/* The in-game commands run end to end (1.51.0 lost a require here: every command threw a ReferenceError). */

const Assert = require('node:assert');
const Test = require('node:test');

const CommandHandler = require('../src/handlers/inGameCommandHandler.js');

const en = require('../src/languages/en.json');
const de = require('../src/languages/de.json');

function setup() {
    const sent = [];
    const client = {
        intlGet: (guildId, key) => (guildId === 'en' || guildId === null ? en[key] : de[key]) || key,
        getInstance: () => ({ aliases: [] }),
    };
    const rustplus = {
        guildId: 'guild',
        isOperational: true,
        generalSettings: { prefix: '.', inGameCommandsEnabled: true },
        log: () => undefined,
        logInGameCommand: () => undefined,
        sendInGameMessage: (text) => sent.push(text),
        getCommandTime: () => 'TIME',
        getCommandPop: () => 'POP',
    };
    const run = (message) => CommandHandler.inGameCommandHandler(rustplus, client,
        { message: message, steamId: 1, name: 'Hardy' });

    return { sent, run };
}

Test.describe('in-game command handler', () => {
    Test.it('answers .time and .pop, in English and in the guild language', async () => {
        const { sent, run } = setup();

        for (const command of ['.time', '.pop', '.zeit', '.bev']) Assert.strictEqual(await run(command), true, command);
        Assert.deepStrictEqual(sent, ['TIME', 'POP', 'TIME', 'POP']);
    });

    Test.it('ignores the map event commands while they are switched off', async () => {
        const { sent, run } = setup();

        Assert.strictEqual(await run('.cargo'), true);
        Assert.deepStrictEqual(sent, []);
    });
});
