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

const RuntimeDataStorage = require('../src/util/storage/RuntimeDataStorage.js');

Test.describe('runtime data storage', () => {
    let dataPath = null;
    let storage = null;

    Test.beforeEach(() => {
        dataPath = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-runtime-'));
        storage = new RuntimeDataStorage({ dataPath });
    });

    Test.afterEach(() => {
        storage.close();
        Fs.rmSync(dataPath, { recursive: true, force: true });
    });

    /* Without them a concurrent reader (backup, sqlite3 shell) made writes fail with SQLITE_BUSY at once. */
    Test.it('opens the database in WAL mode with a busy timeout', () => {
        Assert.strictEqual(storage.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
        Assert.strictEqual(storage.db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    });

    Test.it('stores and reads a server state', () => {
        storage.setServerState('g', 's', 'k', { a: 1 });
        Assert.deepStrictEqual(storage.getServerState('g', 's', 'k'), { a: 1 });
    });
});
