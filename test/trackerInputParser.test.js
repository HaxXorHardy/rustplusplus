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

const TrackerInputParser = require('../src/util/trackerInputParser.js');

Test.describe('parseTrackerPlayerInput', () => {
    Test.it('accepts a 64-bit steam id', () => {
        const result = TrackerInputParser.parseTrackerPlayerInput('76561198000000000');

        Assert.strictEqual(result.valid, true);
        Assert.strictEqual(result.type, 'steamId');
        Assert.strictEqual(result.value, '76561198000000000');
    });

    Test.it('accepts a steam profile url and extracts the id', () => {
        const result = TrackerInputParser.parseTrackerPlayerInput(
            'https://steamcommunity.com/profiles/76561198000000000');

        Assert.strictEqual(result.valid, true);
        Assert.strictEqual(result.type, 'steamId');
        Assert.strictEqual(result.value, '76561198000000000');
    });

    Test.it('accepts a steam vanity url and keeps the vanity name', () => {
        const result = TrackerInputParser.parseTrackerPlayerInput(
            'https://steamcommunity.com/id/someVanityName');

        Assert.strictEqual(result.valid, true);
        Assert.strictEqual(result.type, 'steamVanityUrl');
        Assert.strictEqual(result.value, 'someVanityName');
    });

    Test.it('accepts a battlemetrics player id', () => {
        const result = TrackerInputParser.parseTrackerPlayerInput('1234567');

        Assert.strictEqual(result.valid, true);
        Assert.strictEqual(result.type, 'battlemetricsId');
    });

    Test.it('rejects empty input', () => {
        const result = TrackerInputParser.parseTrackerPlayerInput('   ');

        Assert.strictEqual(result.valid, false);
        Assert.strictEqual(result.value, null);
    });

    Test.it('rejects non-string input', () => {
        const result = TrackerInputParser.parseTrackerPlayerInput(null);

        Assert.strictEqual(result.valid, false);
    });
});
