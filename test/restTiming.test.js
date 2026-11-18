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

/* Slow Discord requests are logged with route and duration (device message edits took minutes, 2026-11-18). */

const Assert = require('node:assert');
const Test = require('node:test');

const RestTiming = require('../src/util/restTiming.js');

Test.describe('slow Discord requests', () => {
    Test.it('logs a request that takes longer than the limit, once wrapped, and keeps the result', async () => {
        const logged = [];
        const rest = { request: async (options) => {
            await new Promise((resolve) => setTimeout(resolve, options.waitMs));
            return 'answer';
        } };

        RestTiming.instrument(rest, (text) => logged.push(text), 20);
        RestTiming.instrument(rest, (text) => logged.push(`twice ${text}`), 20);

        Assert.strictEqual(await rest.request({ method: 'PATCH', fullRoute: '/channels/1/messages/2', waitMs: 40,
            files: [{}] }), 'answer');
        Assert.strictEqual(await rest.request({ method: 'GET', fullRoute: '/gateway', waitMs: 0 }), 'answer');

        Assert.strictEqual(logged.length, 1);
        Assert.match(logged[0], /^Slow Discord request: PATCH \/channels\/1\/messages\/2 took \d+ ms, ok, 1 file\(s\)\.$/);
    });

    Test.it('logs a slow failure and passes the error on', async () => {
        const logged = [];
        const rest = { request: async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
        } };

        RestTiming.instrument(rest, (text) => logged.push(text), 10);
        await Assert.rejects(rest.request({ method: 'PATCH', fullRoute: '/x' }), /aborted/);
        Assert.match(logged[0], /failed \(AbortError\)/);
    });
});
