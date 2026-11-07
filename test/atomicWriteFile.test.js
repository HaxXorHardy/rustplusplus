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

    Test.it('replaces existing content instead of appending', (t) => {
        const directory = makeTempDirectory(t);
        const target = Path.join(directory, 'instance.json');

        AtomicWriteFile(target, 'first');
        AtomicWriteFile(target, 'second');

        Assert.strictEqual(Fs.readFileSync(target, 'utf8'), 'second');
    });
});
