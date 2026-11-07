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
    HTTP and HTML helpers of the Rust+ login (util/rustplusLogin.js).

    The login is a browser flow without a browser: read a page, submit the form it contains, follow the redirect
    and read the result. Everything in here is therefore free of Steam/Rust+ specific flow logic and can be tested
    on its own.

    Verified against the live pages on 2026-11-07.
*/

const Axios = require('axios');
const Querystring = require('querystring');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/126.0.0.0 Safari/537.36';

/* Minimal cookie jar: the login flow talks to facepunch.com and steamcommunity.com. */
class CookieJar {
    constructor() {
        this.cookies = [];
    }

    storeFromResponse(url, setCookie) {
        for (const raw of setCookie || []) this.store(url, raw);
    }

    store(url, raw) {
        const host = new URL(url).hostname;
        const [pair, ...attributes] = `${raw}`.split(';');
        const separator = pair.indexOf('=');
        if (separator <= 0) return;

        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        const domainAttribute = attributes
            .map((e) => e.trim())
            .find((e) => e.toLowerCase().startsWith('domain='));
        const domain = domainAttribute ?
            domainAttribute.split('=')[1].trim().replace(/^\./, '') : host;

        this.cookies = this.cookies.filter((e) => !(e.name === name && e.domain === domain));
        this.cookies.push({ name, value, domain });
    }

    header(url) {
        const host = new URL(url).hostname;
        return this.cookies
            .filter((e) => host === e.domain || host.endsWith(`.${e.domain}`))
            .map((e) => `${e.name}=${e.value}`)
            .join('; ');
    }
}

/* GET/POST without following redirects, so the login flow can be followed step by step. */
async function request(method, url, jar, { data = null, headers = {} } = {}) {
    const host = new URL(url).hostname;
    const cookie = jar.header(url);

    const defaults = {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
    };

    /* Steam rejects form posts without the headers a browser sends along. */
    if (method === 'POST' && host === 'steamcommunity.com') {
        defaults.origin = `https://${host}`;
        defaults.referer = `${url.split('?')[0]}`;
    }

    const response = await Axios.request({
        method: method,
        url: url,
        data: data,
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: 30000,
        headers: Object.assign(defaults, cookie ? { cookie: cookie } : {}, headers),
    });

    jar.storeFromResponse(url, response.headers['set-cookie']);
    return response;
}

/*
    Submits a parsed form the way the browser would. Steam's OpenID consent form is multipart/form-data, posting
    it url encoded is answered with the generic "Steam Community :: Error" page.
*/
async function postForm(url, form, jar) {
    if (`${form.enctype}`.startsWith('multipart/form-data')) {
        const body = new FormData();
        for (const [name, value] of Object.entries(form.fields)) body.append(name, value);

        return await request('POST', url, jar, { data: body });
    }

    return await request('POST', url, jar, {
        data: Querystring.stringify(form.fields),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
}

/* Names (never the values) of the cookies a request would send, for the log. */
function describeCookies(jar, url) {
    const names = jar.cookies
        .filter((e) => {
            const host = new URL(url).hostname;
            return host === e.domain || host.endsWith(`.${e.domain}`);
        })
        .map((e) => e.name);

    return names.length === 0 ? 'none' : names.join(', ');
}


function extractVerificationToken(html) {
    const match = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i.exec(`${html}`) ||
        /value="([^"]+)"[^>]*name="__RequestVerificationToken"/i.exec(`${html}`);
    return match ? match[1] : null;
}

/*
    The /signin-steam page hands the account data to the Rust+ app through a webview bridge. The payload is part
    of the page (JSON or a JS object literal, sometimes escaped), so it can be read without a browser.
*/
function parseAuthFromHtml(html) {
    /* Unescape the payload of an inline script and drop the braces, so both variants parse the same way. */
    const text = `${html}`.replace(/\\"/g, '"').replace(/\\'/g, "'");

    const steamId = /["']?SteamId["']?\s*:\s*["']?(\d{17})["']?/i.exec(text) ||
        /[?&]steamId=(\d{17})/i.exec(text);
    const token = /["']?Token["']?\s*:\s*["']([^"']{20,})["']/i.exec(text) ||
        /[?&]token=([^&"'\s]{20,})/i.exec(text);

    if (steamId && token) return { steamId: steamId[1], token: token[1] };

    /* Fall back to a plain JSON payload, e.g. {"SteamId":"...","Token":"..."}. */
    for (const jsonCandidate of text.matchAll(/\{[^{}]{20,400}\}/g)) {
        try {
            const data = JSON.parse(jsonCandidate[0]);
            const id = data.SteamId || data.steamId;
            const value = data.Token || data.token;
            if (id && value) return { steamId: `${id}`, token: value };
        }
        catch (e) { /* not this one */ }
    }

    return null;
}


/* Attributes of a single tag, in any quoting style ("x", 'x' or x). */
function parseAttributes(tag) {
    const attributes = {};
    const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

    for (const match of `${tag}`.matchAll(pattern)) {
        const value = (match[2] !== undefined) ? match[2] : ((match[3] !== undefined) ? match[3] : match[4]);
        attributes[match[1].toLowerCase()] = value;
    }

    return attributes;
}

/*
    Forms of a page together with their fields. Steam's OpenID pages mark up their forms in different ways
    (double or single quotes, hidden inputs before the visible button, ...), so the attributes are parsed
    generically. The predicate selects the form that should be submitted.
*/
function findForm(html, predicate = null) {
    const matches = (form) => (predicate === null) ?
        Object.keys(form.fields).length > 0 :
        predicate(form);

    for (const formMatch of `${html}`.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)) {
        const attributes = parseAttributes(formMatch[1]);

        const fields = {};
        for (const input of formMatch[2].matchAll(/<input([^>]*)>/gi)) {
            const inputAttributes = parseAttributes(input[1]);
            if (inputAttributes.name) {
                fields[inputAttributes.name] = (inputAttributes.value === undefined) ? '' : inputAttributes.value;
            }
        }

        const form = {
            action: attributes.action === undefined ? null : attributes.action,
            method: (attributes.method === undefined ? 'get' : attributes.method).toLowerCase(),
            enctype: (attributes.enctype === undefined ?
                'application/x-www-form-urlencoded' : attributes.enctype).toLowerCase(),
            fields: fields,
        };

        if (matches(form)) return form;
    }

    return null;
}

function extractTitle(html) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(`${html}`);
    return (title === null) ? 'none' : title[1].trim().replace(/\s+/g, ' ').slice(0, 80);
}

/*
    The Steam login page (which means the session cookies were not accepted). Its modern variant is JS driven and
    has no named inputs, so it is identified by the Steam Guard code fields it always contains plus its title.
    OpenID pages carry openid.* fields and are never the login form.
*/
function isSteamLoginPage(html) {
    const text = `${html}`;

    if (/name=["']?openid\./i.test(text)) return false;
    if (/<input[^>]*name=["']?username/i.test(text)) return true;

    return /(id=["']?(authcode|twofactorcode_entry)["']?|authcode_entry_input)/i.test(text) &&
        /^sign in$/i.test(extractTitle(text));
}

/* Short fingerprint of a page, so a failed login can be diagnosed from the log. */
function describePage(html) {
    const text = `${html}`;

    const forms = [...text.matchAll(/<form[^>]*>/gi)].length;

    return `title "${extractTitle(text)}", forms ${forms}, ` +
        `openid fields ${/name=["']?openid\./i.test(text) ? 'yes' : 'no'}, ` +
        `steam login form ${isSteamLoginPage(text) ? 'yes' : 'no'}`;
}


/* Redirects a page asks for itself (meta refresh, javascript or a link back to the Rust+ page). */
function findRedirectTarget(html, baseUrl) {
    const text = `${html}`;
    const candidates = [];

    const meta = /<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?[^"'>]*url=([^"'>\s]+)/i.exec(text);
    if (meta) candidates.push(meta[1]);

    const script = /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i.exec(text);
    if (script) candidates.push(script[1]);

    const link = /<a[^>]*href=["']([^"']*signin-steam[^"']*)["']/i.exec(text);
    if (link) candidates.push(link[1]);

    for (const candidate of candidates) {
        try {
            const url = new URL(candidate.replace(/&amp;/g, '&'), baseUrl).href;
            if (url !== baseUrl) return url;
        }
        catch (e) { /* not a usable url */ }
    }

    return null;
}

/*
    The Rust+ login hands the browser a Steam OpenID request. Steam answers it with a consent page, but the request
    can also be posted straight back: that is what the consent form does, and it is how headless logins work.
*/
function buildOpenIdLoginFields(url) {
    let target = null;
    try {
        target = new URL(url);
    }
    catch (e) {
        return null;
    }

    if (target.hostname !== 'steamcommunity.com' || !/^\/openid\/login\/?$/i.test(target.pathname)) return null;

    const fields = {};
    for (const [key, value] of target.searchParams) {
        if (key.startsWith('openid.') || key === 'action') fields[key] = value;
    }

    const mode = fields['openid.mode'];
    if (mode !== 'checkid_setup' && mode !== 'checkid_immediate') return null;

    fields.action = 'steam_openid_login';
    return fields;
}

module.exports = {
    USER_AGENT: USER_AGENT,
    CookieJar: CookieJar,
    request: request,
    postForm: postForm,
    describeCookies: describeCookies,
    parseAttributes: parseAttributes,
    findForm: findForm,
    isSteamLoginPage: isSteamLoginPage,
    extractTitle: extractTitle,
    describePage: describePage,
    findRedirectTarget: findRedirectTarget,
    buildOpenIdLoginFields: buildOpenIdLoginFields,
    extractVerificationToken: extractVerificationToken,
    parseAuthFromHtml: parseAuthFromHtml,
};
