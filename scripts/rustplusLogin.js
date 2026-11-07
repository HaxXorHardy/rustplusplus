/*
    Native Steam login for the Rust+ account token.

    Since Facepunch removed the direct Rust+ connections, the bot has to use the same authenticated websocket as
    the Rust+ app: wss://companion-rust.facepunch.com/socket/<server uuid> with the account token sent as a
    websocket subprotocol. That token is created by the Steam login of the Rust+ web app.

    The normal way to log in is the Discord command "/credentials login" - it runs exactly the same code. This
    script is the headless variant for servers without Discord access (Docker without the bot running, cron, ...).

    Usage:
        node scripts/rustplusLogin.js --account=<name> [--code=<steam guard code>] [--timeout=<seconds>]
        node scripts/rustplusLogin.js            # asks for account name, password and code
        node scripts/rustplusLogin.js --renew    # renews the stored tokens, no password needed

    The password is read from RPP_STEAM_PASSWORD or asked on the terminal. Steam Guard works both ways: the e-mail
    or authenticator code is asked for, a confirmation in the Steam app is only waited for.

    The login stores credentials/rustplusAuth/<steamId>.json with the account token, the Steam refresh token (used
    to renew the account token without a login) and the server list (server name -> pairing id). --renew uses that
    refresh token, so it also works from cron.
*/

const Fs = require('fs');
const Readline = require('readline');

const RustPlusAuth = require('../src/util/rustplusAuth.js');
const RustPlusLogin = require('../src/util/rustplusLogin.js');
const RustPlusTransport = require('../src/util/rustplusTransport.js');

function getOption(name, fallback = null) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find((e) => e.startsWith(prefix));
    return (arg === undefined) ? fallback : arg.slice(prefix.length);
}

const rl = Readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(`${answer}`.trim())));
}

function log(text) {
    console.log(`  ${text}`);
}

function readStoredSteamIds() {
    try {
        return Fs.readdirSync(RustPlusAuth.AUTH_DIR)
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.replace(/\.json$/, ''));
    }
    catch (e) {
        return [];
    }
}

/* --renew renews the stored account token with the stored Steam refresh token (no password, no Steam Guard). */
async function renew() {
    const requested = getOption('renew');
    const steamIds = requested ? [requested] : readStoredSteamIds();

    if (steamIds.length === 0) throw new Error('No stored login found in credentials/rustplusAuth.');

    for (const steamId of steamIds) {
        console.log(`Renewing ${steamId}...`);

        const auth = await RustPlusLogin.renewAuth(steamId, log);
        const expires = RustPlusTransport.getAuthTokenExpiry(auth.token);

        console.log(`  token expires: ${expires === null ? 'unknown' : new Date(expires * 1000).toISOString()}`);
        console.log(`  servers: ${auth.servers.length}`);
    }
}

async function main() {
    if (process.argv.slice(2).some((e) => e === '--renew' || e.startsWith('--renew='))) return await renew();

    const accountName = getOption('account') || process.env.RPP_STEAM_ACCOUNT || await ask('Steam account name: ');
    const password = process.env.RPP_STEAM_PASSWORD || await ask('Steam password (input is visible): ');
    const timeoutMs = (parseInt(getOption('timeout', '900')) || 900) * 1000;

    if (!accountName || !password) throw new Error('Account name and password are required.');

    console.log('Steam login...');
    const flow = new RustPlusLogin.SteamLogin({ accountName: accountName, password: password, timeoutMs: timeoutMs, log: log });

    const guard = await flow.start();
    if (guard !== null) {
        const types = Array.isArray(guard.types) ? guard.types : [];

        if (types.includes('deviceConfirmation') || types.includes('emailConfirmation')) {
            console.log(types.includes('deviceConfirmation') ?
                'Steam asks whether this device may be authorized. Confirm it in the Steam app. Waiting...' :
                'Steam sent a login link to your e-mail. Open it to continue. Waiting...');
        }
        else {
            console.log(types.includes('emailCode') ?
                `Steam sent a code to your e-mail (${guard.detail || 'unknown'}).` :
                'Enter the code of your Steam mobile authenticator.');

            const code = getOption('code') || await ask('Steam Guard code: ');
            await flow.submitCode(code);
        }
    }

    console.log('Waiting for Steam...');
    const cookies = await flow.wait();

    console.log('Rust+ login...');
    const auth = await RustPlusLogin.loginToRustPlus(cookies, log);

    console.log('Reading the server list...');
    const servers = await RustPlusLogin.fetchServerList(auth.token);
    RustPlusLogin.storeAuth(auth.steamId, auth.token, servers, flow.getRefreshToken());

    const expires = RustPlusTransport.getAuthTokenExpiry(auth.token);

    console.log('');
    console.log(`steamId: ${auth.steamId}`);
    console.log(`token expires: ${expires === null ? 'unknown' : new Date(expires * 1000).toISOString()}`);
    console.log(`servers (${servers.length}):`);
    for (const server of servers) console.log(`  ${server.id}  ${server.name}`);
    console.log('');
    console.log(`Stored in credentials/rustplusAuth/${auth.steamId}.json - restart the bot to use it.`);
}

main()
    .catch((e) => {
        console.error(`Login failed: ${(e && e.message) ? e.message : e}`);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
