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

const Crypto = require('crypto');
const Fs = require('fs');
const Path = require('path');

/* Windows: a virus scanner or the indexer can hold the target open for a moment, the rename is tried again. */
const RENAME_RETRY_CODES = ['EPERM', 'EBUSY', 'EACCES'];
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 20;

/** @param {number} ms */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** @param {string} path */
function unlinkQuietly(path) {
    try {
        Fs.unlinkSync(path);
    }
    catch (e) {
        /* Not created or already gone. */
    }
}

/**
 * @param {string} from
 * @param {string} to
 */
function renameWithRetry(from, to) {
    for (let attempt = 1; ; attempt++) {
        try {
            Fs.renameSync(from, to);
            return;
        }
        catch (error) {
            const code = (error && typeof error === 'object' && 'code' in error) ? `${error.code}` : '';
            if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.includes(code)) throw error;
            sleepSync(RENAME_RETRY_DELAY_MS * attempt);
        }
    }
}

/*
    The rename is only durable once the directory entry is on disk. Windows cannot open a directory for that, elsewhere
    it is best effort (some file systems refuse it, the data itself is flushed already).
    @param {string} directory
*/
function fsyncDirectory(directory) {
    if (process.platform === 'win32') return;

    let fd = null;
    try {
        fd = Fs.openSync(directory, 'r');
        Fs.fsyncSync(fd);
    }
    catch (e) {
        /* Best effort. */
    }
    finally {
        if (fd !== null) {
            try {
                Fs.closeSync(fd);
            }
            catch (e) {
                /* Nothing to do. */
            }
        }
    }
}

/*
    Write a file so that a crash can never leave a half-written result behind: the data goes to a
    temporary file, is flushed to disk, and only then replaces the target through an atomic rename.
    Any failure removes the temporary file and rethrows the original error.

    The directory of the target is created when it does not exist yet: `instances` and `credentials` are
    not part of the repository, so a fresh installation writes into a directory that has to be made first.
    @param {string} targetPath
    @param {string} data
    @param {BufferEncoding} [encoding]
    @param {number|null} [mode] File mode of the target, null keeps the default of the runtime.
*/
module.exports = function atomicWriteFile(targetPath, data, encoding = /** @type {BufferEncoding} */ ('utf8'), mode = null) {
    const directory = Path.dirname(targetPath);
    Fs.mkdirSync(directory, { recursive: true });

    /*
        A unique name (pid + random), created exclusively: a leftover file of a crashed write or of a second writer
        is never reused, so it can neither mix contents nor hand its (wider) permissions to the target.
    */
    const tempPath = `${targetPath}.${process.pid}.${Crypto.randomBytes(6).toString('hex')}.tmp`;

    let fd = null;
    try {
        /* A file that only the bot has to read (the Rust+ account token) is created with restrictive permissions. */
        fd = (mode === null) ? Fs.openSync(tempPath, 'wx') : Fs.openSync(tempPath, 'wx', mode);
        Fs.writeFileSync(fd, data, { encoding });
        Fs.fsyncSync(fd);
        Fs.closeSync(fd);
        fd = null;

        renameWithRetry(tempPath, targetPath);
    }
    catch (error) {
        if (fd !== null) {
            try {
                Fs.closeSync(fd);
            }
            catch (e) {
                /* The original error is the one that matters. */
            }
        }
        unlinkQuietly(tempPath);
        throw error;
    }

    fsyncDirectory(directory);
};
