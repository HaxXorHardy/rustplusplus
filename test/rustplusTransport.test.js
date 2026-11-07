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

const RustPlusTransport = require('../src/util/rustplusTransport.js');

Test.describe('RustPlusTransport.normalizeMode', () => {
    Test.it('defaults to auto', () => {
        Assert.strictEqual(RustPlusTransport.normalizeMode(undefined), RustPlusTransport.MODES.AUTO);
        Assert.strictEqual(RustPlusTransport.normalizeMode(null), RustPlusTransport.MODES.AUTO);
        Assert.strictEqual(RustPlusTransport.normalizeMode(''), RustPlusTransport.MODES.AUTO);
        Assert.strictEqual(RustPlusTransport.normalizeMode('garbage'), RustPlusTransport.MODES.AUTO);
    });

    Test.it('accepts the mode names and the boolean spellings', () => {
        Assert.strictEqual(RustPlusTransport.normalizeMode('DIRECT'), RustPlusTransport.MODES.DIRECT);
        Assert.strictEqual(RustPlusTransport.normalizeMode('false'), RustPlusTransport.MODES.DIRECT);
        Assert.strictEqual(RustPlusTransport.normalizeMode('proxy'), RustPlusTransport.MODES.PROXY);
        Assert.strictEqual(RustPlusTransport.normalizeMode(' true '), RustPlusTransport.MODES.PROXY);
    });
});

Test.describe('RustPlusTransport.shouldUseFacepunchProxy', () => {
    Test.it('forces the configured transport', () => {
        Assert.strictEqual(RustPlusTransport.shouldUseFacepunchProxy('proxy', 0), true);
        Assert.strictEqual(RustPlusTransport.shouldUseFacepunchProxy('direct', 99), false);
    });

    Test.it('falls back to the proxy only after the configured number of failed direct attempts', () => {
        const threshold = RustPlusTransport.DIRECT_FAILURES_BEFORE_PROXY;

        Assert.strictEqual(RustPlusTransport.shouldUseFacepunchProxy('auto', 0), false);
        Assert.strictEqual(RustPlusTransport.shouldUseFacepunchProxy('auto', threshold - 1), false);
        Assert.strictEqual(RustPlusTransport.shouldUseFacepunchProxy('auto', threshold), true);
        Assert.strictEqual(RustPlusTransport.shouldUseFacepunchProxy('auto', threshold + 5), true);
    });
});

Test.describe('RustPlusTransport.isConnectionFailure', () => {
    Test.it('recognises the network errors of an unreachable endpoint', () => {
        for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
            const error = new Error(code);
            error.code = code;
            Assert.strictEqual(RustPlusTransport.isConnectionFailure(error), true);
        }
    });

    Test.it('ignores other errors', () => {
        Assert.strictEqual(RustPlusTransport.isConnectionFailure(new Error('socket hang up')), false);
        Assert.strictEqual(RustPlusTransport.isConnectionFailure(undefined), false);
        Assert.strictEqual(RustPlusTransport.isConnectionFailure({ error: 'not_found' }), false);
    });
});

Test.describe('RustPlusTransport.describeEndpoint', () => {
    Test.it('names the direct websocket', () => {
        Assert.strictEqual(RustPlusTransport.describeEndpoint('1.2.3.4', '28082', false),
            'direct ws://1.2.3.4:28082');
    });

    Test.it('names the Facepunch proxy', () => {
        Assert.strictEqual(RustPlusTransport.describeEndpoint('1.2.3.4', '28082', true),
            'Facepunch proxy companion-rust.facepunch.com/game/1.2.3.4/28082');
    });
});

Test.describe('RustPlusTransport authenticated socket', () => {
    Test.it('builds the url of the Rust+ app websocket', () => {
        Assert.strictEqual(RustPlusTransport.buildSocketUrl('6f2a1c3d-4b5e-4978-8a9b-0c1d2e3f4a5b'),
            'wss://companion-rust.facepunch.com/socket/6f2a1c3d-4b5e-4978-8a9b-0c1d2e3f4a5b?v=1792502454122');
        Assert.strictEqual(RustPlusTransport.buildSocketUrl('uuid', '42'),
            'wss://companion-rust.facepunch.com/socket/uuid?v=42');
    });

    Test.it('sends the account token as second subprotocol', () => {
        const protocols = RustPlusTransport.buildSocketProtocols('payload.signature');

        Assert.strictEqual(protocols.length, 2);
        Assert.strictEqual(protocols[0], 'rustplus.auth.v1');
        Assert.strictEqual(protocols[1], Buffer.from('payload.signature', 'utf8').toString('base64url'));
    });

    Test.it('reads the expiry date out of the token payload', () => {
        const payload = Buffer.from(JSON.stringify({ steamId: '765', exp: 1795255624 })).toString('base64');

        Assert.strictEqual(RustPlusTransport.getAuthTokenExpiry(`${payload}.signature`), 1795255624);
        Assert.strictEqual(RustPlusTransport.getAuthTokenExpiry('not-a-token'), null);
        Assert.strictEqual(RustPlusTransport.getAuthTokenExpiry(null), null);
    });

    Test.it('sends the origin of the Rust+ web app', () => {
        Assert.strictEqual(RustPlusTransport.SOCKET_ORIGIN, 'https://app.playrust.com');
        Assert.strictEqual(RustPlusTransport.describeSocketEndpoint('uuid'),
            'authenticated wss://companion-rust.facepunch.com/socket/uuid?v=1792502454122');
    });
});

Test.describe('RustPlusTransport.isRelayAddress', () => {
    Test.it('recognises a server entry that is keyed by its pairing id', () => {
        Assert.strictEqual(RustPlusTransport.isRelayAddress('relay'), true);
        Assert.strictEqual(RustPlusTransport.isRelayAddress(' relay '), true);
        Assert.strictEqual(RustPlusTransport.isRelayAddress('RELAY'), true);
    });

    Test.it('keeps real addresses on the library transports', () => {
        Assert.strictEqual(RustPlusTransport.isRelayAddress('91.229.114.90'), false);
        Assert.strictEqual(RustPlusTransport.isRelayAddress('rust.example.com'), false);
        Assert.strictEqual(RustPlusTransport.isRelayAddress(undefined), false);
        Assert.strictEqual(RustPlusTransport.isRelayAddress(null), false);
    });

    Test.it('uses the same key as the instance file', () => {
        Assert.strictEqual(RustPlusTransport.RELAY_SERVER_IP, 'relay');
    });
});