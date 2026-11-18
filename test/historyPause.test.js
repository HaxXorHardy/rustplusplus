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

/*
    The history refuses a token about 30 minutes after every renewal while the socket with that token keeps working.
    Such a refusal renews nothing and pauses the history of the account instead of asking (and logging) every 15 s.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const RustPlusAuth = require('../src/util/rustplusAuth.js');
const RustPlusHistory = require('../src/util/rustplusHistory.js');
const RustPlusLogin = require('../src/util/rustplusLogin.js');

function fakeClient(live) {
    const instance = { serverList: { server: { steamId: '1' } }, activeServer: 'server' };
    const client = {
        logs: [],
        instances: { guild: instance },
        rustplusInstances: {},
        intlGet: (guildId, key) => key,
        log: (cap, text, level) => client.logs.push({ text: `${text}`, level: level }),
        getInstance: () => instance,
        setInstance: () => undefined,
    };

    if (live) {
        client.rustplusInstances.guild = {
            guildId: 'guild', playerId: '1', authToken: 'token', isOperational: true,
            lastSuccessfulPollMs: Date.now(), rebuildConnection: () => undefined,
        };
    }

    return client;
}

function refused() {
    const error = new Error('History request failed with status 403.');
    error.status = 403;
    return error;
}

Test.describe('the history refused while the connection works', () => {
    Test.beforeEach((t) => {
        RustPlusHistory.resetAccountStateCache();

        const readAuth = RustPlusAuth.readAuth;
        const writeAuth = RustPlusAuth.writeAuth;
        const renewAuth = RustPlusLogin.renewAuth;

        RustPlusAuth.readAuth = () => ({ token: 'token', steamRefreshToken: 'refresh' });
        RustPlusAuth.writeAuth = () => undefined;
        RustPlusLogin.renewAuth = async () => { throw new Error('must not renew'); };

        t.after(() => {
            RustPlusAuth.readAuth = readAuth;
            RustPlusAuth.writeAuth = writeAuth;
            RustPlusLogin.renewAuth = renewAuth;
            RustPlusHistory.resetAccountStateCache();
        });
    });

    Test.it('pauses the history instead of asking again on every run', async () => {
        const client = fakeClient(true);
        let reads = 0;
        const fetchHistory = async () => { reads += 1; throw refused(); };
        const fetchSync = async () => ({ servers: [] });

        for (let i = 0; i < 4; i++) await RustPlusHistory.refresh(client, fetchHistory, fetchSync);

        Assert.strictEqual(reads, 1, 'the runs within the pause do not ask Facepunch');
        Assert.strictEqual(client.logs.filter((l) => l.text.includes('is read again in')).length, 1);
        Assert.ok(!client.logs.some((l) => l.text.includes('renewed')), 'nothing was renewed');
    });

    Test.it('keeps the strikes when no connection proves the token', async () => {
        const client = fakeClient(false);
        let reads = 0;
        const fetchHistory = async () => { reads += 1; throw refused(); };
        const fetchSync = async () => ({ servers: [] });

        await RustPlusHistory.refresh(client, fetchHistory, fetchSync);
        await RustPlusHistory.refresh(client, fetchHistory, fetchSync);

        Assert.strictEqual(reads, 2, 'without a live connection every run asks again');
        Assert.ok(!client.logs.some((l) => l.text.includes('is read again in')));
    });
});
