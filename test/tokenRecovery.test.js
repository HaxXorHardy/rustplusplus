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
    One policy for a rejected Rust+ token, whatever refused it (history read, socket handshake): two strikes, one
    renewal at most every two minutes, three renewals without a working connection mean a backoff and a DM to the owner
    of the credentials.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const CredentialOwner = require('../src/util/credentialOwner.js');
const RustPlusLogin = require('../src/util/rustplusLogin.js');
const TokenRecovery = require('../src/util/tokenRecovery.js');

function fakeClient(overrides = {}) {
    const client = {
        logs: [],
        messages: [],
        created: 0,
        rustplusInstances: {},
        rustplusReconnectTimers: {},
        rustplusReconnectAttempts: {},
        intlGet: (guildId, key) => key,
        log: (cap, text, level) => client.logs.push({ cap: cap, text: text, level: level }),
        messageSend: async (user, content) => client.messages.push({ user: user, content: content }),
        getInstance: () => null,
        createRustplusInstance: () => { client.created += 1; },
    };

    return Object.assign(client, overrides);
}

function stubRenew(t, renew) {
    const original = RustPlusLogin.renewAuth;
    RustPlusLogin.renewAuth = renew;

    t.after(() => { RustPlusLogin.renewAuth = original; });
}

function stubOwner(t, owner) {
    const original = CredentialOwner.getOwner;
    CredentialOwner.getOwner = async () => owner;

    t.after(() => { CredentialOwner.getOwner = original; });
}

/* Two rejections in a row renew the token, and the renewal is not repeated within two minutes. */
async function renewOnce(t, client) {
    const calls = { renewals: 0 };
    stubRenew(t, async () => { calls.renewals += 1; return { steamId: '1', token: 'new', servers: [] }; });

    TokenRecovery.reset();

    await TokenRecovery.reportRejected(client, 'guild', '1', 'test');
    Assert.strictEqual(await TokenRecovery.reportRejected(client, 'guild', '1', 'test'), 'renewed');
    Assert.strictEqual(calls.renewals, 1);

    return calls;
}

Test.describe('TokenRecovery.reportRejected', () => {
    Test.it('waits for the second rejection in a row', async (t) => {
        const client = fakeClient();
        let renewals = 0;

        stubRenew(t, async () => { renewals += 1; return { tokens: [] }; });
        TokenRecovery.reset();

        Assert.strictEqual(await TokenRecovery.reportRejected(client, 'guild', '1', 'first'), 'skipped');
        Assert.strictEqual(renewals, 0, 'one rejection is no proof of a dead token');

        Assert.strictEqual(await TokenRecovery.reportRejected(client, 'guild', '1', 'second'), 'renewed');
        Assert.strictEqual(renewals, 1);
    });

    Test.it('does not log in twice within two minutes', async (t) => {
        const client = fakeClient();
        const calls = await renewOnce(t, client);

        /* Two more rejections right after the renewal would ask for a second login. */
        await TokenRecovery.reportRejected(client, 'guild', '1', 'again');
        Assert.strictEqual(await TokenRecovery.reportRejected(client, 'guild', '1', 'again'), 'skipped');

        Assert.strictEqual(calls.renewals, 1, 'the second login is throttled');
    });
});

Test.describe('TokenRecovery backoff', () => {
    Test.it('stops logging in after three renewals without a working connection', async (t) => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
        stubOwner(t, { id: 'user' });

        const client = fakeClient();
        let renewals = 0;

        stubRenew(t, async () => { renewals += 1; return { tokens: [] }; });
        TokenRecovery.reset();

        for (let i = 0; i < 3; i++) {
            await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');
            await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');

            /* Pass the throttle of the renewal. */
            t.mock.timers.tick(TokenRecovery.RENEW_MIN_INTERVAL_MS + 1000);
        }

        Assert.strictEqual(renewals, 3);
        Assert.strictEqual(TokenRecovery.isBackedOff('1'), true);
        Assert.strictEqual(client.messages.length, 1, 'the owner is asked for a new login');
        Assert.ok(client.messages[0].content.content.includes('/credentials login'));

        /* While the backoff lasts, the account is left alone. */
        Assert.strictEqual(await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected'), 'skipped');
        Assert.strictEqual(renewals, 3);

        /* After it, the bot tries again. */
        t.mock.timers.tick(TokenRecovery.BACKOFF_MS + 1000);
        await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');
        await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');

        Assert.strictEqual(renewals, 4);
    });

    Test.it('counts a renewal that fails', async (t) => {
        const client = fakeClient();

        stubRenew(t, async () => { throw new Error('No Steam refresh token stored, a new login is required.'); });
        TokenRecovery.reset();

        await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');
        Assert.strictEqual(await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected'), 'failed');

        Assert.ok(client.logs.some((line) => line.level === 'warn' && line.text.includes('could not be renewed')));
        Assert.strictEqual(TokenRecovery.renewalCount('1'), 1);
    });

    Test.it('forgets everything when the connection works', async (t) => {
        const client = fakeClient();
        await renewOnce(t, client);

        Assert.strictEqual(TokenRecovery.renewalCount('1'), 1);

        TokenRecovery.markHealthy('1');

        Assert.strictEqual(TokenRecovery.renewalCount('1'), 0);
        Assert.strictEqual(TokenRecovery.isBackedOff('1'), false);
    });
});

Test.describe('TokenRecovery.reconnect', () => {
    Test.it('rebuilds the socket of a running instance', async (t) => {
        const client = fakeClient();
        const reasons = [];

        client.rustplusInstances.guild = {
            playerId: '1',
            rebuildConnection: (reason) => reasons.push(reason),
        };

        stubRenew(t, async () => ({ tokens: [] }));
        TokenRecovery.reset();

        await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');
        await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');

        Assert.deepStrictEqual(reasons, ['the account token was renewed']);
        Assert.strictEqual(client.created, 0, 'no second instance while one is running');
    });

    Test.it('starts a reconnect that waits on the backoff right away', async (t) => {
        const client = fakeClient({
            rustplusReconnectTimers: { guild: setTimeout(() => undefined, 60 * 1000) },
            getInstance: () => ({
                activeServer: 'server',
                serverList: { server: { serverIp: 'relay-server', appPort: 28082, steamId: '1', playerToken: 42 } },
            }),
        });

        t.after(() => { if (client.rustplusReconnectTimers.guild) clearTimeout(client.rustplusReconnectTimers.guild); });

        stubRenew(t, async () => ({ tokens: [] }));
        TokenRecovery.reset();

        await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');
        await TokenRecovery.reportRejected(client, 'guild', '1', 'rejected');

        Assert.strictEqual(client.rustplusReconnectTimers.guild, null);
        Assert.strictEqual(client.created, 1);
    });
});

Test.describe('error event', () => {
    /* The handshake itself reports a refused token, so the bot does not have to wait for the history read. */
    Test.it('reports a 403 handshake to the recovery', async (t) => {
        const ErrorEvent = require('../src/rustplusEvents/error.js');
        const original = TokenRecovery.reportRejected;
        const calls = [];

        TokenRecovery.reportRejected = async (...args) => { calls.push(args); return 'skipped'; };
        t.after(() => { TokenRecovery.reportRejected = original; });

        const rustplus = {
            guildId: 'guild',
            playerId: '76561198000000001',
            serverId: 'server',
            playerToken: 1,
            isDeleted: false,
            isServerAvailable: () => true,
            log: () => undefined,
        };

        const client = {
            intlGet: (guildId, key) => key,
            log: () => undefined,
            rustplusConnectFailures: {},
        };

        await ErrorEvent.execute(rustplus, client, {
            code: 'ERELAYREJECTED',
            message: 'The relay rejected the handshake with HTTP 403 Forbidden.',
        });

        Assert.strictEqual(calls.length, 1);
        Assert.strictEqual(calls[0][2], '76561198000000001');
        Assert.match(calls[0][3], /403/);
    });

    Test.it('leaves a 502 handshake to the reconnect', async (t) => {
        const ErrorEvent = require('../src/rustplusEvents/error.js');
        const original = TokenRecovery.reportRejected;
        const calls = [];

        TokenRecovery.reportRejected = async (...args) => { calls.push(args); return 'skipped'; };
        t.after(() => { TokenRecovery.reportRejected = original; });

        const rustplus = {
            guildId: 'guild',
            playerId: '76561198000000001',
            serverId: 'server',
            playerToken: 1,
            isDeleted: false,
            isServerAvailable: () => true,
            log: () => undefined,
        };

        const client = { intlGet: (guildId, key) => key, log: () => undefined, rustplusConnectFailures: {} };

        await ErrorEvent.execute(rustplus, client, {
            code: 'ERELAYREJECTED',
            message: 'The relay rejected the handshake with HTTP 502 Bad Gateway.',
        });

        /* A restart of the server answers 502, the token is fine. */
        Assert.strictEqual(calls.length, 0);
    });
});
