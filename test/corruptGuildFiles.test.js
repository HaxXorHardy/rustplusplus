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

const InstanceUtils = require('../src/util/instanceUtils.js');

/* A corrupt instance or credentials file stopped the startup of every guild (ready.js threw on it). */
Test.describe('corrupt guild files', () => {
    let directory = null;

    Test.beforeEach(() => {
        directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-corrupt-'));
    });

    Test.afterEach(() => {
        Fs.rmSync(directory, { recursive: true, force: true });
    });

    Test.it('moves a file that is not valid JSON aside with a timestamp', () => {
        const path = Path.join(directory, '1.json');
        Fs.writeFileSync(path, '{"firstTime": tr');

        const target = InstanceUtils.quarantineCorruptJsonFile(path, new Date('2026-11-26T10:20:30.400Z'));

        Assert.strictEqual(target, `${path}.corrupt-2026-11-26T10-20-30-400Z`);
        Assert.strictEqual(Fs.existsSync(path), false);
        Assert.strictEqual(Fs.readFileSync(target, 'utf8'), '{"firstTime": tr');
    });

    Test.it('leaves a valid file alone', () => {
        const path = Path.join(directory, '2.json');
        Fs.writeFileSync(path, '{"hoster": null}');

        Assert.strictEqual(InstanceUtils.quarantineCorruptJsonFile(path), null);
        Assert.strictEqual(Fs.readFileSync(path, 'utf8'), '{"hoster": null}');
    });

    Test.it('ignores a file that does not exist', () => {
        Assert.strictEqual(InstanceUtils.quarantineCorruptJsonFile(Path.join(directory, 'missing.json')), null);
    });

    Test.it('moves an empty file aside, it is what a crash during a write leaves behind', () => {
        const path = Path.join(directory, '3.json');
        Fs.writeFileSync(path, '');

        Assert.notStrictEqual(InstanceUtils.quarantineCorruptJsonFile(path), null);
        Assert.strictEqual(Fs.existsSync(path), false);
    });
});
