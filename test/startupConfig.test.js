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

        Assert.match(dockerfile, /npm ci --omit=dev/);
        Assert.doesNotMatch(dockerfile, /ts-node/);
    });

    /* npm as PID 1 did not forward SIGTERM: docker stop killed the bot after 10 s without a clean shutdown. */
    Test.it('runs node directly as the unprivileged node user', () => {
        const dockerfile = Fs.readFileSync(Path.join(ROOT, 'Dockerfile'), 'utf8');
        const dockerLines = dockerfile.split(/\r?\n/);
        Assert.ok(dockerLines.includes('CMD ["node", "index.js"]'), 'CMD must start node directly');
        Assert.ok(dockerLines.includes('USER node'), 'the image must run as the node user');
        Assert.ok(dockerfile.indexOf('USER node') < dockerfile.indexOf('VOLUME ['), 'USER must come before VOLUME');
        Assert.match(dockerfile, /--no-install-recommends/);
        Assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists/);
    });

    Test.it('keeps the local scraper output out of the build context', () => {
        const dockerignore = Fs.readFileSync(Path.join(ROOT, '.dockerignore'), 'utf8').split(/\r?\n/);

        Assert.ok(dockerignore.includes('scripts/rustlabs/'));
    });
});

Test.describe('integer environment variables', () => {
    const Config = require('../config');

    const parse = (raw, fallback = 10000, min = 1000) => {
        const warnings = [];
        const value = Config.envInt('RPP_TEST', fallback, min, { RPP_TEST: raw }, (text) => warnings.push(text));
        return { value, warnings };
    };

    Test.it('accepts a plain integer', () => {
        Assert.deepStrictEqual(parse('15000'), { value: 15000, warnings: [] });
        Assert.deepStrictEqual(parse(' 2000 '), { value: 2000, warnings: [] });
    });

    Test.it('uses the default without a warning when the variable is unset or empty', () => {
        Assert.deepStrictEqual(parse(undefined), { value: 10000, warnings: [] });
        Assert.deepStrictEqual(parse('  '), { value: 10000, warnings: [] });
    });

    /* parseInt read `10s` as 10: a 10 ms polling interval. */
    Test.it('rejects values with a unit or a fraction', () => {
        for (const raw of ['10s', '1.5e3x', '2500.5', 'abc']) {
            const result = parse(raw);
            Assert.strictEqual(result.value, 10000, raw);
            Assert.strictEqual(result.warnings.length, 1, raw);
        }
    });

    Test.it('rejects values below the minimum of the field', () => {
        for (const raw of ['0', '-5', '999']) {
            const result = parse(raw);
            Assert.strictEqual(result.value, 10000, raw);
            Assert.match(result.warnings[0], /RPP_TEST/);
        }

        Assert.deepStrictEqual(parse('0', 60, 0), { value: 0, warnings: [] });
    });

    Test.it('keeps every interval of the configuration at one second or more', () => {
        for (const [key, value] of Object.entries(Config.general)) {
            if (/IntervalMs$|IntervalMaxMs$/.test(key)) Assert.ok(value >= 1000, `${key} = ${value}`);
        }
    });
});
