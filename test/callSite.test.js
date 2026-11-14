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
    The same log line ("Response contain error property with value: not_found.") came from a dozen rounds, and the
    console could not tell them apart. The call site names the file and the line of the caller.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const CallSite = require('../src/util/callSite.js');

function stack(...frames) {
    return ['Error', ...frames].join('\n');
}

Test.describe('CallSite.format', () => {
    Test.it('returns the first frame outside the skipped files', () => {
        const value = stack(
            '    at RustPlus.isResponseValid (/app/src/structures/RustPlus.js:1525:21)',
            '    at async Object.handler (/app/src/handlers/smartAlarmHandler.js:48:37)',
            '    at async Promise.all (index 0)',
        );

        Assert.strictEqual(CallSite.format(value, ['RustPlus.js']), 'smartAlarmHandler.js:48');
    });

    Test.it('skips a windows path of the same module', () => {
        const value = stack(
            '    at RustPlus.isResponseValid (C:\\app\\src\\structures\\RustPlus.js:1525:21)',
            '    at async Object.handler (C:\\app\\src\\handlers\\smartSwitchHandler.js:50:41)',
        );

        Assert.strictEqual(CallSite.format(value, ['RustPlus.js']), 'smartSwitchHandler.js:50');
    });

    Test.it('reads a file url frame', () => {
        const value = stack('    at async file:///app/src/rustplusEvents/connected.js:101:9');

        Assert.strictEqual(CallSite.format(value, []), 'connected.js:101');
    });

    Test.it('returns null when every frame is skipped', () => {
        const value = stack('    at RustPlus.isResponseValid (/app/src/structures/RustPlus.js:1525:21)');

        Assert.strictEqual(CallSite.format(value, ['RustPlus.js']), null);
    });

    Test.it('returns null without a stack', () => {
        Assert.strictEqual(CallSite.format(undefined, []), null);
        Assert.strictEqual(CallSite.format('', []), null);
        Assert.strictEqual(CallSite.format('Error', []), null);
    });

    Test.it('names the caller of the function that asks', () => {
        function caller() {
            return CallSite.describe(['callSite.js']);
        }

        /* The frame of this test file is the caller. */
        Assert.match(caller(), /callSite\.test\.js:\d+$/);
    });
});
