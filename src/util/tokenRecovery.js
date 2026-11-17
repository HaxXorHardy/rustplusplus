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
    The one place that renews the Rust+ account token of a steam account.

    Facepunch keeps one token per account: a renewal mints a new one and the relay answers the requests of every socket
    that was opened with the old one with `not_found`. Before this module there were four uncoordinated renewal paths
    (connect(), the poll, the history read and the handshake error) and every one of them only rebuilt the socket of
    its own guild - two of them could run at the same time and each renewal killed the socket the other one had just
    opened. Everything goes through here now:

    - renew() is single-flight per steam id: a second caller waits for the running renewal and gets its result,
    - at most one renewal every RENEW_MIN_INTERVAL_MS, so a broken token cannot flood Steam with logins,
    - a rejected token (401/403 of the history read or the handshake) is renewed on the second rejection in a row,
    - after MAX_RENEWALS renewals that do not lead to a working connection the account is left alone for BACKOFF_MS
      and the owner of the credentials is asked for a new login,
    - a token that expires soon is renewed by one hourly check (start()), not by every connection on its own,
    - after every renewal ALL connections of the account are rebuilt (every guild, the team leader connections and the
      reconnects that wait on their backoff), because all of them hold the token that was just invalidated,
    - a working connection (markHealthy) resets the counters.
*/

const Config = require('../../config');
const CredentialOwner = require('./credentialOwner.js');
const RustPlusAuth = require('./rustplusAuth.js');
const RustPlusLogin = require('./rustplusLogin.js');

const STRIKES_BEFORE_RENEW = 2;
const RENEW_MIN_INTERVAL_MS = 2 * 60 * 1000;
const MAX_RENEWALS = 3;
const BACKOFF_MS = 30 * 60 * 1000;

/* How often the expiry of the stored tokens is checked, and how long a failed proactive renewal waits. */
const EXPIRY_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/*
    A renewal that does not move the expiry out of the renewal window (Facepunch hands out the same token, or tokens
    that live shorter than RPP_RUSTPLUS_TOKEN_RENEW_BEFORE) is not repeated for this long - otherwise the hourly check
    renews and rebuilds every socket every hour.
*/
const USELESS_RENEWAL_PAUSE_MS = 12 * 60 * 60 * 1000;

/*
    A socket that answered a poll this recently proves that its token works. A refused history read or handshake is
    then not about the token (a proxy, a rate limit, a hiccup of Facepunch), and renewing would only kill that socket.
*/
const LIVE_SOCKET_PROOF_MS = 2 * 60 * 1000;

const states = new Map();   /* steamId -> state */
const tokenListeners = new Set();   /* called with the steam id after the stored token changed */
let expiryTimer = null;

function stateOf(steamId) {
    const key = `${steamId}`;
    let state = states.get(key);

    if (state === undefined) {
        state = {
            strikes: 0,             /* rejections in a row */
            renewals: 0,            /* renewals because of a rejection since the last working connection */
            lastRenewMs: 0,         /* throttle of the renewals */
            inflight: null,         /* the running renewal (promise), shared by every caller */
            backoffUntilMs: 0,      /* no renewal before this */
            lastProactiveFailMs: null, /* a proactive renewal that failed is retried after EXPIRY_CHECK_INTERVAL_MS */
            proactivePausedUntilMs: 0, /* no proactive renewal before this (the last one did not help) */
        };

        states.set(key, state);
    }

    return state;
}

/* For tests and for a full reset. */
function reset() {
    states.clear();
    stop();
}

/* The connection works again: strikes, renewals and the backoff of this account are forgotten. */
function markHealthy(steamId) {
    const state = states.get(`${steamId}`);
    if (!state) return;

    /*
        Only the counters of the rejections are forgotten. The throttle and the pause of the proactive renewal stay:
        every renewal is followed by a working connection, so forgetting them here would let the next renewal start
        right away (that is how the hourly renewal kept rebuilding the sockets).
    */
    state.strikes = 0;
    state.renewals = 0;
    state.backoffUntilMs = 0;
}

function isBackedOff(steamId, now = Date.now()) {
    const state = states.get(`${steamId}`);

    return Boolean(state) && state.backoffUntilMs > now;
}

function isRenewing(steamId) {
    const state = states.get(`${steamId}`);

    return Boolean(state) && state.inflight !== null;
}

/* The count of renewals since the last working connection (for tests and the log). */
function renewalCount(steamId) {
    const state = states.get(`${steamId}`);

    return state ? state.renewals : 0;
}

/*
    A read that went through means the token works again: the strikes are forgotten. The renewal count is not touched -
    only a working connection (markHealthy) proves that a renewal helped.
*/
function markReadSuccessful(steamId) {
    const state = states.get(`${steamId}`);
    if (state) state.strikes = 0;
}

/*
    Every connection that uses the token of this steam account is rebuilt: they all hold the token that was just
    replaced. Returns the count of connections that were touched.
*/
function rebuildAll(client, steamId, reason) {
    let touched = 0;
    const instances = client.rustplusInstances || {};

    for (const rustplus of Object.values(instances)) {
        if (!rustplus) continue;

        if (`${rustplus.playerId}` === `${steamId}`) {
            if (typeof rustplus.rebuildConnection === 'function') {
                rustplus.rebuildConnection(reason, { force: true });
                touched += 1;
            }
        }

        /* The connection of the team leader is a second socket of another (or the same) account. */
        const lite = rustplus.leaderRustPlusInstance;
        if (lite && `${lite.playerId}` === `${steamId}` && lite.websocket &&
            typeof lite.websocket.close === 'function') {
            try {
                /* The lite instance reconnects on its own and reads the stored token then. */
                lite.websocket.close();
                touched += 1;
            }
            catch (e) {
                /* Already closed, its reconnect runs anyway. */
            }
        }
    }

    /* A guild that waits on the backoff of its reconnect would wait up to five minutes with a usable token. */
    const timers = client.rustplusReconnectTimers || {};

    for (const guildId of Object.keys(timers)) {
        if (!timers[guildId] || instances[guildId]) continue;

        const instance = typeof client.getInstance === 'function' ? client.getInstance(guildId) : null;
        const server = (instance && instance.serverList) ? instance.serverList[instance.activeServer] : null;
        if (!server || `${server.steamId}` !== `${steamId}`) continue;

        clearTimeout(timers[guildId]);
        timers[guildId] = null;

        if (client.rustplusReconnectAttempts) client.rustplusReconnectAttempts[guildId] = 0;

        client.createRustplusInstance(guildId, server.serverIp, server.appPort, server.steamId, server.playerToken);
        touched += 1;
    }

    return touched;
}

/* Tell the owner of the credentials that the token needs a new login. */
async function notifyOwner(client, guildId, steamId) {
    try {
        const user = await CredentialOwner.getOwner(guildId, steamId);

        if (!user) {
            client.log(client.intlGet(null, 'warningCap'),
                `The Rust+ token of ${steamId} is rejected and the owner of the credentials is unknown, ` +
                'use "/credentials login" in Discord.', 'warn');
            return false;
        }

        await client.messageSend(user, {
            content: `The Rust+ token of ${steamId} keeps being rejected by Facepunch and renewing it does not help. ` +
                'Please run "/credentials login" in Discord so the bot can connect again.'
        });

        client.log(client.intlGet(null, 'infoCap'),
            `The owner of the Rust+ login of ${steamId} was asked for a new login.`);

        return true;
    }
    catch (e) {
        client.log(client.intlGet(null, 'warningCap'),
            `Could not notify the owner of ${steamId}: ${e && e.message ? e.message : e}`, 'warn');

        return false;
    }
}

/* A guild that knows this account, for the direct message to the owner. */
function guildOf(client, steamId, guildId) {
    if (guildId) return guildId;

    for (const [id, rustplus] of Object.entries(client.rustplusInstances || {})) {
        if (rustplus && `${rustplus.playerId}` === `${steamId}`) return id;
    }

    return Object.keys(client.instances || {})[0] || null;
}

/*
    Subscribe to new account tokens (a renewal here, a login). Returns the function that unsubscribes. The push
    registration (util/rustplusPushListener.js) uses it: Facepunch sends the notifications to the token it was made with.
*/
function onTokenChanged(listener) {
    tokenListeners.add(listener);

    return () => tokenListeners.delete(listener);
}

function notifyTokenChanged(steamId) {
    for (const listener of tokenListeners) {
        try {
            listener(`${steamId}`);
        }
        catch (e) {
            /* A listener must not break the renewal. */
        }
    }
}

/*
    A connection of this account that runs on the stored token and answered a poll a moment ago: the token works.
    Returns that connection or null.
*/
function liveSocketOf(client, steamId, now = Date.now()) {
    const auth = RustPlusAuth.readAuth(steamId);
    if (auth === null) return null;

    for (const rustplus of Object.values(client.rustplusInstances || {})) {
        if (!rustplus || `${rustplus.playerId}` !== `${steamId}`) continue;
        if (!rustplus.isOperational || rustplus.authToken !== auth.token) continue;

        const lastPoll = rustplus.lastSuccessfulPollMs || 0;
        if (lastPoll !== 0 && (now - lastPoll) <= LIVE_SOCKET_PROOF_MS) return rustplus;
    }

    return null;
}

/*
    Renew the token of the account. Returns 'renewed', 'failed' or 'skipped' (backoff or throttle). A caller that comes
    while a renewal is running waits for it and gets its result instead of starting a second login.

    options.proactive: the token is about to expire, not rejected. Such a renewal does not count towards MAX_RENEWALS.
    options.guildId: the guild that asked, used to find the owner for the direct message.
*/
async function renew(client, steamId, reason, options = {}) {
    const state = stateOf(steamId);

    if (state.inflight) return await state.inflight;

    const now = Date.now();

    if (state.backoffUntilMs > now) {
        client.log(client.intlGet(null, 'infoCap'),
            `The Rust+ token of ${steamId} is not renewed (${reason}): the backoff is not over yet.`, 'debug');
        return 'skipped';
    }

    if (state.lastRenewMs && (now - state.lastRenewMs) < RENEW_MIN_INTERVAL_MS) {
        client.log(client.intlGet(null, 'infoCap'),
            `The token of ${steamId} was renewed a moment ago, no second login for ${reason}.`, 'debug');
        return 'skipped';
    }

    state.lastRenewMs = now;
    state.strikes = 0;

    state.inflight = (async () => {
        try {
            const before = RustPlusAuth.readAuth(steamId);
            const oldToken = before ? before.token : null;

            const renewed = await RustPlusLogin.renewAuth(steamId,
                (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug'));

            if (!options.proactive) state.renewals += 1;
            state.lastProactiveFailMs = null;

            client.log(client.intlGet(null, 'infoCap'), options.proactive ?
                `The Rust+ account token of ${steamId} was renewed (${reason}).` :
                `The Rust+ account token of ${steamId} was rejected (${reason}) and renewed ` +
                `(${state.renewals}/${MAX_RENEWALS} since the last working connection).`);

            /* A renewal that does not reach out of the renewal window is not repeated by the hourly check. */
            if (options.proactive && RustPlusAuth.isTokenExpiringSoon(renewed || RustPlusAuth.readAuth(steamId),
                Config.general.rustplusTokenRenewBeforeSeconds)) {
                state.proactivePausedUntilMs = Date.now() + USELESS_RENEWAL_PAUSE_MS;

                const expiry = RustPlusAuth.getTokenExpiry(renewed || RustPlusAuth.readAuth(steamId));
                client.log(client.intlGet(null, 'warningCap'),
                    `The renewed token of ${steamId} expires ` +
                    `${expiry === null ? 'at an unknown time' : new Date(expiry * 1000).toISOString()}, still inside ` +
                    'RPP_RUSTPLUS_TOKEN_RENEW_BEFORE. No further proactive renewal for ' +
                    `${USELESS_RENEWAL_PAUSE_MS / 3600000} hours.`, 'warn');
            }

            /* Facepunch handed out the token the sockets already use: nothing was invalidated, nothing to rebuild. */
            const stored = RustPlusAuth.readAuth(steamId);
            if (oldToken !== null && stored !== null && stored.token === oldToken) {
                client.log(client.intlGet(null, 'infoCap'),
                    `Facepunch returned the same token for ${steamId}, the connections are kept.`, 'debug');
                return 'renewed';
            }

            notifyTokenChanged(steamId);

            const touched = rebuildAll(client, steamId, 'the account token was renewed');

            if (touched !== 0) {
                client.log(client.intlGet(null, 'infoCap'),
                    `${touched} Rust+ connection(s) of ${steamId} are rebuilt with the new token.`, 'debug');
            }

            if (!options.proactive && state.renewals >= MAX_RENEWALS) {
                state.backoffUntilMs = Date.now() + BACKOFF_MS;

                client.log(client.intlGet(null, 'warningCap'),
                    `${state.renewals} renewals did not lead to a working connection, no new login for ` +
                    `${BACKOFF_MS / 60000} minutes.`, 'warn');

                await notifyOwner(client, guildOf(client, steamId, options.guildId), steamId);
            }

            return 'renewed';
        }
        catch (e) {
            if (options.proactive) state.lastProactiveFailMs = Date.now();
            else state.renewals += 1;

            client.log(client.intlGet(null, 'warningCap'),
                `The Rust+ account token of ${steamId} could not be renewed (${e && e.message ? e.message : e}). ` +
                'Use "/credentials login" in Discord.', 'warn');

            if (!options.proactive && state.renewals >= MAX_RENEWALS) {
                state.backoffUntilMs = Date.now() + BACKOFF_MS;

                await notifyOwner(client, guildOf(client, steamId, options.guildId), steamId);
            }

            return 'failed';
        }
        finally {
            state.inflight = null;
        }
    })();

    return await state.inflight;
}

/*
    Report a rejected token (401/403 of the history read or of the handshake). One rejection may be a fluke, the second
    one in a row renews the token. Returns 'skipped', 'renewed' or 'failed'.
*/
async function reportRejected(client, guildId, steamId, reason) {
    const state = stateOf(steamId);

    /* The renewal that runs answers this rejection as well. */
    if (state.inflight) return await state.inflight;

    if (state.backoffUntilMs > Date.now()) {
        client.log(client.intlGet(null, 'infoCap'),
            `The Rust+ token of ${steamId} is rejected (${reason}), no new login until the backoff is over.`, 'debug');
        return 'skipped';
    }

    /* The token is evidently fine, a renewal would only invalidate the socket that proves it. */
    const live = liveSocketOf(client, steamId);
    if (live !== null) {
        state.strikes = 0;

        client.log(client.intlGet(null, 'infoCap'),
            `A Rust+ request of ${steamId} was refused (${reason}), but the connection of ${live.guildId} works with ` +
            'the same token - not renewing.', 'debug');
        return 'skipped';
    }

    state.strikes += 1;

    if (state.strikes < STRIKES_BEFORE_RENEW) {
        client.log(client.intlGet(null, 'warningCap'),
            `The Rust+ API rejected one request of ${steamId} (${state.strikes}/${STRIKES_BEFORE_RENEW}, ${reason}), ` +
            'the token is renewed if it happens again.', 'debug');
        return 'skipped';
    }

    return await renew(client, steamId, reason, { guildId: guildId });
}

/*
    Renew the token when it expires within RPP_RUSTPLUS_TOKEN_RENEW_BEFORE and a Steam refresh token is stored.
    An expired token without a refresh token cannot be renewed here, the credentials expiry handler tells the owner.
*/
async function renewIfDue(client, steamId, now = Date.now()) {
    const auth = RustPlusAuth.readAuth(steamId);
    if (auth === null || !auth.steamRefreshToken) return 'skipped';

    if (!RustPlusAuth.isTokenExpiringSoon(auth, Config.general.rustplusTokenRenewBeforeSeconds,
        Math.floor(now / 1000))) {
        return 'skipped';
    }

    const state = stateOf(steamId);
    if (state.inflight) return await state.inflight;

    /* The last renewal did not help (same token or a short-lived one): wait, unless the token is gone. */
    if (state.proactivePausedUntilMs > now && !RustPlusAuth.isTokenExpired(auth, Math.floor(now / 1000))) {
        return 'skipped';
    }

    /* A proactive renewal that failed is not repeated on every connect, the token is usually still valid. */
    if (state.lastProactiveFailMs !== null && (now - state.lastProactiveFailMs) < EXPIRY_CHECK_INTERVAL_MS &&
        !RustPlusAuth.isTokenExpired(auth, Math.floor(now / 1000))) {
        return 'skipped';
    }

    return await renew(client, steamId, 'the token expires soon', { proactive: true });
}

/* The hourly check of every stored login. */
async function checkAll(client) {
    for (const steamId of RustPlusAuth.listSteamIds()) {
        try {
            await renewIfDue(client, steamId);
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `The expiry check of ${steamId} failed: ${e && e.message ? e.message : e}`, 'warn');
        }
    }
}

function start(client) {
    stop();

    expiryTimer = setInterval(() => {
        checkAll(client).catch(() => undefined);
    }, EXPIRY_CHECK_INTERVAL_MS);

    if (typeof expiryTimer.unref === 'function') expiryTimer.unref();

    return checkAll(client);
}

function stop() {
    if (expiryTimer !== null) {
        clearInterval(expiryTimer);
        expiryTimer = null;
    }
}

module.exports = {
    STRIKES_BEFORE_RENEW: STRIKES_BEFORE_RENEW,
    RENEW_MIN_INTERVAL_MS: RENEW_MIN_INTERVAL_MS,
    MAX_RENEWALS: MAX_RENEWALS,
    BACKOFF_MS: BACKOFF_MS,
    EXPIRY_CHECK_INTERVAL_MS: EXPIRY_CHECK_INTERVAL_MS,
    USELESS_RENEWAL_PAUSE_MS: USELESS_RENEWAL_PAUSE_MS,
    LIVE_SOCKET_PROOF_MS: LIVE_SOCKET_PROOF_MS,
    renew: renew,
    renewIfDue: renewIfDue,
    reportRejected: reportRejected,
    markHealthy: markHealthy,
    markReadSuccessful: markReadSuccessful,
    isBackedOff: isBackedOff,
    isRenewing: isRenewing,
    liveSocketOf: liveSocketOf,
    onTokenChanged: onTokenChanged,
    notifyTokenChanged: notifyTokenChanged,
    renewalCount: renewalCount,
    rebuildAll: rebuildAll,
    /* The old name, kept for callers outside of this repository. */
    reconnect: (client, guildId, steamId, reason) => rebuildAll(client, steamId, reason),
    checkAll: checkAll,
    start: start,
    stop: stop,
    reset: reset,
};
