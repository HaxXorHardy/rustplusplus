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

const AtomicWriteFile = require('../src/util/atomicWriteFile.js');

function makeTempDirectory(t) {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-atomic-'));
    t.after(() => Fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

Test.describe('atomicWriteFile', () => {
    Test.it('writes the file content', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        AtomicWriteFile(target, JSON.stringify({ a: 1 }));

        Assert.strictEqual(Fs.readFileSync(target, 'utf8'), '{"a":1}');
    });

    Test.it('leaves no temporary file behind', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        AtomicWriteFile(target, 'payload');

        Assert.deepStrictEqual(Fs.readdirSync(directory), ['instance.json']);
    });

    Test.it('creates the directory of the target when it is missing', (t) => {
        const directory = makeTempDirectory(t);
        /* `credentials` and `instances` are not part of the repository, a fresh installation starts without them. */
        const target = Path.join(directory, 'credentials', 'rustplusAuth', 'steam.json');

        AtomicWriteFile(target, 'payload');

        Assert.strictEqual(Fs.readFileSync(target, 'utf8'), 'payload');
    });

    Test.it('replaces existing content instead of appending', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        AtomicWriteFile(target, 'first');
        AtomicWriteFile(target, 'second');

        Assert.strictEqual(Fs.readFileSync(target, 'utf8'), 'second');
    });
});

Test.describe("atomicWriteFile mode", () => {
    Test.it("creates the file with the given mode", { skip: process.platform === 'win32' }, (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'token.json');

        AtomicWriteFile(target, '{"token":"x"}', 'utf8', 0o600);

        Assert.strictEqual(Fs.statSync(target).mode & 0o777, 0o600);
    });

    Test.it("does not reuse a leftover temporary file with wider permissions", { skip: process.platform === 'win32' }, (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'token.json');

        /* The fixed name of older versions, left behind by a crash. */
        Fs.writeFileSync(`${target}.tmp`, 'old', { mode: 0o644 });

        AtomicWriteFile(target, '{"token":"x"}', 'utf8', 0o600);

        Assert.strictEqual(Fs.statSync(target).mode & 0o777, 0o600);
        Assert.strictEqual(Fs.readFileSync(target, 'utf8'), '{"token":"x"}');
    });
});

Test.describe('atomicWriteFile failures', () => {
    Test.it('retries a rename that Windows refused for a moment', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        const original = Fs.renameSync;
        let calls = 0;
        Fs.renameSync = (from, to) => {
            calls += 1;
            if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
            return original(from, to);
        };
        t.after(() => { Fs.renameSync = original; });

        AtomicWriteFile(target, 'payload');

        Assert.strictEqual(calls, 3);
        Assert.strictEqual(Fs.readFileSync(target, 'utf8'), 'payload');
        Assert.deepStrictEqual(Fs.readdirSync(directory), ['instance.json']);
    });

    Test.it('removes the temporary file when the rename keeps failing', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        const original = Fs.renameSync;
        Fs.renameSync = () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); };
        t.after(() => { Fs.renameSync = original; });

        Assert.throws(() => AtomicWriteFile(target, 'payload'), /denied/);
        Assert.deepStrictEqual(Fs.readdirSync(directory), []);
    });

    Test.it('does not retry other errors', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        const original = Fs.renameSync;
        let calls = 0;
        Fs.renameSync = () => {
            calls += 1;
            throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
        };
        t.after(() => { Fs.renameSync = original; });

        Assert.throws(() => AtomicWriteFile(target, 'payload'), /no space/);
        Assert.strictEqual(calls, 1);
        Assert.deepStrictEqual(Fs.readdirSync(directory), []);
    });

    Test.it('uses a different temporary file for every write', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        const original = Fs.renameSync;
        const temps = [];
        Fs.renameSync = (from, to) => {
            temps.push(from);
            return original(from, to);
        };
        t.after(() => { Fs.renameSync = original; });

        AtomicWriteFile(target, 'first');
        AtomicWriteFile(target, 'second');

        Assert.strictEqual(temps.length, 2);
        Assert.notStrictEqual(temps[0], temps[1]);
        Assert.ok(temps.every((e) => e.startsWith(`${target}.${process.pid}.`)));
    });
});
