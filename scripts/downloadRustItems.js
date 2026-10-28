#!/usr/bin/env node

/*
 *  Downloads the Rust item meta .json files that scripts/process_items.js combines into
 *  data/static-json/items.json.
 *
 *  The files live in the "Rust Dedicated Server" Steam app (258550, depot 258554) under
 *  Bundles/items/*.json. That depot is anonymously downloadable, so no Steam account or
 *  secret is required. DepotDownloader is driven with a file list (scripts/rustItemsFileList.txt)
 *  so that only the small .json files are fetched instead of the full ~5 GB depot.
 *
 *  DepotDownloader is not bundled with this project. Install it once with
 *      winget install --exact --id SteamRE.DepotDownloader      (Windows)
 *      brew tap steamre/tools && brew install depotdownloader   (macOS)
 *  or download a release from https://github.com/SteamRE/DepotDownloader/releases and point
 *  --depot-downloader (or RPP_DEPOTDOWNLOADER_PATH) at the executable.
 *
 *  Usage:
 *      node scripts/downloadRustItems.js [options]
 *      npm run download:rust-items
 *
 *  Options:
 *      --dir <dir>             Where the server files are stored. Default: .cache/rust-server
 *      --depot-downloader <p>  DepotDownloader executable (also via RPP_DEPOTDOWNLOADER_PATH).
 *      --app <id>              Steam app id. Default: 258550 (Rust Dedicated Server)
 *      --depot <id>            Steam depot id. Default: 258554 (dedicated server content)
 *      --filelist <file>       File list to download. Default: scripts/rustItemsFileList.txt
 *      --no-download           Only validate files that are already on disk.
 *      --quiet                 Only print warnings and errors.
 *      --help, -h              Show this help message.
 */

const { spawnSync } = require('child_process');
const Fs = require('fs');
const Path = require('path');

const PROJECT_ROOT = Path.resolve(__dirname, '..');
const DEFAULT_DOWNLOAD_DIRECTORY = Path.join(PROJECT_ROOT, '.cache', 'rust-server');
const DEFAULT_WORKING_DIRECTORY = Path.join(PROJECT_ROOT, '.cache', 'depotdownloader');
const DEFAULT_FILE_LIST_PATH = Path.join(__dirname, 'rustItemsFileList.txt');
const DEFAULT_APP_ID = 258550;
const DEFAULT_DEPOT_ID = 258554;
const ITEM_META_SUBDIRECTORY = Path.join('Bundles', 'items');
const EXECUTABLE_NAME_WINDOWS = 'DepotDownloader.exe';
const EXECUTABLE_NAME_POSIX = 'DepotDownloader';

let QUIET = false;

function log(message) {
    if (QUIET) return;
    console.log(`[download-items] ${message}`);
}

/*
    @param {string[]} argv
    @param {NodeJS.ProcessEnv} [env]
*/
function parseArgs(argv, env = process.env) {
    const options = {
        downloadDirectory: DEFAULT_DOWNLOAD_DIRECTORY,
        workingDirectory: DEFAULT_WORKING_DIRECTORY,
        depotDownloaderPath: null,
        appId: DEFAULT_APP_ID,
        depotId: DEFAULT_DEPOT_ID,
        fileListPath: DEFAULT_FILE_LIST_PATH,
        download: true,
        quiet: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--quiet') {
            options.quiet = true;
            continue;
        }
        if (arg === '--no-download') {
            options.download = false;
            continue;
        }

        if (arg === '--dir') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --dir');
            options.downloadDirectory = resolvePath(argv[i]);
            continue;
        }
        if (arg.startsWith('--dir=')) {
            options.downloadDirectory = resolvePath(arg.split('=').slice(1).join('='));
            continue;
        }

        if (arg === '--depot-downloader') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --depot-downloader');
            options.depotDownloaderPath = resolvePath(argv[i]);
            continue;
        }
        if (arg.startsWith('--depot-downloader=')) {
            options.depotDownloaderPath = resolvePath(arg.split('=').slice(1).join('='));
            continue;
        }

        if (arg === '--filelist') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --filelist');
            options.fileListPath = resolvePath(argv[i]);
            continue;
        }
        if (arg.startsWith('--filelist=')) {
            options.fileListPath = resolvePath(arg.split('=').slice(1).join('='));
            continue;
        }

        if (arg === '--app') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --app');
            options.appId = parsePositiveInteger(argv[i], '--app');
            continue;
        }
        if (arg.startsWith('--app=')) {
            options.appId = parsePositiveInteger(arg.split('=').slice(1).join('='), '--app');
            continue;
        }

        if (arg === '--depot') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --depot');
            options.depotId = parsePositiveInteger(argv[i], '--depot');
            continue;
        }
        if (arg.startsWith('--depot=')) {
            options.depotId = parsePositiveInteger(arg.split('=').slice(1).join('='), '--depot');
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (options.depotDownloaderPath === null) {
        options.depotDownloaderPath = (env.RPP_DEPOTDOWNLOADER_PATH || '').trim() || null;
    }

    return options;
}

function parsePositiveInteger(value, name) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for ${name}: ${value}`);
    }
    return parsed;
}

function resolvePath(value) {
    if (Path.isAbsolute(value)) return value;
    return Path.resolve(process.cwd(), value);
}

function printHelp() {
    console.log('Download the Rust item meta .json files from the Rust dedicated server depot.');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/downloadRustItems.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --dir <dir>              Where the server files are stored. Default: .cache/rust-server');
    console.log('  --depot-downloader <p>   DepotDownloader executable (also via RPP_DEPOTDOWNLOADER_PATH).');
    console.log(`  --app <id>               Steam app id. Default: ${DEFAULT_APP_ID} (Rust Dedicated Server)`);
    console.log(`  --depot <id>             Steam depot id. Default: ${DEFAULT_DEPOT_ID} (dedicated server content)`);
    console.log('  --filelist <file>        File list to download. Default: scripts/rustItemsFileList.txt');
    console.log('  --no-download            Only validate files that are already on disk.');
    console.log('  --quiet                  Only print warnings and errors.');
    console.log('  --help, -h               Show this help message.');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/downloadRustItems.js');
    console.log('  node scripts/downloadRustItems.js --dir .cache/rust-server --quiet');
}

function getDepotDownloaderExecutableName(platform = process.platform) {
    return platform === 'win32' ? EXECUTABLE_NAME_WINDOWS : EXECUTABLE_NAME_POSIX;
}

function isFile(filePath) {
    if (filePath === null || filePath === undefined || filePath === '') return false;
    try {
        return Fs.statSync(filePath).isFile();
    }
    catch (e) {
        return false;
    }
}

function isDirectory(directory) {
    if (directory === null || directory === undefined || directory === '') return false;
    try {
        return Fs.statSync(directory).isDirectory();
    }
    catch (e) {
        return false;
    }
}

/*
    Looks up an executable in a PATH-style string. Returns null when it is absent.
    @param {string} executableName
    @param {string} pathVariable
    @returns {string|null}
*/
function findExecutableOnPath(executableName, pathVariable) {
    for (const directory of pathVariable.split(Path.delimiter)) {
        if (directory === '') continue;
        const candidate = Path.join(directory, executableName);
        if (isFile(candidate)) return candidate;
    }

    return null;
}

/*
    Resolves the DepotDownloader executable in this order:
        1. an explicit path (CLI flag or RPP_DEPOTDOWNLOADER_PATH)
        2. <projectRoot>/.cache/depotdownloader/DepotDownloader[.exe]
        3. the PATH environment variable
    Returns null when no candidate exists. An explicit path is never silently ignored.
    @param {string|null} explicitPath
    @param {{ projectRoot?: string, pathVariable?: string, executableName?: string }} [options]
    @returns {string|null}
*/
function resolveDepotDownloaderPath(explicitPath, options = {}) {
    const projectRoot = options.projectRoot ?? PROJECT_ROOT;
    const executableName = options.executableName ?? getDepotDownloaderExecutableName();

    if (explicitPath) {
        const candidate = resolvePath(explicitPath);
        return isFile(candidate) ? candidate : null;
    }

    const cached = Path.join(projectRoot, '.cache', 'depotdownloader', executableName);
    if (isFile(cached)) return cached;

    const pathVariable = options.pathVariable ?? process.env.PATH ?? '';
    return findExecutableOnPath(executableName, pathVariable);
}

/*
    @param {{ appId: number, depotId: number, fileListPath: string, downloadDirectory: string }} options
    @returns {string[]}
*/
function buildDepotDownloaderArgs(options) {
    return [
        '-app', String(options.appId),
        '-depot', String(options.depotId),
        '-filelist', options.fileListPath,
        '-dir', options.downloadDirectory,
        '-validate'
    ];
}

/*
    @param {string} downloadDirectory
    @returns {string}
*/
function getItemMetaDirectory(downloadDirectory) {
    return Path.join(downloadDirectory, ITEM_META_SUBDIRECTORY);
}

/*
    @param {string} directory
    @returns {number}
*/
function countItemMetaFiles(directory) {
    if (!isDirectory(directory)) return 0;

    let count = 0;
    for (const entry of Fs.readdirSync(directory)) {
        if (!entry.toLowerCase().endsWith('.json')) continue;
        if (!isFile(Path.join(directory, entry))) continue;
        count += 1;
    }

    return count;
}

function depotDownloaderMissingMessage() {
    return [
        'DepotDownloader was not found.',
        'Install it with "winget install --exact --id SteamRE.DepotDownloader" (Windows) or',
        '"brew tap steamre/tools && brew install depotdownloader" (macOS), download a release from',
        'https://github.com/SteamRE/DepotDownloader/releases, or set RPP_DEPOTDOWNLOADER_PATH.'
    ].join(' ');
}

/*
    Runs DepotDownloader for the item meta files and validates the result.
    Throws when the download fails or when no item meta files are present.
    @param {ReturnType<typeof parseArgs>} options
    @returns {{ depotDownloaderPath: string, itemMetaDirectory: string, fileCount: number }}
*/
function downloadItemMetaFiles(options) {
    const depotDownloaderPath = resolveDepotDownloaderPath(options.depotDownloaderPath);
    if (depotDownloaderPath === null) {
        throw new Error(depotDownloaderMissingMessage());
    }
    if (!isFile(options.fileListPath)) {
        throw new Error(`File list not found: ${options.fileListPath}`);
    }

    Fs.mkdirSync(options.downloadDirectory, { recursive: true });
    Fs.mkdirSync(options.workingDirectory, { recursive: true });

    const args = buildDepotDownloaderArgs(options);
    log(`Running ${depotDownloaderPath} ${args.join(' ')}`);

    const result = spawnSync(depotDownloaderPath, args, {
        cwd: options.workingDirectory,
        stdio: 'inherit'
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`DepotDownloader exited with code ${result.status === null ? 'unknown' : result.status}`);
    }

    const itemMetaDirectory = getItemMetaDirectory(options.downloadDirectory);
    const fileCount = countItemMetaFiles(itemMetaDirectory);
    if (fileCount === 0) {
        throw new Error(`DepotDownloader did not write any item meta files to ${itemMetaDirectory}. ` +
            'The Rust dedicated server depot layout may have changed.');
    }

    return { depotDownloaderPath, itemMetaDirectory, fileCount };
}

function main() {
    let options = null;
    try {
        options = parseArgs(process.argv.slice(2));
    }
    catch (e) {
        console.error(`[download-items] ${e.message}`);
        printHelp();
        process.exit(1);
    }

    if (options.help) {
        printHelp();
        return;
    }

    QUIET = options.quiet;

    try {
        if (options.download) {
            const result = downloadItemMetaFiles(options);
            log(`Downloaded ${result.fileCount} item meta file(s) from the Rust dedicated server.`);
        }

        const itemMetaDirectory = getItemMetaDirectory(options.downloadDirectory);
        const fileCount = countItemMetaFiles(itemMetaDirectory);
        if (fileCount === 0) {
            throw new Error(`No item meta files found in ${itemMetaDirectory}. ` +
                'Run without --no-download to download them.');
        }

        log(`Item meta directory: ${itemMetaDirectory} (${fileCount} .json file(s)).`);
    }
    catch (e) {
        console.error(`[download-items] ${e.message}`);
        process.exit(1);
    }
}

module.exports = {
    parseArgs,
    buildDepotDownloaderArgs,
    getDepotDownloaderExecutableName,
    getItemMetaDirectory,
    countItemMetaFiles,
    resolveDepotDownloaderPath
};

if (require.main === module) {
    main();
}
