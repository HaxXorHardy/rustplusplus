/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

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

const Axios = require('axios');

const Constants = require('../util/constants.js');
const Timer = require('../util/timer.js');
const Utils = require('../util/utils.js');

/* Headers that make the requests look like a regular browser. Steam answers requests made without a
   browser-like User-Agent with HTTP 429 (Too Many Requests), which broke the profile scraping. */
const REQUEST_HEADERS = {
    'User-Agent': Constants.SCRAPE_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

/* Patterns used to extract the full size Steam avatar from a profile page. Steam moved the avatar out of
   an <img> tag into the OpenGraph/Twitter meta tags / image_src link, so support the new layout first and
   fall back to the legacy <img> layout for older/alternative pages. */
const STEAM_PROFILE_PICTURE_PATTERNS = [
    /<meta property="og:image" content="([^"]*_full\.jpg[^"]*)"/,
    /<link rel="image_src" href="([^"]*_full\.jpg[^"]*)"/,
    /<meta name="twitter:image" content="([^"]*_full\.jpg[^"]*)"/,
    /<img src="([^"]*_full\.jpg[^"]*)"/
];

module.exports = {
    scrape: async function (url) {
        for (let attempt = 1; attempt <= Constants.SCRAPE_MAX_ATTEMPTS; attempt += 1) {
            let response = {};
            try {
                response = await Axios.get(url, { headers: REQUEST_HEADERS });
            }
            catch (e) {
                response = e.response || {};
            }

            /* Steam rate limits (HTTP 429) or is temporarily unavailable (HTTP 503); retry with backoff. */
            const retryable = response.status === 429 || response.status === 503;
            if (!retryable || attempt === Constants.SCRAPE_MAX_ATTEMPTS) {
                return response;
            }

            await Timer.sleep(Constants.SCRAPE_RETRY_DELAY_MS * attempt);
        }

        return {};
    },

    scrapeSteamProfilePicture: async function (client, steamId) {
        const response = await module.exports.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}`);

        if (response.status !== 200 || typeof response.data !== 'string') {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfilePicture', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            return null;
        }

        for (const pattern of STEAM_PROFILE_PICTURE_PATTERNS) {
            const match = response.data.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    },

    scrapeSteamProfileName: async function (client, steamId) {
        const response = await module.exports.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}`);

        if (response.status !== 200 || typeof response.data !== 'string') {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfileName', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            return null;
        }

        let regex = new RegExp(`class="actual_persona_name">(.+?)</span>`, 'gm');
        let data = regex.exec(response.data);
        if (data) {
            return Utils.decodeHtml(data[1]);
        }

        return null;
    },

    scrapeSteamIdFromVanity: async function (client, vanity) {
        if (typeof vanity !== 'string' || vanity.trim() === '') return null;

        const url = `https://steamcommunity.com/id/${encodeURIComponent(vanity.trim())}/?xml=1`;
        const response = await module.exports.scrape(url);

        if (response.status !== 200 || typeof response.data !== 'string') {
            return null;
        }

        const steamId64Match = response.data.match(/<steamID64>(\d{17})<\/steamID64>/i);
        if (steamId64Match) {
            return steamId64Match[1];
        }

        const profileLinkMatch = response.data.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
        if (profileLinkMatch) {
            return profileLinkMatch[1];
        }

        return null;
    },
}
