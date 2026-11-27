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

/*
    Native Steam login for the Rust+ account token - no browser required.

    1. Steam login (steam-session, Steam Guard / 2FA included) -> steamcommunity.com session cookies
    2. Rust+ login page (companion-rust.facepunch.com/login) -> Steam OpenID -> account token
    3. /api/syncData with that token -> server list (server name -> pairing uuid)

    The HTTP/HTML part of the browser flow lives in util/rustplusLoginPages.js, this module knows Steam and Rust+.

    Verified against the live endpoints on 2026-11-07.
*/

const Axios = require('axios');
const Querystring = require('querystring');
const SteamSession = require('steam-session');

const CredentialRevocation = require('./credentialRevocation.js');
const RustPlusAuth = require('./rustplusAuth.js');
const RustPlusLoginPages = require('./rustplusLoginPages.js');
const RustPlusSync = require('./rustplusSync.js');
const RustPlusTransport = require('./rustplusTransport.js');

/* The pieces of the browser flow: cookie jar, requests, forms and page parsing. */
const CookieJar = RustPlusLoginPages.CookieJar;
const buildOpenIdLoginFields = RustPlusLoginPages.buildOpenIdLoginFields;
const describeCookies = RustPlusLoginPages.describeCookies;
const describePage = RustPlusLoginPages.describePage;
const extractVerificationToken = RustPlusLoginPages.extractVerificationToken;
const findForm = RustPlusLoginPages.findForm;
const findRedirectTarget = RustPlusLoginPages.findRedirectTarget;
const isSteamLoginPage = RustPlusLoginPages.isSteamLoginPage;
const parseAuthFromHtml = RustPlusLoginPages.parseAuthFromHtml;
const postForm = RustPlusLoginPages.postForm;
const request = RustPlusLoginPages.request;

const RUSTPLUS_BASE = 'https://companion-rust.facepunch.com';
const RUSTPLUS_LOGIN_URL = `${RUSTPLUS_BASE}/login`;
const RUSTPLUS_SYNC_URL = `${RUSTPLUS_BASE}/api/syncData`;

/* Error code of a renewal whose result was thrown away (the login was revoked or replaced while it ran). */
const RENEWAL_DISCARDED = 'RUSTPLUS_RENEWAL_DISCARDED';

/*
    Step 1: Steam login through steam-session. The caller asks for the Steam Guard code (email/TOTP) or waits for
    the confirmation in the Steam app, so 2FA works without a browser.
*/
class SteamLogin {
    constructor({ accountName = null, password = null, timeoutMs = 5 * 60 * 1000, log = () => undefined }) {
        this.accountName = accountName;
        this.password = password;
        this.log = log;
        this.steamSession = SteamSession;

        this.session = new SteamSession.LoginSession(SteamSession.EAuthTokenPlatformType.WebBrowser);
        this.session.loginTimeout = timeoutMs;

        this.cancelled = false;

        this.cookiesPromise = new Promise((resolve, reject) => {
            this.rejectCookies = reject;
            this.session.on('authenticated', () => {
                this.session.getWebCookies().then(resolve).catch(reject);
            });
            this.session.on('timeout', () => reject(new Error('Steam login timed out.')));
            this.session.on('error', (e) => reject(e));
        });

        /* An abandoned login must not crash the bot with an unhandled rejection. */
        this.cookiesPromise.catch(() => undefined);
    }

    /*
        Returns the guard options Steam offers, most convenient first, or null when the login completes
        without one. Steam can offer several at once (e.g. a confirmation in the app and an e-mail code),
        so the caller can show the confirmation and keep the code as a fallback.
    */
    async start() {
        const result = await this.session.startWithCredentials({
            accountName: this.accountName,
            password: this.password,
        });

        if (!result.actionRequired) return null;

        const guardType = this.steamSession.EAuthSessionGuardType;
        const actions = Array.isArray(result.validActions) ? result.validActions : [];
        const has = (type) => actions.some((e) => e.type === type);

        /* No typing needed: the DeviceConfirmation is the push message in the Steam app ("authorize device"). */
        const types = [];
        if (has(guardType.DeviceConfirmation)) types.push('deviceConfirmation');
        if (has(guardType.EmailConfirmation)) types.push('emailConfirmation');
        if (has(guardType.DeviceCode)) types.push('deviceCode');

        const email = actions.find((e) => e.type === guardType.EmailCode);
        if (email) types.push('emailCode');

        if (types.length === 0) {
            throw new Error(`Unsupported Steam Guard action: ${actions.map((e) => e.type).join(', ') || 'unknown'}`);
        }

        return { types: types, type: types[0], detail: email ? (email.detail || null) : null };
    }

    /*
        QR login: the user confirms the login in the Steam app instead of typing the password and a Steam Guard code
        into Discord. Steam returns the URL that has to be shown as a QR code and the session then polls for the
        approval like a device confirmation, so wait()/getRefreshToken() do not differ from the credential login.
    */
    async startQr() {
        const result = await this.session.startWithQR();

        if (!result || typeof (result.qrChallengeUrl) !== 'string' || result.qrChallengeUrl === '') {
            throw new Error('Steam did not return a QR challenge.');
        }

        return result.qrChallengeUrl;
    }

    /* Email or TOTP code, not used for the mobile confirmation. */
    async submitCode(code) {
        await this.session.submitSteamGuardCode(`${code}`.replace(/\s+/g, ''));
    }

    /*
        The confirmation in the Steam app is polled by the library. Ask Steam right away so the login continues
        immediately after the user approved the device.
    */
    forcePoll() {
        try {
            this.session.forcePoll();
        }
        catch (e) {
            /* The session is not polling (yet), the next scheduled poll picks the approval up. */
        }
    }

    /*
        Ends an abandoned login (replaced by a new one, expired, finished): Steam is not polled anymore and a caller
        that still waits for the cookies gets an error instead of waiting forever.
    */
    cancel() {
        if (this.cancelled) return;
        this.cancelled = true;

        try {
            this.session.cancelLoginAttempt();
        }
        catch (e) {
            /* The session was never started. */
        }

        this.rejectCookies(new Error('Steam login was cancelled.'));
    }

    /* Resolves with the steamcommunity.com cookies once Steam finished the login. */
    async wait() {
        return await this.cookiesPromise;
    }

    /*
        The refresh token of the finished login (`null` before it). Stored next to the account token, so a later
        token renewal does not need the password or a Steam Guard confirmation.
    */
    getRefreshToken() {
        return this.session.refreshToken || null;
    }
}

/*
    Step 2: the Rust+ login page. It redirects to Steam's OpenID, Steam sends the (already logged in) browser back
    and the returned page hands the account data to the Rust+ app.

    The page hands the browser an OpenID request, Steam answers it with a consent page and the request has to be
    posted back the way the consent form does it, so the flow is followed hop by hop.
*/
async function loginToRustPlus(steamCookies, log = () => undefined) {
    const jar = new CookieJar();

    for (const cookie of steamCookies || []) jar.store('https://steamcommunity.com/', cookie);

    log(`Rust+ login: Steam cookies ${describeCookies(jar, 'https://steamcommunity.com/openid/login')}`);

    const page = await request('GET', RUSTPLUS_LOGIN_URL, jar);
    const verificationToken = extractVerificationToken(page.data);
    if (verificationToken === null) throw new Error('Rust+ login page did not contain a verification token.');

    let response = await request('POST', RUSTPLUS_LOGIN_URL, jar, {
        data: Querystring.stringify({ returnUrl: '', __RequestVerificationToken: verificationToken }),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    let url = response.headers.location ? new URL(response.headers.location, RUSTPLUS_LOGIN_URL).href : null;
    if (url === null) throw new Error(`Rust+ login did not redirect (status ${response.status}).`);

    /* Steam answered with an OpenID request: post it right away, the consent page is not needed. */
    const openidFields = buildOpenIdLoginFields(url);
    if (openidFields !== null) {
        log('Rust+ login step 1: posting the Steam OpenID request');

        response = await request('POST', 'https://steamcommunity.com/openid/login', jar, {
            data: Querystring.stringify(openidFields),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });

        if (response.headers.location) {
            url = new URL(response.headers.location, 'https://steamcommunity.com/openid/login').href;
        }
        else {
            /* Steam insisted on its own page (consent or login), the loop below handles both. */
            log(`Rust+ login step 2: Steam answered with a page (${describePage(response.data)})`);

            const postAuth = parseAuthFromHtml(response.data);
            if (postAuth) return postAuth;
        }
    }

    const visited = [];
    for (let hop = 0; url !== null && hop < 12; hop++) {
        if (visited.includes(url)) {
            throw new Error(`Rust+ login did not finish (redirect loop at ${url.split('?')[0]}).`);
        }

        visited.push(url);
        log(`Rust+ login step ${hop + 2}: ${url.split('?')[0]} (cookies: ${describeCookies(jar, url)})`);
        response = await request('GET', url, jar);

        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            url = new URL(response.headers.location, url).href;
            continue;
        }

        /* Steam wants the session cookies to be valid, otherwise it shows the login form. */
        if (isSteamLoginPage(response.data)) {
            throw new Error('Steam did not accept the login session: the OpenID page showed the Steam login form ' +
                `(${describePage(response.data)}).`);
        }

        log(`Rust+ login step ${hop + 2}: page ${describePage(response.data)}`);

        /* Submit Steam's OpenID form, it holds the fields the return page expects. */
        const openidForm = findForm(response.data,
            (form) => Object.keys(form.fields).some((name) => name.startsWith('openid.')));
        if (openidForm) {
            /* Steam's own form sends this flag along, it tells the endpoint that the user agreed. */
            if (!('action' in openidForm.fields)) openidForm.fields.action = 'steam_openid_login';

            /* Without an action attribute the form posts to the OpenID endpoint itself, not to the url with its query. */
            const actionUrl = openidForm.action ? new URL(openidForm.action, url).href : url.split('?')[0];

            log(`Rust+ login step ${hop + 2}: submitting the OpenID form to ${actionUrl} ` +
                `(${openidForm.enctype}, fields: ${Object.keys(openidForm.fields).join(', ')})`);

            response = await postForm(actionUrl, openidForm, jar);

            if (response.headers.location) {
                url = new URL(response.headers.location, url).href;
                continue;
            }

            const formAuth = parseAuthFromHtml(response.data);
            if (formAuth) return formAuth;
        }

        const auth = parseAuthFromHtml(response.data);
        if (auth) return auth;

        /* A page that redirects itself (meta refresh, javascript, link to the Rust+ page). */
        const next = findRedirectTarget(response.data, url);
        if (next !== null && !visited.includes(next)) {
            url = next;
            continue;
        }

        throw new Error(`Rust+ login page without account data (status ${response.status}, ` +
            `${describePage(response.data)}).`);
    }

    throw new Error('Rust+ login did not finish (redirect loop).');
}

/*
    Step 3: the account state of the Rust+ app. It contains the servers (pairing id, player token, name, ...) and
    the paired entities, see util/rustplusSync.js.
*/
async function fetchSyncData(token) {
    const response = await Axios.post(RUSTPLUS_SYNC_URL, { AuthToken: token }, {
        timeout: 30000,
        validateStatus: () => true,
        headers: {
            'user-agent': RustPlusLoginPages.USER_AGENT,
            accept: 'application/json',
            'content-type': 'application/json',
        },
    });

    if (response.status === 204) return { currentServerId: null, servers: [] };
    if (response.status !== 200) {
        /* The status lets the caller tell a rejected token (401/403) from a temporary failure. */
        const error = new Error(`Sync request failed with status ${response.status}.`);
        error.status = response.status;
        throw error;
    }

    /*
        An unreadable payload is an error, not an empty account: an empty list would replace the stored server list
        and make every server look unpaired.
    */
    try {
        return RustPlusSync.parseSyncPayload(response.data.payload);
    }
    catch (e) {
        throw new Error(`Sync response could not be read: ${e && e.message ? e.message : e}`);
    }
}

/*
    Stores token, refresh token and server list in credentials/rustplusAuth/<steamId>.json. An already stored
    refresh token is kept when none is passed in (Steam does not rotate it on every login).
*/
function storeAuth(steamId, token, servers, refreshToken = null, options = {}) {
    const existing = RustPlusAuth.readAuth(`${steamId}`);

    /* options.keepRefreshToken false: the stored refresh token belongs to another owner and must not be carried over. */
    const keep = options.keepRefreshToken !== false;
    const steamRefreshToken = refreshToken || ((keep && existing) ? existing.steamRefreshToken : null) || null;

    /* An empty list (no account state, or it could not be read) does not wipe the servers that are known. */
    const hasServers = Array.isArray(servers) && servers.length !== 0;
    const keptServers = (existing && Array.isArray(existing.servers)) ? existing.servers : [];

    const auth = {
        steamId: `${steamId}`,
        token: token,
        tokenExpiresAt: RustPlusTransport.getAuthTokenExpiry(token),
        updatedAt: new Date().toISOString(),
        servers: hasServers ? servers : keptServers,
    };

    if (steamRefreshToken !== null) auth.steamRefreshToken = steamRefreshToken;

    RustPlusAuth.writeAuth(`${steamId}`, auth);
    return auth;
}

/*
    Fetches a new account token with the stored Steam refresh token: a new LoginSession gets the refresh token,
    asks Steam for fresh community cookies and runs the Rust+ login again. No password, no Steam Guard.

    options.isRegistered(steamId): does a guild still list the account? Defaults to the guild credential files.
*/
async function renewAuth(steamId, log = () => undefined, options = {}) {
    const isRegistered = options.isRegistered || ((id) => CredentialRevocation.isRegisteredInAnyGuild(id));
    const generation = RustPlusAuth.getAuthGeneration(`${steamId}`);

    const auth = RustPlusAuth.readAuth(`${steamId}`);
    if (auth === null) throw new Error('No stored Rust+ login for this account.');

    if (!auth.steamRefreshToken) {
        throw new Error('No Steam refresh token stored, a new login is required.');
    }

    log('Rust+ token: renewing with the stored Steam refresh token');

    const session = new SteamSession.LoginSession(SteamSession.EAuthTokenPlatformType.WebBrowser);
    session.refreshToken = auth.steamRefreshToken;

    const cookies = await session.getWebCookies();
    const renewed = await module.exports.loginToRustPlus(cookies, log);

    if (`${renewed.steamId}` !== `${steamId}`) {
        throw new Error(`The Steam refresh token belongs to ${renewed.steamId}, not ${steamId}.`);
    }

    /*
        The new token is already issued (and the old one possibly invalidated): a failed read of the account state
        must not throw it away. It is stored with the known server list instead.
    */
    let servers = { servers: [] };
    try {
        servers = await module.exports.fetchSyncData(renewed.token);
    }
    catch (e) {
        log(`Rust+ token: the account state could not be read (${e && e.message ? e.message : e}), ` +
            'the known server list is kept');
    }

    /*
        The renewal took a while: in the meantime the account may have been removed in Discord (the stored login was
        revoked) or a new login stored a newer token. Writing the result back would recreate a revoked login and keep
        renewing it, so it is discarded. Checked right before the synchronous write, nothing can run in between.
    */
    if (RustPlusAuth.getAuthGeneration(`${steamId}`) !== generation || !isRegistered(`${steamId}`)) {
        log(`Rust+ token: the renewed token of ${steamId} is discarded, the login was removed or replaced meanwhile`);
        throw renewalDiscardedError(steamId);
    }

    log(`Rust+ token: renewed for ${renewed.steamId}`);
    return storeAuth(`${steamId}`, renewed.token, servers.servers, session.refreshToken);
}

function renewalDiscardedError(steamId) {
    const error = new Error(`The stored login of ${steamId} was removed or replaced during the renewal.`);
    Object.assign(error, { code: RENEWAL_DISCARDED });
    return error;
}

module.exports = {
    RENEWAL_DISCARDED: RENEWAL_DISCARDED,
    SteamLogin: SteamLogin,
    loginToRustPlus: loginToRustPlus,
    fetchSyncData: fetchSyncData,
    storeAuth: storeAuth,
    renewAuth: renewAuth,
};
