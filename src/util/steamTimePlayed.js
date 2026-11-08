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
    The Rust playtime of a steam account as Steam reports it: the runtime of the Rust client, which is the number the
    steam profile shows. BattleMetrics counts server sessions instead and can differ a lot (a session that is never
    closed keeps counting).

    Not used by an embed at the moment - kept for a later use. BattleMetrics reports no steam id for the players of a
    server, so there is no reliable id to ask Steam for: a name lookup (ResolveVanityURL) matched 10 of 35 names and
    only 1 of them had a readable playtime. A caller warms the cache with warmPlaytimes(steamIds) and reads it with
    getCachedPlaytime(steamId).

    Optional: without a Steam Web API key (RPP_STEAM_API_KEY, free at https://steamcommunity.com/dev/apikey) or with a
    private profile nothing is returned.
*/

const Axios = require('axios');

const Config = require('../../config');

const RUST_APP_ID = 252490;
const CACHE_TTL_MS = 60 * 60 * 1000;   /* the playtime of an account changes slowly */
const REQUEST_TIMEOUT_MS = 15000;
const API_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

/* steamId -> { totalMinutes, twoWeeksMinutes, fetchedAt } */
const cache = new Map();

function isEnabled() {
    return typeof Config.steam.apiKey === 'string' && Config.steam.apiKey.trim() !== '';
}

/*
    The playtime of the response of IPlayerService/GetOwnedGames (minutes). An empty response means the profile is not
    public, which is not an error.
*/
function parseOwnedGamesPayload(payload) {
    const response = (payload && payload.response) ? payload.response : null;
    const games = (response && Array.isArray(response.games)) ? response.games : [];

    const game = games.find((entry) => entry && Number(entry.appid) === RUST_APP_ID);
    if (!game) return null;

    const totalMinutes = Number(game.playtime_forever);
    if (!Number.isFinite(totalMinutes)) return null;

    const twoWeeksMinutes = Number(game.playtime_2weeks);

    return {
        totalMinutes: totalMinutes,
        twoWeeksMinutes: Number.isFinite(twoWeeksMinutes) ? twoWeeksMinutes : null,
    };
}

/* The cached playtime of an account, or null when it was never fetched. */
function getCachedPlaytime(steamId) {
    const entry = cache.get(`${steamId}`);

    return entry ? entry : null;
}

/* Ask Steam for the playtime of one account. Returns null when it cannot be read (private profile, no key, error). */
async function fetchPlaytime(steamId) {
    try {
        const response = await Axios.get(API_URL, {
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true,
            params: {
                key: Config.steam.apiKey,
                steamid: `${steamId}`,
                include_appinfo: 0,
                'appids_filter[0]': RUST_APP_ID,
            },
        });

        if (response.status !== 200) return null;

        return parseOwnedGamesPayload(response.data);
    }
    catch (e) {
        return null;
    }
}

/*
    Fetch the playtime of the given accounts and fill the cache. Cached accounts are skipped, a failed read keeps the
    previous value and is retried after the TTL.
*/
async function warmPlaytimes(steamIds) {
    if (!isEnabled()) return;

    const unique = [...new Set((steamIds || []).filter((id) => id !== null && id !== undefined).map((id) => `${id}`))];

    for (const steamId of unique) {
        const cached = cache.get(steamId);
        if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) continue;

        const playtime = await fetchPlaytime(steamId);
        if (playtime === null) continue;

        cache.set(steamId, Object.assign({}, playtime, { fetchedAt: Date.now() }));
    }
}

module.exports = {
    RUST_APP_ID: RUST_APP_ID,
    isEnabled: isEnabled,
    parseOwnedGamesPayload: parseOwnedGamesPayload,
    getCachedPlaytime: getCachedPlaytime,
    warmPlaytimes: warmPlaytimes,
};
