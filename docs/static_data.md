# Static Game Data

The bot ships with a set of static game data files (items, crafting recipes, recycle yields,
durability, decay, despawn, ...). They are stored as JSON in [`data/static-json`](../data/static-json)
and are compiled into a single SQLite database `data/staticData.sqlite`, which is what the bot reads
at runtime (`src/util/RustlabsStaticStorage.js`, `src/structures/RustLabs.js`).

Normally you do not have to touch this - the repository already contains up-to-date files. This page
is for maintainers who want to refresh the data after a Rust update.

## Quick start

    npm run update:static-data -- --download

This runs the whole pipeline (item metadata download -> item metadata merge -> RustLabs wiki
scrape -> SQLite rebuild). `--download` fetches the item meta files from the Rust dedicated server
with [DepotDownloader](https://github.com/SteamRE/DepotDownloader) instead of requiring a local Rust
installation; see [Item metadata](#item-metadata) for the one-time DepotDownloader install.

Without `--download` the pipeline uses a local Rust installation (when one is found) or the files
that are already in `data/items`, exactly like before.

## What the pipeline does

| Step | Script | Result |
| ---- | ------ | ------ |
| 1. Download item metadata | `scripts/downloadRustItems.js` | Uses DepotDownloader to pull `Bundles/items/*.json` from the Rust dedicated server (Steam app `258550`, depot `258554`) into `.cache/rust-server` (only with `--download`) |
| 2. Item metadata | `scripts/process_items.js` | Combines the item `.json` files from the item source folder (downloaded server files or a local Rust installation) into `data/static-json/items.json` |
| 3. RustLabs scrape | `scripts/process_rustlabs.js` | Scrapes `wiki.rustclash.com` and writes `rustlabs*.json` (craft, research, recycle, durability, smelting, despawn, stack, decay, upkeep, building blocks, other) |
| 4. Build database | `scripts/buildStaticFilesDb.js` | Compiles all JSON files from `data/static-json` into `data/staticData.sqlite` |

`scripts/updateStaticData.js` orchestrates all steps.

### Options

    node scripts/updateStaticData.js [options]

| Option | Description |
| ------ | ----------- |
| `--game-dir <dir>` | Path to the Rust `Bundles/items` folder. Auto-detected if omitted (also `RPP_RUST_ITEMS_DIR`). |
| `--items-dir <dir>` | Local folder used as item source. Default: `data/items` |
| `--download` | Download the item meta files from the Rust dedicated server with DepotDownloader. |
| `--download-dir <dir>` | Where the downloaded server files are stored. Default: `.cache/rust-server` |
| `--depot-downloader <path>` | DepotDownloader executable (also via `RPP_DEPOTDOWNLOADER_PATH`). |
| `--sleep <ms>` | Delay between RustLabs page requests. Default: `2000` |
| `--headless` | Run the scraper browser without a visible window. |
| `--visible` | Run the scraper browser with a visible window. |
| `--allow-empty` | Allow an empty scrape result to overwrite an existing dataset. |
| `--skip-items` | Skip steps 1 and 2 (depot download + `items.json`). |
| `--skip-rustlabs` | Skip step 3 (RustLabs scrape). |
| `--skip-db` | Skip step 4 (rebuild `staticData.sqlite`). |
| `--quiet` | Only print warnings and errors. |
| `--help, -h` | Show the help text. |

### Examples

    # full update, downloading the item metadata from the Rust dedicated server
    node scripts/updateStaticData.js --download --sleep 300 --headless

    # full update from a local Rust installation (no browser window)
    node scripts/updateStaticData.js --sleep 300 --headless

    # only rebuild the SQLite database from the existing JSON files
    node scripts/updateStaticData.js --skip-items --skip-rustlabs

    # update the item list only (no network needed)
    node scripts/updateStaticData.js --skip-rustlabs

## Item metadata

The item meta files (`Bundles/items/*.json`) come from the Rust game. Two sources are supported.

### From the Rust dedicated server (used by CI)

    npm run download:rust-items
    node scripts/updateStaticData.js --download

[DepotDownloader](https://github.com/SteamRE/DepotDownloader) logs in anonymously and downloads only
the item meta JSONs from the Rust dedicated server (app `258550`, depot `258554`) using
`scripts/rustItemsFileList.txt`:

    regex:^Bundles/items/.*\.json$

That is roughly 0.5 MB instead of the full ~5 GB depot. The files land in `.cache/rust-server`
(git-ignored) and `--download` feeds them into `scripts/process_items.js`; no Steam account or
secret is needed.

DepotDownloader is not bundled with this project. Install it once:

| Platform | Command |
| -------- | ------- |
| Windows | `winget install --exact --id SteamRE.DepotDownloader` |
| macOS | `brew tap steamre/tools && brew install depotdownloader` |
| any | download a release from [the releases page](https://github.com/SteamRE/DepotDownloader/releases) |

The script resolves the executable from `--depot-downloader`, `RPP_DEPOTDOWNLOADER_PATH`,
`.cache/depotdownloader/DepotDownloader[.exe]` or `PATH`, in that order. All options are listed in
`node scripts/downloadRustItems.js --help`. The download is validated: if no `Bundles/items/*.json`
files arrive, the updater stops instead of writing an empty `items.json`.

### From a local Rust installation

If you own Rust and have it installed, the pipeline still auto-detects
`<Steam>/steamapps/common/Rust/Bundles/items` (or use `--game-dir` / `RPP_RUST_ITEMS_DIR`). The
files are copied into `data/items` and merged into `data/static-json/items.json` by
`scripts/process_items.js`. An explicit `--game-dir` takes precedence over `--download`.

## RustLabs scrape (step 3)

The wiki is protected by Cloudflare, so the script drives a real Edge/Chrome via
`playwright-core`. The browser session (cookies, Cloudflare clearance) is stored in
`scripts/rustlabs/.browser-profile` and reused on the next run.

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `RPP_RUSTLABS_SLEEP_MS` | `2000` | Delay between pages. Lower is faster but more aggressive. |
| `RPP_RUSTLABS_HEADLESS` | `false` | Run the browser without a window. |
| `RPP_RUSTLABS_HEADLESS_AFTER_CHALLENGE` | `true` | Continue headless once a Cloudflare challenge was solved. |
| `RPP_RUSTLABS_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `RPP_RUSTLABS_CHALLENGE_WAIT_MS` | `180000` | How long to wait for a manually solved Cloudflare challenge. |
| `RPP_RUSTLABS_BROWSER_PATH` | auto | Explicit Edge/Chrome executable. |
| `RPP_RUSTLABS_BROWSER_ARGS` | - | Extra browser flags, e.g. `--no-sandbox --disable-dev-shm-usage` (CI). |
| `RPP_RUSTLABS_COOKIE` / `RPP_RUSTLABS_CF_CLEARANCE` | - | Reuse existing Cloudflare cookies. |
| `RPP_RUSTLABS_USE_PROXY` | `false` | Use the `HTTP(S)_PROXY` environment variables for the browser. |

If Cloudflare shows a challenge, run the scraper with a visible browser and solve it in the opened
window - the run continues automatically. A full run of roughly 1200 pages takes about 10 minutes
with `RPP_RUSTLABS_SLEEP_MS=300` in headless mode.

## Building the SQLite database (step 4)

    npm run build:static-db

or directly:

    node scripts/buildStaticFilesDb.js [--source <dir>] [--output <file>] [--quiet]

This compiles every JSON file in `data/static-json` into `data/staticData.sqlite`.

## Safety

* A dataset whose new content would be empty is **not** copied over an existing non-empty dataset
  (this protects e.g. `rustlabsDespawnData`). Use `--allow-empty` to force it.
* A generated `items.json` with zero entries is never written over the existing one, and a depot
  download that yields no `Bundles/items/*.json` files aborts the update.
* If the RustLabs scrape fails (network/Cloudflare), the existing datasets are kept and the item
  list plus the database are still rebuilt.
* Generated scratch data (`data/items`, `scripts/items.json`, `scripts/rustlabs`, `.cache`) is
  git-ignored.

## Automated updates (GitHub Actions)

[`.github/workflows/update-static-data.yml`](../.github/workflows/update-static-data.yml) runs the
pipeline on GitHub Actions:

* **Scheduled** - monthly, on the 1st at 04:00 UTC: downloads the item metadata from the Rust
  dedicated server, refreshes the RustLabs data (best effort) and rebuilds the database.
* **Manual (`workflow_dispatch`)** - choose whether to refresh the item metadata and the RustLabs
  data, the page delay, headless mode and a dry run that does not commit.

The workflow installs the pinned `DepotDownloader_3.4.0` release (linux-x64), exports
`RPP_DEPOTDOWNLOADER_PATH` and runs `node scripts/updateStaticData.js --download ...`. The dedicated
server depot is anonymously downloadable, so **no Steam credentials or secrets are needed**.

The workflow only commits when `data/static-json` or `data/staticData.sqlite` actually changed, and
pushes directly to the branch it runs on (default: `master`).

### Limitations in CI

* The anonymous Steam download can be rate-limited or fail while Steam is unreachable. The run then
  stops before `items.json` changes, so the last good data stays in place - rerun the workflow later.
* `wiki.rustclash.com` is protected by Cloudflare and datacenter IPs are frequently challenged, so
  the RustLabs refresh may fail in CI. In that case the existing datasets are kept and the item
  metadata plus the database are still rebuilt.
* The browser session (`scripts/rustlabs/.browser-profile`) is not committed and does not exist on a
  fresh runner, so no Cloudflare clearance from a local run can be reused.
* If `master` is protected, the automated commit is rejected. Allow `github-actions[bot]` to push
  (or switch the workflow to open a pull request instead).
