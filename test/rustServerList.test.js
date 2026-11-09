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

const RustServerList = require('../src/util/rustServerList.js');
const ServerAddressHandler = require('../src/handlers/serverAddressHandler.js');

const SERVERS = [
    { hostname: 'Rustpc.uk | Casual | Gifts', ip: '195.140.215.31', port: 28025 },
    { hostname: "Captain's Quarters | Solo/Duo/Trio/Quad | Bi-weekly", ip: '213.239.221.105', port: 28015 },
    { hostname: 'Rustpc.uk | Casual | Gifts', ip: '10.0.0.1', port: 28015 },
    { hostname: 'Without address', ip: null, port: 28015 },
    { hostname: '', ip: '1.2.3.4', port: 28015 },
    null,
];

/* Counts the fetches, so the cache can be checked. */
function stubFetch(result) {
    const calls = { count: 0 };

    const fetch = async () => {
        calls.count += 1;
        if (result instanceof Error) throw result;
        return result;
    };

    return { calls, fetch };
}

Test.describe('RustServerList.normalizeHostname', () => {
    Test.it('collapses whitespace and lowercases the name', () => {
        Assert.strictEqual(RustServerList.normalizeHostname('  Rustpc.uk   |  Casual | Gifts '),
            'rustpc.uk | casual | gifts');
    });

    Test.it('returns null for a missing or empty name', () => {
        Assert.strictEqual(RustServerList.normalizeHostname(undefined), null);
        Assert.strictEqual(RustServerList.normalizeHostname(null), null);
        Assert.strictEqual(RustServerList.normalizeHostname('   '), null);
        Assert.strictEqual(RustServerList.normalizeHostname(42), null);
    });
});

Test.describe('RustServerList.buildAddressMap', () => {
    Test.it('maps the hostname to its address and skips broken entries', () => {
        const addresses = RustServerList.buildAddressMap(SERVERS);

        Assert.strictEqual(addresses.size, 2);
        Assert.strictEqual(addresses.get('rustpc.uk | casual | gifts'), '195.140.215.31:28025');
        Assert.strictEqual(addresses.get("captain's quarters | solo/duo/trio/quad | bi-weekly"), '213.239.221.105:28015');
    });
});

Test.describe('RustServerList.getAddress', () => {
    Test.beforeEach(() => {
        RustServerList.resetCache();
    });

    Test.it('finds the address of a listed server', async () => {
        const { fetch } = stubFetch(SERVERS);

        Assert.strictEqual(await RustServerList.getAddress('Rustpc.uk | Casual | Gifts', { fetch }),
            '195.140.215.31:28025');
    });

    Test.it('ignores case and extra whitespace of the name', async () => {
        const { fetch } = stubFetch(SERVERS);

        Assert.strictEqual(await RustServerList.getAddress('rustpc.uk  | casual | GIFTS', { fetch }),
            '195.140.215.31:28025');
    });

    Test.it('returns null for a server the list does not know', async () => {
        const { fetch } = stubFetch(SERVERS);

        Assert.strictEqual(await RustServerList.getAddress('Some other server', { fetch }), null);
        Assert.strictEqual(await RustServerList.getAddress('', { fetch }), null);
    });

    Test.it('reads the list once and keeps it', async () => {
        const { calls, fetch } = stubFetch(SERVERS);

        await RustServerList.getAddress('Rustpc.uk | Casual | Gifts', { fetch });
        await RustServerList.getAddress("Captain's Quarters | Solo/Duo/Trio/Quad | Bi-weekly", { fetch });

        Assert.strictEqual(calls.count, 1);
    });

    Test.it('reads the list again when it is older than the TTL', async (t) => {
        const base = 1794000000000;
        const original = Date.now;
        Date.now = () => base;
        t.after(() => {
            Date.now = original;
        });

        const { calls, fetch } = stubFetch(SERVERS);

        await RustServerList.getAddress('Rustpc.uk | Casual | Gifts', { fetch });
        Date.now = () => base + RustServerList.SERVER_LIST_TTL_MS + 1000;
        await RustServerList.getAddress('Rustpc.uk | Casual | Gifts', { fetch });

        Assert.strictEqual(calls.count, 2);
    });

    Test.it('returns null when the list cannot be read and does not hammer the endpoint', async (t) => {
        const base = 1794000000000;
        const original = Date.now;
        Date.now = () => base;
        t.after(() => {
            Date.now = original;
        });

        const { calls, fetch } = stubFetch(new Error('offline'));

        Assert.strictEqual(await RustServerList.getAddress('Rustpc.uk | Casual | Gifts', { fetch }), null);
        Assert.strictEqual(await RustServerList.getAddress('Rustpc.uk | Casual | Gifts', { fetch }), null);
        Assert.strictEqual(calls.count, 1, 'a failed fetch has to be cached for a while');

        Date.now = () => base + RustServerList.SERVER_LIST_RETRY_MS + 1000;
        await RustServerList.getAddress('Rustpc.uk | Casual | Gifts', { fetch });

        Assert.strictEqual(calls.count, 2);
    });
});

Test.describe('RustServerList.getConnectCommand', () => {
    Test.beforeEach(() => {
        RustServerList.resetCache();
    });

    Test.it('builds the connect command of a listed server', async () => {
        const { fetch } = stubFetch(SERVERS);

        Assert.strictEqual(await RustServerList.getConnectCommand('Rustpc.uk | Casual | Gifts', { fetch }),
            'connect 195.140.215.31:28025');
    });

    Test.it('returns null when the address is unknown', async () => {
        const { fetch } = stubFetch(SERVERS);

        Assert.strictEqual(await RustServerList.getConnectCommand('Unknown', { fetch }), null);
    });
});

Test.describe('ServerAddressHandler.fillGuildAddresses', () => {
    const addresses = {
        'Rustpc.uk | Casual | Gifts': 'connect 195.140.215.31:28025',
    };

    /* The handler reads the server list of the game in the bot, the tests replace the lookup. */
    const resolveConnect = async (title) => addresses[title] || null;

    function fakeClient(serverList) {
        const instance = { serverList };
        const written = { count: 0 };

        return {
            client: {
                getInstance: () => instance,
                setInstance: () => {
                    written.count += 1;
                },
                intlGet: (guildId, key) => key,
                log: () => undefined,
            },
            instance,
            written,
        };
    }

    Test.it('fills the connect string of a server that has none', async () => {
        const { client, instance, written } = fakeClient({
            'relay-1': { title: 'Rustpc.uk | Casual | Gifts', connect: null },
        });

        const updated = await ServerAddressHandler.fillGuildAddresses(client, 'guildId', { resolveConnect });

        Assert.deepStrictEqual(updated, ['relay-1']);
        Assert.strictEqual(instance.serverList['relay-1'].connect, 'connect 195.140.215.31:28025');
        Assert.strictEqual(written.count, 1);
    });

    Test.it('keeps a connect string that is already there', async () => {
        const { client, instance, written } = fakeClient({
            'relay-1': { title: 'Rustpc.uk | Casual | Gifts', connect: 'connect 1.2.3.4:28015' },
        });

        const updated = await ServerAddressHandler.fillGuildAddresses(client, 'guildId', { resolveConnect });

        Assert.deepStrictEqual(updated, []);
        Assert.strictEqual(instance.serverList['relay-1'].connect, 'connect 1.2.3.4:28015');
        Assert.strictEqual(written.count, 0);
    });

    Test.it('leaves a server alone that the list does not know', async () => {
        const { client, instance, written } = fakeClient({
            'relay-1': { title: 'Some unlisted server', connect: null },
        });

        const updated = await ServerAddressHandler.fillGuildAddresses(client, 'guildId', { resolveConnect });

        Assert.deepStrictEqual(updated, []);
        Assert.strictEqual(instance.serverList['relay-1'].connect, null);
        Assert.strictEqual(written.count, 0);
    });
});
