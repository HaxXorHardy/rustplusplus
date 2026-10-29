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

const FormatLogValue = require('../src/util/formatLogValue.js');

const SECRET = 'discord-token-value-123456';

/* The logging path must never leak the Discord token or the battlemetrics token, whatever shape the
   logged value has. These tests protect that invariant. */
Test.describe('formatLogValue secret redaction', () => {
    Test.it('redacts a secret that appears in a plain string', () => {
        const output = FormatLogValue(`token=${SECRET}`, { secrets: [SECRET] });

        Assert.ok(!output.includes(SECRET), `secret leaked in: ${output}`);
        Assert.ok(output.includes('[REDACTED]'), output);
    });

    Test.it('redacts a secret nested inside an object', () => {
        const output = FormatLogValue({ auth: { token: SECRET }, other: 'value' }, { secrets: [SECRET] });

        Assert.ok(!output.includes(SECRET), `secret leaked in: ${output}`);
        Assert.ok(output.includes('other'), 'non-secret fields must still be logged');
    });

    Test.it('redacts a secret carried by an Error message', () => {
        const error = new Error(`request failed with token ${SECRET}`);
        const output = FormatLogValue(error, { secrets: [SECRET] });

        Assert.ok(!output.includes(SECRET), `secret leaked in: ${output}`);
    });

    Test.it('redacts a secret inside an array and inside a circular structure', () => {
        const circular = { name: 'root', values: [SECRET] };
        circular.self = circular;

        const output = FormatLogValue(circular, { secrets: [SECRET] });

        Assert.ok(!output.includes(SECRET), `secret leaked in: ${output}`);
        Assert.ok(output.includes('[Circular]'), output);
    });

    Test.it('redacts every declared secret', () => {
        const discordToken = 'discord-secret';
        const battlemetricsToken = 'battlemetrics-secret';

        const output = FormatLogValue(`${discordToken} and ${battlemetricsToken}`,
            { secrets: [discordToken, battlemetricsToken] });

        Assert.ok(!output.includes(discordToken), output);
        Assert.ok(!output.includes(battlemetricsToken), output);
    });

    Test.it('leaves values untouched when no secrets are configured', () => {
        const output = FormatLogValue({ message: 'hello' }, { secrets: [] });

        Assert.ok(output.includes('hello'), output);
    });
});
