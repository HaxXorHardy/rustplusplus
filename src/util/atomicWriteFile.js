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

const Fs = require('fs');

/*
    Write a file so that a crash can never leave a half-written result behind: the data goes to a
    temporary file, is flushed to disk, and only then replaces the target through an atomic rename.
    Any failure removes the temporary file and rethrows the original error.
*/
module.exports = function atomicWriteFile(targetPath, data, encoding = 'utf8') {
    const tempPath = `${targetPath}.tmp`;

    Fs.writeFileSync(tempPath, data, encoding);

    try {
        const fd = Fs.openSync(tempPath, 'r+');
        Fs.fsyncSync(fd);
        Fs.closeSync(fd);
    }
    catch (error) {
        if (Fs.existsSync(tempPath)) {
            Fs.unlinkSync(tempPath);
        }
        throw error;
    }

    Fs.renameSync(tempPath, targetPath);
};
