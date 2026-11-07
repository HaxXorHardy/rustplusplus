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

const ErrorHandler = require('../src/rustplusEvents/error.js');

/* The handler only logs and counts failures, so plain objects are enough. */
function fakeRustplus(logs, overrides = {}) {
    const rustplus = {
        guildId: 'guildId',
        serverId: 'serverId',
        logs: logs,
        isServerAvailable: () => true,
        deleteThisRustplusInstance: () => undefined,
        log: (title, text, level = 'info') => logs.push({ title, text, level }),
    };

    return Object.assign(rustplus, overrides);
}

/* Returns "<key>(<id>)" so the tests can see which message was requested for which server. */
function fakeClient() {
    return {
        rustplusConnectFailures: {},
        intlGet: (guildId, key, variables = {}) =>
            (variables.id ? `${key}(${variables.id})` : key),
    };
}

function connectionError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

Test.describe('Rust+ connection error handler', () => {
    Test.it('explains a reset connection (socket hang up)', async () => {
        const logs = [];

        await ErrorHandler.execute(fakeRustplus(logs), fakeClient(),
            connectionError('ECONNRESET', 'socket hang up'));

        /* First the raw error, then the hint that names the server and both likely causes. */
        Assert.strictEqual(logs.length, 2);
        Assert.strictEqual(String(logs[0].text), 'Error: socket hang up');
        Assert.deepStrictEqual(logs[1],
            { title: 'errorCap', text: 'connectionResetTo(serverId)', level: 'error' });
    });

    Test.it('explains a refused connection', async () => {
        const logs = [];

        await ErrorHandler.execute(fakeRustplus(logs), fakeClient(),
            connectionError('ECONNREFUSED', 'connect ECONNREFUSED'));

        Assert.deepStrictEqual(logs[1],
            { title: 'errorCap', text: 'connectionRefusedTo(serverId)', level: 'error' });
    });

    Test.it('counts connection failures so the transport can fall back to the proxy', async () => {
        const client = fakeClient();
        const rustplus = fakeRustplus([]);

        await ErrorHandler.execute(rustplus, client, connectionError('ECONNRESET', 'socket hang up'));
        await ErrorHandler.execute(rustplus, client, connectionError('ECONNREFUSED', 'connect ECONNREFUSED'));

        Assert.deepStrictEqual(client.rustplusConnectFailures, { guildId: 2 });
    });

    Test.it('does not count errors that are not connection failures', async () => {
        const client = fakeClient();

        await ErrorHandler.execute(fakeRustplus([]), client,
            connectionError('ENOTFOUND', 'getaddrinfo ENOTFOUND srv.invalid'));
        await ErrorHandler.execute(fakeRustplus([]), client, new Error('socket hang up'));

        Assert.deepStrictEqual(client.rustplusConnectFailures, { guildId: 1 });
    });
});
