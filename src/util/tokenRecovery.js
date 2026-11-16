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
    Facepunch rejects an account token at any time - 403 (ASP.NET "Forbidden" with a traceId) or 401, for the history
    read and for the socket handshake. Measured live: a token minted at 17:33 was refused from 18:57 on, and the bot kept
    retrying with it every five minutes because the handshake path renewed nothing.

    One policy for every source of a rejection instead of one per caller:
    - the second rejection in a row renews the token with the stored Steam refresh token,
    - at most one renewal every RENEW_MIN_INTERVAL_MS, so a broken token cannot flood Steam with logins,
    - after MAX_RENEWALS renewals that do not lead to a stable connection the account is left alone for BACKOFF_MS and
      the owner of the credentials is asked for a new login,
    - a working connection (markHealthy) resets everything,
    - after a renewal the connection is rebuilt, or a reconnect that waits on the backoff starts right away.
*/

const CredentialOwner = require('./credentialOwner.js');
const RustPlusLogin = require('./rustplusLogin.js');

const STRIKES_BEFORE_RENEW = 2;
const RENEW_MIN_INTERVAL_MS = 2 * 60 * 1000;
const MAX_RENEWALS = 3;
const BACKOFF_MS = 30 * 60 * 1000;

const states = new Map();   /* steamId -> state */

function stateOf(steamId) {
    const key = `${steamId}`;
    let state = states.get(key);

    if (state === undefined) {
        state = {
            strikes: 0,          /* rejections in a row */
            renewals: 0,         /* renewals since the last working connection */
            lastRenewMs: 0,      /* throttle of the renewals */
            renewing: false,     /* a renewal is running right now */
            backoffUntilMs: 0,   /* no renewal before this */
        };

        states.set(key, state);
    }

    return state;
}

/* For tests and for a full reset. */
function reset() {
    states.clear();
}

/* The connection works again: strikes, renewals and the backoff of this account are forgotten. */
function markHealthy(steamId) {
    states.delete(`${steamId}`);
}

function isBackedOff(steamId, now = Date.now()) {
    const state = stateOf(steamId);

    return state.backoffUntilMs > now;
}

/* The count of renewals since the last working connection (for tests and the log). */
function renewalCount(steamId) {
    return stateOf(steamId).renewals;
}

/*
    A read that went through means the token works again: the strikes are forgotten. The renewal count is not touched -
    only a working connection (markHealthy) proves that a renewal helped.
*/
function markReadSuccessful(steamId) {
    stateOf(steamId).strikes = 0;
}

/*
    Rebuild the connection of the guild, or start a reconnect that waits on the backoff right away. A renewed token is
    usable immediately, waiting up to five minutes for it makes no sense.
*/
function reconnect(client, guildId, steamId, reason) {
    const instances = client.rustplusInstances || {};
    const rustplus = instances[guildId];

    if (rustplus && typeof rustplus.rebuildConnection === 'function' &&
        (rustplus.playerId === undefined || `${rustplus.playerId}` === `${steamId}`)) {
        rustplus.rebuildConnection(reason);
        return;
    }

    const timers = client.rustplusReconnectTimers;
    if (!timers || !timers[guildId]) return;

    clearTimeout(timers[guildId]);
    timers[guildId] = null;

    if (client.rustplusReconnectAttempts) client.rustplusReconnectAttempts[guildId] = 0;

    const instance = client.getInstance(guildId);
    const server = (instance && instance.serverList) ? instance.serverList[instance.activeServer] : null;
    if (!server) return;

    client.createRustplusInstance(guildId, server.serverIp, server.appPort, server.steamId, server.playerToken);
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

/*
    Report a rejected token. Returns 'skipped' (not enough strikes, throttled, a renewal is running or the account is in
    backoff), 'renewed' or 'failed'.
*/
async function reportRejected(client, guildId, steamId, reason) {
    const now = Date.now();
    const state = stateOf(steamId);

    if (state.backoffUntilMs > now) {
        client.log(client.intlGet(null, 'infoCap'),
            `The Rust+ token of ${steamId} is rejected (${reason}), no new login until the backoff is over.`, 'debug');
        return 'skipped';
    }

    if (state.renewing) return 'skipped';

    state.strikes += 1;

    if (state.strikes < STRIKES_BEFORE_RENEW) {
        client.log(client.intlGet(null, 'warningCap'),
            `The Rust+ API rejected one request of ${steamId} (${state.strikes}/${STRIKES_BEFORE_RENEW}, ${reason}), ` +
            'the token is renewed if it happens again.', 'debug');
        return 'skipped';
    }

    if (state.lastRenewMs && (now - state.lastRenewMs) < RENEW_MIN_INTERVAL_MS) {
        client.log(client.intlGet(null, 'infoCap'),
            `The token of ${steamId} was renewed a moment ago, no second login for ${reason}.`, 'debug');
        return 'skipped';
    }

    state.strikes = 0;
    state.lastRenewMs = now;
    state.renewing = true;

    try {
        await RustPlusLogin.renewAuth(steamId, (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug'));

        state.renewals += 1;

        client.log(client.intlGet(null, 'infoCap'),
            `The Rust+ account token of ${steamId} was rejected (${reason}) and renewed ` +
            `(${state.renewals}/${MAX_RENEWALS} since the last working connection).`);

        reconnect(client, guildId, steamId, 'the account token was renewed');

        if (state.renewals >= MAX_RENEWALS) {
            state.backoffUntilMs = Date.now() + BACKOFF_MS;

            client.log(client.intlGet(null, 'warningCap'),
                `${state.renewals} renewals did not lead to a stable connection, no new login for ` +
                `${BACKOFF_MS / 60000} minutes.`, 'warn');

            await notifyOwner(client, guildId, steamId);
        }

        return 'renewed';
    }
    catch (e) {
        state.renewals += 1;

        client.log(client.intlGet(null, 'warningCap'),
            `The Rust+ account token of ${steamId} could not be renewed (${e && e.message ? e.message : e}). ` +
            'Use "/credentials login" in Discord.', 'warn');

        if (state.renewals >= MAX_RENEWALS) {
            state.backoffUntilMs = Date.now() + BACKOFF_MS;

            await notifyOwner(client, guildId, steamId);
        }

        return 'failed';
    }
    finally {
        state.renewing = false;
    }
}

module.exports = {
    STRIKES_BEFORE_RENEW: STRIKES_BEFORE_RENEW,
    RENEW_MIN_INTERVAL_MS: RENEW_MIN_INTERVAL_MS,
    MAX_RENEWALS: MAX_RENEWALS,
    BACKOFF_MS: BACKOFF_MS,
    reportRejected: reportRejected,
    markHealthy: markHealthy,
    markReadSuccessful: markReadSuccessful,
    isBackedOff: isBackedOff,
    renewalCount: renewalCount,
    reconnect: reconnect,
    reset: reset,
};
