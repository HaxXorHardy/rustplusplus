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
    util/rustplusApi.js lists the requests and broadcasts of rustplus.proto. The first test reads the proto file of the
    installed library, so a protocol field that a new library version adds cannot be forgotten unnoticed.
*/

const Assert = require('node:assert');
const Fs = require('node:fs');
const Path = require('node:path');
const Test = require('node:test');

const RustPlusApi = require('../src/util/rustplusApi.js');
const RustPlus = require('../src/structures/RustPlus.js');
const RustPlusLite = require('../src/structures/RustPlusLite.js');

const PROTO_PATH = Path.join(__dirname, '..', 'node_modules', '@liamcottle', 'rustplus.js', 'rustplus.proto');

/* The fields of AppRequest/AppBroadcast that the proto declares (the payload messages are the App* types). */
function protoFields(messageName) {
    const proto = Fs.readFileSync(PROTO_PATH, 'utf8');
    const start = proto.indexOf(`message ${messageName} {`);
    Assert.ok(start >= 0, `message ${messageName} not found in the proto`);

    const end = proto.indexOf('\n}', start);
    const body = proto.slice(start, end);
    const fields = [];

    for (const line of body.split('\n')) {
        /* A request is a message-typed field (AppEmpty, AppSendMessage, ...); seq/playerId/entityId are payload. */
        const match = line.trim().match(/^(?:optional|repeated)\s+(App\w+)\s+(\w+)\s*=\s*(\d+);/);
        if (match) fields.push(match[2]);
    }

    return fields;
}

Test.describe('RustPlusApi protocol table', () => {
    Test.it('lists every request of the proto', () => {
        const proto = protoFields('AppRequest').sort();
        const table = RustPlusApi.listRequests().sort();

        Assert.deepStrictEqual(table, proto);
    });

    Test.it('lists every broadcast of the proto', () => {
        const proto = protoFields('AppBroadcast').sort();
        const table = RustPlusApi.listBroadcasts().sort();

        Assert.deepStrictEqual(table, proto);
    });

    Test.it('builds a request message', () => {
        Assert.deepStrictEqual(RustPlusApi.buildRequest('getClanChat'), { getClanChat: {} });
        Assert.deepStrictEqual(RustPlusApi.buildRequest('sendClanMessage', { message: 'hi' }),
            { sendClanMessage: { message: 'hi' } });
    });

    Test.it('refuses a request it does not know', () => {
        Assert.throws(() => RustPlusApi.buildRequest('doesNotExist'), /Unknown Rust\+ request/);
        Assert.strictEqual(RustPlusApi.isKnownRequest('doesNotExist'), false);
    });

    Test.it('knows the response field of every request', () => {
        for (const name of RustPlusApi.listRequests()) {
            Assert.strictEqual(RustPlusApi.getResponseKey(name), RustPlusApi.REQUESTS[name].response);
            Assert.ok(typeof (RustPlusApi.getResponseKey(name)) === 'string');
        }
    });

    /*
        Every request of the protocol is reachable through the generic method, so a feature can use a request that has no
        named wrapper (yet) without touching the transport.
    */
    Test.it('offers a generic request method on both instances', () => {
        Assert.strictEqual(typeof (RustPlus.prototype.apiRequestAsync), 'function');
        Assert.strictEqual(typeof (RustPlusLite.prototype.apiRequestAsync), 'function');

        for (const name of RustPlusApi.listRequests()) {
            Assert.deepStrictEqual(RustPlusApi.buildRequest(name), { [name]: {} });
        }
    });

    Test.it('has a named wrapper for the clan and nexus requests', () => {
        for (const method of ['getClanChatAsync', 'setClanMotdAsync', 'getNexusAuthAsync']) {
            Assert.strictEqual(typeof (RustPlus.prototype[method]), 'function', `${method} is missing`);
        }
    });
});
