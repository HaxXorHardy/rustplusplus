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

const RustPlusLogin = require('../src/util/rustplusLogin.js');

Test.describe('RustPlusLogin.parseSyncPayload', () => {
    Test.it('extracts id, name and player token of every server', () => {
        const payload = JSON.stringify({
            currentServerId: 'uuid-1',
            servers: [
                { id: 'uuid-1', name: 'Server One', playerToken: 1234, map: '051126' },
                { id: 'uuid-2', name: 'Server Two', playerToken: 5678 },
            ],
        });

        Assert.deepStrictEqual(RustPlusLogin.parseSyncPayload(payload), [
            { id: 'uuid-1', name: 'Server One', playerToken: 1234 },
            { id: 'uuid-2', name: 'Server Two', playerToken: 5678 },
        ]);
    });

    Test.it('accepts an already parsed payload and empty data', () => {
        Assert.deepStrictEqual(RustPlusLogin.parseSyncPayload({ servers: [] }), []);
        Assert.deepStrictEqual(RustPlusLogin.parseSyncPayload(null), []);
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
