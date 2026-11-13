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
    The bot starts with plain node. It used to start with `ts-node`, which type-checked the whole project on every boot:
    `allowJs` pulled all 825 files of the program into the compiler, which cost ~1 GB of memory, 20+ s of startup time
    and kept the TypeScript program in memory for the whole runtime. The type check belongs into `npm test`/CI, not into
    the boot of a container - these assertions keep it that way.
*/

const Assert = require('node:assert');
const Fs = require('node:fs');
const Path = require('node:path');
const Test = require('node:test');

const Package = require('../package.json');

const ROOT = Path.join(__dirname, '..');

Test.describe('startup configuration', () => {
    Test.it('starts the bot with plain node', () => {
        Assert.strictEqual(Package.scripts.start, 'node .');
        Assert.strictEqual(Package.main, 'index.js');
        Assert.ok(Fs.existsSync(Path.join(ROOT, 'index.js')), 'index.js is missing');
    });

    Test.it('has no TypeScript entry file left', () => {
        Assert.strictEqual(Fs.existsSync(Path.join(ROOT, 'index.ts')), false);
    });

    /* The toolchain stays available for `npm test` and the editor, but must not be installed in the image. */
    Test.it('keeps ts-node and typescript out of the runtime dependencies', () => {
        Assert.ok(Package.devDependencies['ts-node'], 'ts-node is not a dev dependency');
        Assert.strictEqual(Package.dependencies['ts-node'], undefined);
        Assert.strictEqual(Package.dependencies['typescript'], undefined);
    });

    Test.it('installs the runtime dependencies only in the image', () => {
        const dockerfile = Fs.readFileSync(Path.join(ROOT, 'Dockerfile'), 'utf8');

        Assert.match(dockerfile, /npm install --omit=dev/);
        Assert.doesNotMatch(dockerfile, /ts-node/);
    });
});
