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
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const Test = require('node:test');

const RustPlusAuth = require('../src/util/rustplusAuth.js');
const RustPlusLogin = require('../src/util/rustplusLogin.js');

/* Account token with a known expiry (1795255624), the refresh token below is only a marker. */
const TOKEN = 'eyJzdGVhbUlkIjoiNzY1NjExOTgwMDAwMDAwMDAiLCJleHAiOjE3OTUyNTU2MjR9.c2lnbmF0dXJlLXNpZ25hdHVyZQ==';

/* The stored logins go to a temporary directory, never into the real credentials of a local bot. */
function useTempAuthDir(t) {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-login-'));
    RustPlusAuth.setAuthDir(directory);
    t.after(() => {
        RustPlusAuth.setAuthDir(null);
        Fs.rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}

Test.describe('RustPlusLogin.storeAuth', () => {
    const STEAM_ID = '76561198000000001';

    Test.beforeEach((t) => {
        useTempAuthDir(t);
    });

    Test.it('stores the token, the servers and the Steam refresh token', () => {
        const servers = [{ id: 'uuid-1', name: 'Server One', playerToken: 1234 }];

        const auth = RustPlusLogin.storeAuth(STEAM_ID, TOKEN, servers, 'steam-refresh-token');

        Assert.strictEqual(auth.steamId, STEAM_ID);
        Assert.strictEqual(auth.token, TOKEN);
        Assert.strictEqual(auth.tokenExpiresAt, 1795255624);
        Assert.strictEqual(auth.steamRefreshToken, 'steam-refresh-token');
        Assert.deepStrictEqual(auth.servers, servers);

        const stored = RustPlusAuth.readAuth(STEAM_ID);
        Assert.strictEqual(stored.steamRefreshToken, 'steam-refresh-token');
        Assert.deepStrictEqual(stored.servers, servers);
    });

    Test.it('keeps an already stored refresh token when none is passed in', () => {
        RustPlusLogin.storeAuth(STEAM_ID, TOKEN, [], 'first-refresh-token');

        const auth = RustPlusLogin.storeAuth(STEAM_ID, TOKEN, []);

        Assert.strictEqual(auth.steamRefreshToken, 'first-refresh-token');
    });

    Test.it('does not write an empty refresh token', () => {
        const auth = RustPlusLogin.storeAuth(STEAM_ID, TOKEN, []);

        Assert.strictEqual('steamRefreshToken' in auth, false);
    });
});

Test.describe('RustPlusLogin.renewAuth', () => {
    Test.it('needs a stored login and a stored refresh token', async (t) => {
        useTempAuthDir(t);
        const steamId = '76561198000000002';

        await Assert.rejects(() => RustPlusLogin.renewAuth(steamId), /No stored Rust\+ login/);

        /* A login file without refresh token cannot be renewed (only a new login can). */
        RustPlusLogin.storeAuth(steamId, TOKEN, []);
        await Assert.rejects(() => RustPlusLogin.renewAuth(steamId), /No Steam refresh token stored/);
    });

    Test.it('reports a refresh token Steam does not accept', async (t) => {
        useTempAuthDir(t);
        const steamId = '76561198000000003';

        RustPlusLogin.storeAuth(steamId, TOKEN, [], 'not-a-jwt');

        /* The steam-session setter validates the token, so a broken file fails fast. */
        await Assert.rejects(() => RustPlusLogin.renewAuth(steamId), /Invalid JWT/);
    });
});

Test.describe('RustPlusLogin.renewAuth (revoked meanwhile)', () => {
    const SteamSession = require('steam-session');
    const STEAM_ID = '76561198000000004';
    const NEW_TOKEN = 'bmV3LXRva2VuLXBheWxvYWQtcGF5bG9hZA.c2lnbmF0dXJl';

    /* No network: Steam, the Rust+ login and the account state are replaced, renewAuth itself stays real. */
    function stubRenewal(t, onSync = () => undefined) {
        const original = {
            LoginSession: SteamSession.LoginSession,
            loginToRustPlus: RustPlusLogin.loginToRustPlus,
            fetchSyncData: RustPlusLogin.fetchSyncData,
        };

        SteamSession.LoginSession = class {
            async getWebCookies() {
                return ['steamLoginSecure=abc'];
            }
        };
        RustPlusLogin.loginToRustPlus = async () => ({ steamId: STEAM_ID, token: NEW_TOKEN });
        RustPlusLogin.fetchSyncData = async () => {
            onSync();
            return { currentServerId: null, servers: [] };
        };

        t.after(() => {
            SteamSession.LoginSession = original.LoginSession;
            RustPlusLogin.loginToRustPlus = original.loginToRustPlus;
            RustPlusLogin.fetchSyncData = original.fetchSyncData;
        });
    }

    Test.it('stores the renewed token of an account that is still registered', async (t) => {
        useTempAuthDir(t);
        RustPlusLogin.storeAuth(STEAM_ID, TOKEN, [], 'refresh');
        stubRenewal(t);

        const auth = await RustPlusLogin.renewAuth(STEAM_ID, undefined, { isRegistered: () => true });

        Assert.strictEqual(auth.token, NEW_TOKEN);
        Assert.strictEqual(RustPlusAuth.readAuth(STEAM_ID).token, NEW_TOKEN);
    });

    Test.it('discards the token of an account no guild lists anymore', async (t) => {
        useTempAuthDir(t);
        RustPlusLogin.storeAuth(STEAM_ID, TOKEN, [], 'refresh');
        stubRenewal(t);

        await Assert.rejects(() => RustPlusLogin.renewAuth(STEAM_ID, undefined, { isRegistered: () => false }),
            (e) => e.code === RustPlusLogin.RENEWAL_DISCARDED);
        Assert.strictEqual(RustPlusAuth.readAuth(STEAM_ID).token, TOKEN);
    });

    Test.it('does not recreate a login that was revoked while the renewal ran', async (t) => {
        useTempAuthDir(t);
        RustPlusLogin.storeAuth(STEAM_ID, TOKEN, [], 'refresh');
        stubRenewal(t, () => RustPlusAuth.removeAuth(STEAM_ID));

        await Assert.rejects(() => RustPlusLogin.renewAuth(STEAM_ID, undefined, { isRegistered: () => true }),
            (e) => e.code === RustPlusLogin.RENEWAL_DISCARDED);
        Assert.strictEqual(RustPlusAuth.readAuth(STEAM_ID), null);
    });
});

Test.describe('RustPlusLogin.SteamLogin', () => {
    const SteamSession = require('steam-session');
    const Guard = SteamSession.EAuthSessionGuardType;

    /* No network: the login start is stubbed, the guard handling below stays the real code. */
    function createFlow(validActions = []) {
        const flow = new RustPlusLogin.SteamLogin({ accountName: 'name', password: 'secret', timeoutMs: 1234 });
        flow.session.startWithCredentials = async () => ({
            actionRequired: validActions.length > 0,
            validActions: validActions,
        });

        return flow;
    }

    Test.it('uses the steam-session api that is installed', () => {
        const flow = createFlow();

        Assert.strictEqual(flow.session.loginTimeout, 1234);
        Assert.strictEqual(typeof flow.session.startWithCredentials, 'function');
        Assert.strictEqual(typeof flow.session.submitSteamGuardCode, 'function');
        Assert.strictEqual(typeof flow.session.getWebCookies, 'function');
    });

    Test.it('reports the Steam Guard that is needed', async () => {
        Assert.deepStrictEqual(await createFlow([{ type: Guard.EmailCode, detail: 'gmail.com' }]).start(), {
            types: ['emailCode'],
            type: 'emailCode',
            detail: 'gmail.com',
        });
        Assert.deepStrictEqual(await createFlow([{ type: Guard.DeviceCode }]).start(), {
            types: ['deviceCode'],
            type: 'deviceCode',
            detail: null,
        });
        Assert.deepStrictEqual(await createFlow([{ type: Guard.DeviceConfirmation }]).start(), {
            types: ['deviceConfirmation'],
            type: 'deviceConfirmation',
            detail: null,
        });
        Assert.deepStrictEqual(await createFlow([{ type: Guard.EmailConfirmation }]).start(), {
            types: ['emailConfirmation'],
            type: 'emailConfirmation',
            detail: null,
        });
        Assert.strictEqual(await createFlow([]).start(), null);
    });

    Test.it('prefers the device authorization when Steam offers several ways', async () => {
        const guard = await createFlow([
            { type: Guard.EmailCode, detail: 'gmail.com' },
            { type: Guard.DeviceConfirmation },
        ]).start();

        Assert.deepStrictEqual(guard.types, ['deviceConfirmation', 'emailCode']);
        Assert.strictEqual(guard.type, 'deviceConfirmation');
        /* The e-mail domain stays available for the code fallback. */
        Assert.strictEqual(guard.detail, 'gmail.com');
    });

    Test.it('does not report a code action as e-mail code by accident', async () => {
        const guard = await createFlow([{ type: Guard.DeviceConfirmation }, { type: Guard.EmailConfirmation }]).start();

        Assert.deepStrictEqual(guard.types, ['deviceConfirmation', 'emailConfirmation']);
    });

    Test.it('rejects guards it cannot handle', async () => {
        await Assert.rejects(() => createFlow([{ type: Guard.MachineToken }]).start(),
            /Unsupported Steam Guard action/);
    });

    Test.it('strips whitespace from the guard code', async () => {
        const flow = createFlow([{ type: Guard.DeviceCode }]);
        let submitted = null;
        flow.session.submitSteamGuardCode = async (code) => {
            submitted = code;
        };

        await flow.submitCode(' 1 2 3 4 5 ');
        Assert.strictEqual(submitted, '12345');
    });

    Test.it('forces a poll for the app confirmation without throwing', () => {
        const flow = createFlow();

        let polled = 0;
        flow.session.forcePoll = () => {
            polled++;
        };

        flow.forcePoll();
        Assert.strictEqual(polled, 1);

        /* A session that is not polling yet must not make the bot fail. */
        flow.session.forcePoll = () => {
            throw new Error('Session is not polling');
        };
        Assert.doesNotThrow(() => flow.forcePoll());
    });
});
