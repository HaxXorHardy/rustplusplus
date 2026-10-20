# Static Game Data

The bot ships with a set of static game data files (items, crafting recipes, recycle yields,
durability, decay, despawn, ...). They are stored as JSON in [`data/static-json`](../data/static-json)
and are compiled into a single SQLite database `data/staticData.sqlite`, which is what the bot reads
at runtime (`src/util/RustlabsStaticStorage.js`, `src/structures/RustLabs.js`).

Normally you do not have to touch this - the repository already contains up-to-date files. This page
is for maintainers who want to refresh the data after a Rust update.

## Quick start

    npm run update:static-data

This runs the whole pipeline (item metadata -> RustLabs wiki scrape -> SQLite rebuild).

## What the pipeline does

| Step | Script | Result |
| ---- | ------ | ------ |
| 1. Item metadata | `scripts/process_items.js` | Combines the item `.json` files from the Rust game folder into `data/static-json/items.json` |
| 2. RustLabs scrape | `scripts/process_rustlabs.js` | Scrapes `wiki.rustclash.com` and writes `rustlabs*.json` (craft, research, recycle, durability, smelting, despawn, stack, decay, upkeep, building blocks, other) |
| 3. Build database | `scripts/buildStaticFilesDb.js` | Compiles all JSON files from `data/static-json` into `data/staticData.sqlite` |

`scripts/updateStaticData.js` orchestrates all three steps.

### Options

    node scripts/updateStaticData.js [options]

| Option | Description |
| ------ | ----------- |
| `--game-dir <dir>` | Path to the Rust `Bundles/items` folder. Auto-detected if omitted (also `RPP_RUST_ITEMS_DIR`). |
| `--items-dir <dir>` | Local folder used as item source. Default: `data/items` |
| `--sleep <ms>` | Delay between RustLabs page requests. Default: `2000` |
| `--headless` | Run the scraper browser without a visible window. |
| `--visible` | Run the scraper browser with a visible window. |
| `--allow-empty` | Allow an empty scrape result to overwrite an existing dataset. |
| `--skip-items` / `--skip-rustlabs` / `--skip-db` | Skip individual steps. |
| `--quiet` | Only print warnings and errors. |
| `--help, -h` | Show the help text. |

### Examples

    # full update, fast and without a browser window
    node scripts/updateStaticData.js --sleep 300 --headless

    # only rebuild the SQLite database from the existing JSON files
    node scripts/updateStaticData.js --skip-items --skip-rustlabs

    # update the item list only (no network needed)
    node scripts/updateStaticData.js --skip-rustlabs

## Item metadata (step 1)

The item meta files live in your Rust installation:

    <Steam>/steamapps/common/Rust/Bundles/items

They are copied into `data/items` (this happens automatically when the game folder is found), then
`scripts/process_items.js` combines them into an `items.json` that ends up in
`data/static-json/items.json`.

## RustLabs scrape (step 2)

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

## Building the SQLite database (step 3)

    npm run build:static-db

or directly:

    node scripts/buildStaticFilesDb.js [--source <dir>] [--output <file>] [--quiet]

This compiles every JSON file in `data/static-json` into `data/staticData.sqlite`.

## Safety

* A dataset whose new content would be empty is **not** copied over an existing non-empty dataset
  (this protects e.g. `rustlabsDespawnData`). Use `--allow-empty` to force it.
* If the RustLabs scrape fails (network/Cloudflare), the existing datasets are kept and the item
  list plus the database are still rebuilt.
* Generated scratch data (`data/items`, `scripts/items.json`, `scripts/rustlabs`) is git-ignored.

## Automated updates (GitHub Actions)

[`.github/workflows/update-static-data.yml`](../.github/workflows/update-static-data.yml) runs the
pipeline on GitHub Actions:

* **Scheduled** - monthly, on the 1st at 04:00 UTC: refreshes the RustLabs data (best effort) and
  rebuilds the database.
* **Manual (`workflow_dispatch`)** - choose whether to refresh RustLabs, the page delay, headless
  mode and a dry run that does not commit.

The workflow only commits when `data/static-json` or `data/staticData.sqlite` actually changed, and
pushes directly to the branch it runs on (default: `master`).

### Limitations in CI

* A GitHub runner has no Rust installation, so **step 1 (item metadata) is skipped** with
  `--skip-items`. Run the updater locally after a Rust update to refresh `items.json`.
* `wiki.rustclash.com` is protected by Cloudflare and datacenter IPs are frequently challenged, so
  the RustLabs refresh may fail in CI. In that case the existing datasets are kept and the database
  is still rebuilt.
* The browser session (`scripts/rustlabs/.browser-profile`) is not committed and does not exist on a
  fresh runner, so no Cloudflare clearance from a local run can be reused.
* If `master` is protected, the automated commit is rejected. Allow `github-actions[bot]` to push
  (or switch the workflow to open a pull request instead).
