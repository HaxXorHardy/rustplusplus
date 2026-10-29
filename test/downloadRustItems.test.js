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

const DownloadRustItems = require('../scripts/downloadRustItems.js');

const EXECUTABLE_NAME = DownloadRustItems.getDepotDownloaderExecutableName();

function makeTempDirectory() {
    return Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-download-items-'));
}

function writeFile(filePath) {
    Fs.mkdirSync(Path.dirname(filePath), { recursive: true });
    Fs.writeFileSync(filePath, '');
}

Test.describe('downloadRustItems', () => {
    Test.describe('buildDepotDownloaderArgs', () => {
        Test.it('targets the Rust dedicated server content depot with the item file list', () => {
            const args = DownloadRustItems.buildDepotDownloaderArgs({
                appId: 258550,
                depotId: 258554,
                fileListPath: Path.join('repo', 'scripts', 'rustItemsFileList.txt'),
                downloadDirectory: Path.join('repo', '.cache', 'rust-server')
            });

            Assert.deepStrictEqual(args, [
                '-app', '258550',
                '-depot', '258554',
                '-filelist', Path.join('repo', 'scripts', 'rustItemsFileList.txt'),
                '-dir', Path.join('repo', '.cache', 'rust-server'),
                '-validate'
            ]);
        });
    });

    Test.describe('getItemMetaDirectory', () => {
        Test.it('points at Bundles/items inside the download directory', () => {
            Assert.strictEqual(
                DownloadRustItems.getItemMetaDirectory(Path.join('repo', '.cache', 'rust-server')),
                Path.join('repo', '.cache', 'rust-server', 'Bundles', 'items')
            );
        });
    });

    Test.describe('countItemMetaFiles', () => {
        Test.it('counts .json files case-insensitively and ignores other files', () => {
            const directory = makeTempDirectory();
            Fs.writeFileSync(Path.join(directory, 'rifle.ak.json'), '{}');
            Fs.writeFileSync(Path.join(directory, 'rifle.bolt.JSON'), '{}');
            Fs.writeFileSync(Path.join(directory, 'rifle.ak.png'), '');
            Fs.mkdirSync(Path.join(directory, 'nested.json'));

            Assert.strictEqual(DownloadRustItems.countItemMetaFiles(directory), 2);
        });

        Test.it('returns 0 when the directory does not exist', () => {
            const directory = Path.join(makeTempDirectory(), 'missing');

            Assert.strictEqual(DownloadRustItems.countItemMetaFiles(directory), 0);
        });
    });

    Test.describe('parseArgs', () => {
        Test.it('defaults to the anonymous Rust dedicated server depot', () => {
            const options = DownloadRustItems.parseArgs([], {});

            Assert.strictEqual(options.download, true);
            Assert.strictEqual(options.appId, 258550);
            Assert.strictEqual(options.depotId, 258554);
            Assert.strictEqual(options.depotDownloaderPath, null);
            Assert.ok(Path.isAbsolute(options.downloadDirectory));
            Assert.ok(options.fileListPath.endsWith('.txt'));
        });

        Test.it('parses the download and depot options', () => {
            const directory = makeTempDirectory();
            const downloadDirectory = Path.join(directory, 'server');
            const downloaderPath = Path.join(directory, 'DepotDownloader');

            const options = DownloadRustItems.parseArgs([
                '--dir', downloadDirectory,
                '--depot-downloader', downloaderPath,
                '--app', '123',
                '--depot', '456',
                '--no-download',
                '--quiet'
            ], {});

            Assert.strictEqual(options.downloadDirectory, downloadDirectory);
            Assert.strictEqual(options.depotDownloaderPath, downloaderPath);
            Assert.strictEqual(options.appId, 123);
            Assert.strictEqual(options.depotId, 456);
            Assert.strictEqual(options.download, false);
            Assert.strictEqual(options.quiet, true);
        });

        Test.it('falls back to RPP_DEPOTDOWNLOADER_PATH', () => {
            const options = DownloadRustItems.parseArgs([], {
                RPP_DEPOTDOWNLOADER_PATH: 'C:\\tools\\DepotDownloader.exe'
            });

            Assert.strictEqual(options.depotDownloaderPath, 'C:\\tools\\DepotDownloader.exe');
        });

        Test.it('rejects unknown arguments', () => {
            Assert.throws(() => DownloadRustItems.parseArgs(['--nope'], {}), /Unknown argument: --nope/);
        });
    });

    Test.describe('resolveDepotDownloaderPath', () => {
        Test.it('prefers an explicit path that exists', () => {
            const directory = makeTempDirectory();
            const executable = Path.join(directory, EXECUTABLE_NAME);
            writeFile(executable);

            Assert.strictEqual(
                DownloadRustItems.resolveDepotDownloaderPath(executable, { projectRoot: directory, pathVariable: '' }),
                executable
            );
        });

        Test.it('returns null for an explicit path that does not exist instead of using the PATH', () => {
            const directory = makeTempDirectory();
            const pathDirectory = Path.join(directory, 'bin');
            writeFile(Path.join(pathDirectory, EXECUTABLE_NAME));

            Assert.strictEqual(
                DownloadRustItems.resolveDepotDownloaderPath(
                    Path.join(directory, 'nope', EXECUTABLE_NAME),
                    { projectRoot: directory, pathVariable: pathDirectory }
                ),
                null
            );
        });

        Test.it('finds the cached executable under the project root', () => {
            const directory = makeTempDirectory();
            const cached = Path.join(directory, '.cache', 'depotdownloader', EXECUTABLE_NAME);
            writeFile(cached);

            Assert.strictEqual(
                DownloadRustItems.resolveDepotDownloaderPath(null, { projectRoot: directory, pathVariable: '' }),
                cached
            );
        });

        Test.it('falls back to the PATH environment variable', () => {
            const directory = makeTempDirectory();
            const pathDirectory = Path.join(directory, 'bin');
            const executable = Path.join(pathDirectory, EXECUTABLE_NAME);
            writeFile(executable);

            Assert.strictEqual(
                DownloadRustItems.resolveDepotDownloaderPath(null, {
                    projectRoot: Path.join(directory, 'project'),
                    pathVariable: pathDirectory
                }),
                executable
            );
        });
    });
});
