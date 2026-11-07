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
const Test = require('node:test');

const RustPlusAuth = require('../src/util/rustplusAuth.js');

const STEAM_ID = '900000000000000002';

function tokenPayload(data) {
    return `${Buffer.from(JSON.stringify(data)).toString('base64')}.signature`;
}

Test.describe('RustPlusAuth', () => {
    Test.afterEach(() => {
        const path = RustPlusAuth.getAuthFilePath(STEAM_ID);
        if (Fs.existsSync(path)) Fs.unlinkSync(path);
    });

    Test.it('stores and reads the account token', () => {
        RustPlusAuth.writeAuth(STEAM_ID, { steamId: STEAM_ID, token: 'payload.signature', servers: [] });

        const auth = RustPlusAuth.readAuth(STEAM_ID);
        Assert.strictEqual(auth.steamId, STEAM_ID);
        Assert.strictEqual(auth.token, 'payload.signature');
    });

    Test.it('returns null when no token is stored', () => {
        Assert.strictEqual(RustPlusAuth.readAuth('123'), null);
        Assert.strictEqual(RustPlusAuth.readAuth(null), null);
    });

    Test.it('resolves the server id by server name', () => {
        const auth = { servers: [{ id: 'uuid-1', name: "Captain's Quarters | Bi-weekly" }, { id: 'uuid-2', name: 'Other' }] };

        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, "Captain's Quarters | Bi-weekly"), 'uuid-1');
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, "  captain's quarters | bi-weekly "), 'uuid-1');
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, 'unknown'), null);
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(null, 'anything'), null);
    });

    Test.it('detects expired tokens', () => {
        Assert.strictEqual(RustPlusAuth.isTokenExpired({ token: tokenPayload({ exp: 100 }) }, 200), true);
        Assert.strictEqual(RustPlusAuth.isTokenExpired({ token: tokenPayload({ exp: 300 }) }, 200), false);
        Assert.strictEqual(RustPlusAuth.isTokenExpired({ token: tokenPayload({ exp: 300 }), tokenExpiresAt: 100 }, 200),
            true);
        Assert.strictEqual(RustPlusAuth.isTokenExpired(null), false);
    });

    Test.it('knows when the token has to be renewed', () => {
        const auth = { token: tokenPayload({ exp: 1000 }) };

        Assert.strictEqual(RustPlusAuth.getTokenExpiry(auth), 1000);
        Assert.strictEqual(RustPlusAuth.getTokenExpiry({ token: 'x', tokenExpiresAt: 5 }), 5);
        Assert.strictEqual(RustPlusAuth.getTokenExpiry(null), null);

        Assert.strictEqual(RustPlusAuth.isTokenExpiringSoon(auth, 100, 950), true);    /* 50s left */
        Assert.strictEqual(RustPlusAuth.isTokenExpiringSoon(auth, 100, 800), false);   /* 200s left */
        Assert.strictEqual(RustPlusAuth.isTokenExpiringSoon(auth, 100, 1200), true);   /* expired */
        Assert.strictEqual(RustPlusAuth.isTokenExpiringSoon(null, 100, 0), false);
        Assert.strictEqual(RustPlusAuth.isTokenExpiringSoon({ token: 'not-a-token' }, 100, 0), false);
    });
});

Test.describe("RustPlusAuth.resolveServerGuid (pairing token)", () => {
    const auth = {
        servers: [
            { id: 'uuid-1', name: "Captain's Quarters", playerToken: 111 },
            { id: 'uuid-2', name: "Captain's Quarters", playerToken: 222 },
            { id: 'uuid-3', name: 'Renamed Server', playerToken: 333 },
        ],
    };

    Test.it("picks the server by its pairing token, not by the name", () => {
        const server = { title: "Captain's Quarters", playerToken: 222 };
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, server), 'uuid-2');
    });

    Test.it("resolves a renamed server", () => {
        const server = { title: 'Old Name', playerToken: 333 };
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, server), 'uuid-3');
    });

    Test.it("falls back to the name when the token is unknown", () => {
        const server = { title: 'Renamed Server', playerToken: 999 };
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, server), 'uuid-3');
    });

    Test.it("still accepts a plain title", () => {
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, 'Renamed Server'), 'uuid-3');
        Assert.strictEqual(RustPlusAuth.resolveServerGuid(auth, 'nothing'), null);
    });
});
