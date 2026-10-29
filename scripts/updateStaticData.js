#!/usr/bin/env node

/*
 *  One-shot updater for the static game data used by the bot.
 *
 *  Steps:
 *    1. With --download: fetch the Rust item meta .json files from the Rust dedicated
 *       server (DepotDownloader, scripts/downloadRustItems.js) into .cache/rust-server.
 *    2. Copy the item meta .json files (downloaded server files or a local game
 *       installation) into data/items and regenerate data/static-json/items.json
 *       (scripts/process_items.js).
 *    3. Scrape the RustLabs wiki (scripts/process_rustlabs.js) and copy the resulting
 *       rustlabs*.json files into data/static-json.
 *    4. Rebuild data/staticData.sqlite (scripts/buildStaticFilesDb.js).
 *
 *  Usage:
 *      node scripts/updateStaticData.js [options]
 *      npm run update:static-data
 */

const { spawnSync } = require('child_process');
const Fs = require('fs');
const Path = require('path');

const { countItemMetaFiles, getItemMetaDirectory } = require('./downloadRustItems.js');

const PROJECT_ROOT = Path.resolve(__dirname, '..');
const SCRIPTS_DIRECTORY = __dirname;
const DATA_DIRECTORY = Path.join(PROJECT_ROOT, 'data');
const ITEMS_SOURCE_DIRECTORY = Path.join(DATA_DIRECTORY, 'items');
const STATIC_JSON_DIRECTORY = Path.join(DATA_DIRECTORY, 'static-json');
const RUSTLABS_OUTPUT_DIRECTORY = Path.join(SCRIPTS_DIRECTORY, 'rustlabs');
const ITEMS_JSON_FILENAME = 'items.json';
const TEMP_ITEMS_JSON_PATH = Path.join(SCRIPTS_DIRECTORY, ITEMS_JSON_FILENAME);
const ITEMS_JSON_PATH = Path.join(STATIC_JSON_DIRECTORY, ITEMS_JSON_FILENAME);
const DOWNLOAD_ITEMS_SCRIPT = Path.join(SCRIPTS_DIRECTORY, 'downloadRustItems.js');
const DEFAULT_DOWNLOAD_DIRECTORY = Path.join(PROJECT_ROOT, '.cache', 'rust-server');

const RUSTLABS_DATASETS = [
    'rustlabsBuildingBlocks',
    'rustlabsOther',
    'rustlabsCraftData',
    'rustlabsResearchData',
    'rustlabsRecycleData',
    'rustlabsDurabilityData',
    'rustlabsSmeltingData',
    'rustlabsDespawnData',
    'rustlabsStackData',
    'rustlabsDecayData',
    'rustlabsUpkeepData'
];

const DEFAULT_GAME_ITEM_DIRECTORIES = [
    Path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Steam', 'steamapps', 'common', 'Rust', 'Bundles', 'items'),
    Path.join(process.env['ProgramFiles'] || 'C:\\Program Files',
        'Steam', 'steamapps', 'common', 'Rust', 'Bundles', 'items')
];

function parseArgs(argv) {
    const options = {
        gameDirectory: null,
        itemsSourceDirectory: ITEMS_SOURCE_DIRECTORY,
        download: false,
        downloadDirectory: DEFAULT_DOWNLOAD_DIRECTORY,
        depotDownloaderPath: null,
        sleepMs: null,
        headless: null,
        allowEmpty: false,
        skipItems: false,
        skipRustlabs: false,
        skipDatabase: false,
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
        if (arg === '--headless') {
            options.headless = true;
            continue;
        }
        if (arg === '--visible') {
            options.headless = false;
            continue;
        }
        if (arg === '--allow-empty') {
            options.allowEmpty = true;
            continue;
        }
        if (arg === '--skip-items') {
            options.skipItems = true;
            continue;
        }
        if (arg === '--skip-rustlabs') {
            options.skipRustlabs = true;
            continue;
        }
        if (arg === '--skip-db') {
            options.skipDatabase = true;
            continue;
        }

        if (arg === '--game-dir') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --game-dir');
            options.gameDirectory = resolvePath(argv[i]);
            continue;
        }
        if (arg.startsWith('--game-dir=')) {
            options.gameDirectory = resolvePath(arg.split('=').slice(1).join('='));
            continue;
        }
        if (arg === '--items-dir') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --items-dir');
            options.itemsSourceDirectory = resolvePath(argv[i]);
            continue;
        }
        if (arg.startsWith('--items-dir=')) {
            options.itemsSourceDirectory = resolvePath(arg.split('=').slice(1).join('='));
            continue;
        }

        if (arg === '--download') {
            options.download = true;
            continue;
        }
        if (arg === '--download-dir') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --download-dir');
            options.downloadDirectory = resolvePath(argv[i]);
            continue;
        }
        if (arg.startsWith('--download-dir=')) {
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

        if (arg === '--sleep') {
            i += 1;
            if (i >= argv.length) throw new Error('Missing value for --sleep');
            options.sleepMs = parsePositiveInteger(argv[i], '--sleep');
            continue;
        }
        if (arg.startsWith('--sleep=')) {
            options.sleepMs = parsePositiveInteger(arg.split('=').slice(1).join('='), '--sleep');
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (options.gameDirectory === null) {
        options.gameDirectory = (process.env.RPP_RUST_ITEMS_DIR || '').trim() || null;
    }

    return options;
}

function parsePositiveInteger(value, name) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error(`Invalid value for ${name}: ${value}`);
    }
    return parsed;
}

function resolvePath(value) {
    if (Path.isAbsolute(value)) return value;
    return Path.resolve(process.cwd(), value);
}

let QUIET = false;

function log(message) {
    if (QUIET) return;
    console.log(`[update-static] ${message}`);
}

function warn(message) {
    console.warn(`[update-static] WARNING: ${message}`);
}

function section(index, total, title) {
    if (QUIET) return;
    console.log('');
    console.log(`[update-static] === Step ${index}/${total}: ${title} ===`);
}

function printHelp() {
    console.log('Update the static game data (items + RustLabs wiki) and rebuild the SQLite database.');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/updateStaticData.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --game-dir <dir>   Rust game "Bundles/items" directory (also via RPP_RUST_ITEMS_DIR).');
    console.log('  --items-dir <dir>  Local directory used as item source. Default: data/items');
    console.log('  --download         Download the item meta files from the Rust dedicated server.');
    console.log('  --download-dir <dir>  Where downloaded server files are stored. Default: .cache/rust-server');
    console.log('  --depot-downloader <path>  DepotDownloader executable (also via RPP_DEPOTDOWNLOADER_PATH).');
    console.log('  --sleep <ms>       Delay between RustLabs pages (RPP_RUSTLABS_SLEEP_MS).');
    console.log('  --headless         Run the RustLabs browser without a visible window.');
    console.log('  --visible          Run the RustLabs browser with a visible window.');
    console.log('  --allow-empty      Allow a RustLabs dataset to be overwritten with an empty result.');
    console.log('  --skip-items       Skip steps 1 and 2 (depot download + item meta -> items.json).');
    console.log('  --skip-rustlabs    Skip step 3 (RustLabs scrape).');
    console.log('  --skip-db          Skip step 4 (rebuild staticData.sqlite).');
    console.log('  --quiet            Only print warnings and errors.');
    console.log('  --help, -h         Show this help message.');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/updateStaticData.js');
    console.log('  node scripts/updateStaticData.js --download --sleep 300 --headless');
    console.log('  node scripts/updateStaticData.js --skip-rustlabs');
}

function runNodeScript(scriptPath, args = [], options = {}) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
        cwd: options.cwd ?? PROJECT_ROOT,
        stdio: 'inherit',
        env: options.env ?? process.env
    });

    if (result.error) {
        throw result.error;
    }

    return result.status === null ? 1 : result.status;
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

function findSteamItemsDirectory() {
    for (const candidate of DEFAULT_GAME_ITEM_DIRECTORIES) {
        if (isDirectory(candidate)) return candidate;
    }

    return null;
}

function copyItemMetaFiles(sourceDirectory, targetDirectory) {
    Fs.mkdirSync(targetDirectory, { recursive: true });

    let copied = 0;
    for (const entry of Fs.readdirSync(sourceDirectory)) {
        if (!entry.toLowerCase().endsWith('.json')) continue;
        Fs.copyFileSync(Path.join(sourceDirectory, entry), Path.join(targetDirectory, entry));
        copied += 1;
    }

    return copied;
}

function countJsonEntries(filePath) {
    const parsed = JSON.parse(Fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed !== null && typeof parsed === 'object') return Object.keys(parsed).length;
    return 0;
}

function stepUpdateItems(options) {
    const itemsSourceDirectory = options.itemsSourceDirectory;

    let sourceDirectory = null;
    if (options.gameDirectory) {
        if (isDirectory(options.gameDirectory)) {
            sourceDirectory = options.gameDirectory;
        }
        else {
            warn(`Game items directory not found: ${options.gameDirectory}`);
        }
    }
    else {
        sourceDirectory = findSteamItemsDirectory();
    }

    if (sourceDirectory === null) {
        warn('No Rust game "Bundles/items" directory found. Using the existing item source directory.');
    }
    else if (Path.resolve(sourceDirectory) !== Path.resolve(itemsSourceDirectory)) {
        const copied = copyItemMetaFiles(sourceDirectory, itemsSourceDirectory);
        log(`Copied ${copied} item meta file(s) from ${sourceDirectory}`);
    }
    else {
        log(`Using item meta files from ${sourceDirectory}`);
    }

    if (!isDirectory(itemsSourceDirectory)) {
        warn(`Item source directory not found: ${itemsSourceDirectory} - skipping items.json generation.`);
        return;
    }

    log('Running scripts/process_items.js ...');
    const status = runNodeScript(Path.join(SCRIPTS_DIRECTORY, 'process_items.js'), [], { cwd: SCRIPTS_DIRECTORY });
    if (status !== 0 || !Fs.existsSync(TEMP_ITEMS_JSON_PATH)) {
        throw new Error('process_items.js did not produce items.json');
    }

    const generatedEntries = countJsonEntries(TEMP_ITEMS_JSON_PATH);
    if (generatedEntries === 0) {
        Fs.rmSync(TEMP_ITEMS_JSON_PATH, { force: true });
        throw new Error('process_items.js produced an empty items.json; the existing file is kept.');
    }

    Fs.mkdirSync(STATIC_JSON_DIRECTORY, { recursive: true });
    Fs.copyFileSync(TEMP_ITEMS_JSON_PATH, ITEMS_JSON_PATH);
    log(`data/static-json/items.json updated (${generatedEntries} entries).`);

    try {
        Fs.rmSync(TEMP_ITEMS_JSON_PATH, { force: true });
    }
    catch (e) {
        warn(`Could not remove the intermediate file ${TEMP_ITEMS_JSON_PATH}: ${e.message}`);
    }
}

function stepDownloadItems(options) {
    log('Running scripts/downloadRustItems.js ...');

    const args = ['--dir', options.downloadDirectory];
    if (options.depotDownloaderPath !== null) args.push('--depot-downloader', options.depotDownloaderPath);
    if (QUIET) args.push('--quiet');

    const status = runNodeScript(DOWNLOAD_ITEMS_SCRIPT, args);
    if (status !== 0) {
        throw new Error('downloadRustItems.js failed');
    }

    const itemMetaDirectory = getItemMetaDirectory(options.downloadDirectory);
    const fileCount = countItemMetaFiles(itemMetaDirectory);
    if (fileCount === 0) {
        throw new Error(`No item meta files found in ${itemMetaDirectory}`);
    }

    log(`Downloaded ${fileCount} item meta file(s) from the Rust dedicated server.`);
    options.gameDirectory = itemMetaDirectory;
}

function syncRustlabsDatasets(options) {
    let copied = 0;
    let skipped = 0;

    for (const dataset of RUSTLABS_DATASETS) {
        const sourcePath = Path.join(RUSTLABS_OUTPUT_DIRECTORY, `${dataset}.json`);
        const targetPath = Path.join(STATIC_JSON_DIRECTORY, `${dataset}.json`);

        if (!Fs.existsSync(sourcePath)) {
            warn(`Missing scraped dataset: ${dataset}.json`);
            continue;
        }

        const newEntries = countJsonEntries(sourcePath);
        const oldEntries = Fs.existsSync(targetPath) ? countJsonEntries(targetPath) : 0;

        if (newEntries === 0 && oldEntries > 0 && !options.allowEmpty) {
            warn(`Keeping ${dataset}.json unchanged (${oldEntries} -> 0 entries). Use --allow-empty to force.`);
            skipped += 1;
            continue;
        }

        Fs.copyFileSync(sourcePath, targetPath);
        copied += 1;
        log(`  ${dataset}: ${oldEntries} -> ${newEntries}`);
    }

    if (skipped > 0) {
        warn(`${skipped} dataset(s) kept unchanged to avoid data loss.`);
    }

    return copied;
}

function stepUpdateRustlabs(options) {
    const environment = Object.assign({}, process.env);
    if (options.sleepMs !== null) environment.RPP_RUSTLABS_SLEEP_MS = String(options.sleepMs);
    if (options.headless !== null) environment.RPP_RUSTLABS_HEADLESS = options.headless ? 'true' : 'false';

    log('Running scripts/process_rustlabs.js ...');
    const status = runNodeScript(Path.join(SCRIPTS_DIRECTORY, 'process_rustlabs.js'), [], { env: environment });

    if (status !== 0) {
        warn('RustLabs scrape did not finish successfully. Existing datasets are kept unchanged.');
        return;
    }

    Fs.mkdirSync(STATIC_JSON_DIRECTORY, { recursive: true });
    const copied = syncRustlabsDatasets(options);
    log(`Synced ${copied} RustLabs dataset(s) into data/static-json.`);
}

function stepBuildDatabase() {
    log('Running scripts/buildStaticFilesDb.js ...');
    const quietArgs = QUIET ? ['--quiet'] : [];
    const status = runNodeScript(Path.join(SCRIPTS_DIRECTORY, 'buildStaticFilesDb.js'), quietArgs);
    if (status !== 0) {
        throw new Error('buildStaticFilesDb.js failed');
    }
}

function main() {
    let options = null;
    try {
        options = parseArgs(process.argv.slice(2));
    }
    catch (e) {
        console.error(`[update-static] ${e.message}`);
        printHelp();
        process.exit(1);
    }

    if (options.help) {
        printHelp();
        return;
    }

    QUIET = options.quiet;

    const runDownloadStep = options.download && !options.skipItems && options.gameDirectory === null;
    if (options.download && !options.skipItems && options.gameDirectory !== null) {
        log(`Skipping the depot download because an item directory was provided: ${options.gameDirectory}`);
    }

    const steps = [];
    if (runDownloadStep) steps.push('download');
    if (!options.skipItems) steps.push('items');
    if (!options.skipRustlabs) steps.push('rustlabs');
    if (!options.skipDatabase) steps.push('database');

    log(`Project root: ${PROJECT_ROOT}`);
    log(`Steps to run: ${steps.join(', ') || '(none)'}`);

    const warnings = [];
    const total = steps.length;
    let index = 0;

    if (runDownloadStep) {
        index += 1;
        section(index, total, 'Rust dedicated server item meta -> .cache/rust-server');
        try {
            stepDownloadItems(options);
        }
        catch (e) {
            console.error(`[update-static] Item download failed: ${e.message}`);
            process.exit(1);
        }
    }

    if (!options.skipItems) {
        index += 1;
        section(index, total, 'Item meta files -> data/static-json/items.json');
        try {
            stepUpdateItems(options);
        }
        catch (e) {
            console.error(`[update-static] Items step failed: ${e.message}`);
            process.exit(1);
        }
    }

    if (!options.skipRustlabs) {
        index += 1;
        section(index, total, 'RustLabs wiki scrape -> data/static-json/rustlabs*.json');
        try {
            stepUpdateRustlabs(options);
        }
        catch (e) {
            warn(`RustLabs step failed: ${e.message}`);
            warnings.push('RustLabs scrape failed; the existing datasets were kept.');
        }
    }

    if (!options.skipDatabase) {
        index += 1;
        section(index, total, 'Rebuild data/staticData.sqlite');
        try {
            stepBuildDatabase();
        }
        catch (e) {
            console.error(`[update-static] Database step failed: ${e.message}`);
            process.exit(1);
        }
    }

    console.log('');
    log('Done.');
    for (const warning of warnings) {
        warn(warning);
    }
}

main();




