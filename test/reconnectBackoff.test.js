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

const ReconnectBackoff = require('../src/util/reconnectBackoff.js');

Test.describe('reconnectBackoffMs', () => {
    Test.it('waits the configured interval on the first attempt', () => {
        Assert.strictEqual(ReconnectBackoff(1, 15000, 300000), 15000);
    });

    Test.it('doubles the delay with every further attempt', () => {
        Assert.strictEqual(ReconnectBackoff(2, 15000, 300000), 30000);
        Assert.strictEqual(ReconnectBackoff(3, 15000, 300000), 60000);
        Assert.strictEqual(ReconnectBackoff(4, 15000, 300000), 120000);
    });

    Test.it('never exceeds the configured maximum', () => {
        Assert.strictEqual(ReconnectBackoff(10, 15000, 300000), 300000);
        Assert.strictEqual(ReconnectBackoff(50, 15000, 300000), 300000);
    });

    Test.it('falls back to usable values for missing input', () => {
        Assert.strictEqual(ReconnectBackoff(0, 15000, 300000), 15000);
        Assert.strictEqual(ReconnectBackoff(NaN, undefined, undefined), 15000);
        Assert.strictEqual(ReconnectBackoff(3, 1000, 1000), 1000);
    });
});
