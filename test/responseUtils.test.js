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

const ResponseUtils = require('../src/util/responseUtils.js');

Test.describe('ResponseUtils.isResponseFailure', () => {
    Test.it('treats a missing response as a failure', () => {
        Assert.strictEqual(ResponseUtils.isResponseFailure(undefined), true);
        Assert.strictEqual(ResponseUtils.isResponseFailure(null), true);
    });

    Test.it('treats a thrown error as a failure', () => {
        Assert.strictEqual(ResponseUtils.isResponseFailure(new Error('timeout')), true);
    });

    Test.it('treats an AppError payload as a failure', () => {
        Assert.strictEqual(ResponseUtils.isResponseFailure({ error: 'not found' }), true);
    });

    Test.it('treats a normal response as a success', () => {
        Assert.strictEqual(ResponseUtils.isResponseFailure({ info: {} }), false);
    });
});

Test.describe('ResponseUtils.classifyResponse', () => {
    Test.it('reports a normal answer as success', () => {
        Assert.strictEqual(ResponseUtils.classifyResponse({ info: { name: 'Server' } }), 'success');
        Assert.strictEqual(ResponseUtils.classifyResponse({ seq: 8, success: {} }), 'success');
        Assert.strictEqual(ResponseUtils.classifyResponse({ flag: { value: true } }), 'success');
        Assert.strictEqual(ResponseUtils.classifyResponse({ mapMarkers: { markers: [] } }), 'success');
    });

    Test.it('reports an AppError and a thrown error as error', () => {
        Assert.strictEqual(ResponseUtils.classifyResponse({ error: 'wrong_type' }), 'error');
        Assert.strictEqual(ResponseUtils.classifyResponse(new Error('Timeout')), 'error');
    });

    /* A live server answers an unsupported request with an empty AppResponse, not with an AppError. */
    Test.it('reports an empty answer as unsupported', () => {
        Assert.strictEqual(ResponseUtils.classifyResponse({}), 'empty');
        Assert.strictEqual(ResponseUtils.classifyResponse({ seq: 4 }), 'empty');
    });

    Test.it('reports a missing answer as timeout', () => {
        Assert.strictEqual(ResponseUtils.classifyResponse(undefined), 'timeout');
        Assert.strictEqual(ResponseUtils.classifyResponse(null), 'timeout');
    });

    Test.it('reports something that is not a response as invalid', () => {
        Assert.strictEqual(ResponseUtils.classifyResponse('nope'), 'invalid');
    });
});

Test.describe('ResponseUtils.isResponseEmpty', () => {
    Test.it('detects an answer without any response field', () => {
        Assert.strictEqual(ResponseUtils.isResponseEmpty({}), true);
        Assert.strictEqual(ResponseUtils.isResponseEmpty({ seq: 1 }), true);
    });

    Test.it('does not call a real answer or an error empty', () => {
        Assert.strictEqual(ResponseUtils.isResponseEmpty({ clanChat: { messages: [] } }), false);
        Assert.strictEqual(ResponseUtils.isResponseEmpty({ error: 'x' }), false);
        Assert.strictEqual(ResponseUtils.isResponseEmpty(undefined), false);
        Assert.strictEqual(ResponseUtils.isResponseEmpty(new Error('x')), false);
    });
});

Test.describe('ResponseUtils.describeResponse', () => {
    Test.it('uses the error message for thrown errors', () => {
        Assert.strictEqual(ResponseUtils.describeResponse(new Error('boom')), 'boom');
    });

    Test.it('names the empty values explicitly', () => {
        Assert.strictEqual(ResponseUtils.describeResponse(undefined), 'undefined');
        Assert.strictEqual(ResponseUtils.describeResponse(null), 'null');
    });

    Test.it('serialises plain responses', () => {
        Assert.strictEqual(ResponseUtils.describeResponse({ a: 1 }), '{"a":1}');
    });
});
