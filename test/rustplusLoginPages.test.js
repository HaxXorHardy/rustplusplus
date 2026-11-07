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

const Assert = require('node:assert');
const Test = require('node:test');

const RustPlusLoginPages = require('../src/util/rustplusLoginPages.js');

/* Fake account data, the parser only cares about the shape. */
const STEAM_ID = '76561198000000000';
const TOKEN = 'eyJzdGVhbUlkIjoiNzY1NjExOTgwMDAwMDAwMDAiLCJleHAiOjE3OTUyNTU2MjR9.c2lnbmF0dXJlLXNpZ25hdHVyZQ==';

Test.describe('RustPlusLoginPages.parseAuthFromHtml', () => {
    Test.it('reads the payload of a JS object literal', () => {
        const html = `<script>window.ReactNativeWebView.postMessage(JSON.stringify({SteamId:"${STEAM_ID}",` +
            `Token:"${TOKEN}"}))</script>`;

        Assert.deepStrictEqual(RustPlusLoginPages.parseAuthFromHtml(html), { steamId: STEAM_ID, token: TOKEN });
    });

    Test.it('reads an escaped JSON payload', () => {
        const html = `send(\\"{\\"SteamId\\":\\"${STEAM_ID}\\",\\"Token\\":\\"${TOKEN}\\"}\\")`;

        Assert.deepStrictEqual(RustPlusLoginPages.parseAuthFromHtml(html), { steamId: STEAM_ID, token: TOKEN });
    });

    Test.it('reads a plain JSON payload', () => {
        const html = `<div data-session='{"SteamId":"${STEAM_ID}","Token":"${TOKEN}"}'></div>`;

        Assert.deepStrictEqual(RustPlusLoginPages.parseAuthFromHtml(html), { steamId: STEAM_ID, token: TOKEN });
    });

    Test.it('returns null when the page carries no account data', () => {
        Assert.strictEqual(RustPlusLoginPages.parseAuthFromHtml('<html><body>nope</body></html>'), null);
        Assert.strictEqual(RustPlusLoginPages.parseAuthFromHtml(''), null);
    });
});

Test.describe('RustPlusLoginPages.extractVerificationToken', () => {
    Test.it('reads the antiforgery token of the login form', () => {
        const html = '<form method="post"><input name="returnUrl" />' +
            '<input name="__RequestVerificationToken" type="hidden" value="abc123" /></form>';

        Assert.strictEqual(RustPlusLoginPages.extractVerificationToken(html), 'abc123');
        Assert.strictEqual(RustPlusLoginPages.extractVerificationToken('<html></html>'), null);
    });
});

Test.describe('RustPlusLoginPages.findForm', () => {
    Test.it('reads action and hidden fields of a confirmation form', () => {
        const html = '<form action="https://steamcommunity.com/openid/login" method="post">' +
            '<input type="hidden" name="openid.mode" value="id_res"/>' +
            '<input type="hidden" name="openid.identity" value="x"/></form>';

        const form = RustPlusLoginPages.findForm(html);
        Assert.strictEqual(form.action, 'https://steamcommunity.com/openid/login');
        Assert.deepStrictEqual(form.fields, { 'openid.mode': 'id_res', 'openid.identity': 'x' });
    });

    Test.it('reads the enctype of the form', () => {
        const html = '<form enctype="multipart/form-data" action="https://steamcommunity.com/openid/login" ' +
            'method="POST"><input type="hidden" name="openid.mode" value="checkid_setup" /></form>';

        Assert.strictEqual(RustPlusLoginPages.findForm(html).enctype, 'multipart/form-data');
        Assert.strictEqual(RustPlusLoginPages.findForm('<form action="x"><input name="a" /></form>').enctype,
            'application/x-www-form-urlencoded');
    });

    Test.it('returns null without a useful form', () => {
        Assert.strictEqual(RustPlusLoginPages.findForm('<html></html>'), null);
        Assert.strictEqual(RustPlusLoginPages.findForm('<form action="x"></form>'), null);
    });
});

Test.describe('RustPlusLoginPages.buildOpenIdLoginFields', () => {
    const OPENID_URL = 'https://steamcommunity.com/openid/login?openid.claimed_id=' +
        'http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.identity=' +
        'http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.mode=checkid_setup&openid.ns=' +
        'http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.realm=https%3A%2F%2Fcompanion-rust.facepunch.com' +
        '&openid.return_to=https%3A%2F%2Fcompanion-rust.facepunch.com%2Fsignin-steam';

    Test.it('turns the OpenID request url into the form Steam expects', () => {
        const fields = RustPlusLoginPages.buildOpenIdLoginFields(OPENID_URL);

        Assert.strictEqual(fields.action, 'steam_openid_login');
        Assert.strictEqual(fields['openid.mode'], 'checkid_setup');
        Assert.strictEqual(fields['openid.realm'], 'https://companion-rust.facepunch.com');
        Assert.strictEqual(fields['openid.return_to'], 'https://companion-rust.facepunch.com/signin-steam');
    });

    Test.it('ignores urls that are no OpenID request', () => {
        Assert.strictEqual(RustPlusLoginPages.buildOpenIdLoginFields(
            'https://companion-rust.facepunch.com/signin-steam?state=1'), null);
        Assert.strictEqual(RustPlusLoginPages.buildOpenIdLoginFields(
            'https://steamcommunity.com/openid/login?openid.ns=x'), null);
        Assert.strictEqual(RustPlusLoginPages.buildOpenIdLoginFields('not-a-url'), null);
        Assert.strictEqual(RustPlusLoginPages.buildOpenIdLoginFields(null), null);
    });
});

Test.describe('RustPlusLoginPages.isSteamLoginPage', () => {
    Test.it('recognises the Steam login page in both markups', () => {
        Assert.strictEqual(RustPlusLoginPages.isSteamLoginPage('<form><input name="username"></form>'), true);
        Assert.strictEqual(RustPlusLoginPages.isSteamLoginPage(
            '<title>Sign In</title><input id="authcode" class="authcode_entry_input">'), true);
    });

    Test.it('is false for OpenID pages and other pages', () => {
        Assert.strictEqual(RustPlusLoginPages.isSteamLoginPage(
            '<title>Sign In</title><input id="authcode" class="authcode_entry_input">' +
            '<input name="openid.mode" value="id_res">'), false);
        Assert.strictEqual(RustPlusLoginPages.isSteamLoginPage('<title>Sign In</title><p>hello</p>'), false);
        Assert.strictEqual(RustPlusLoginPages.isSteamLoginPage('<html></html>'), false);
    });
});

Test.describe('RustPlusLoginPages.findRedirectTarget', () => {
    Test.it('follows a meta refresh, a javascript redirect and a link to the Rust+ page', () => {
        Assert.strictEqual(RustPlusLoginPages.findRedirectTarget(
            '<meta http-equiv="refresh" content="0; url=https://companion-rust.facepunch.com/signin-steam?state=1">',
            'https://steamcommunity.com/openid/login'),
            'https://companion-rust.facepunch.com/signin-steam?state=1');

        Assert.strictEqual(RustPlusLoginPages.findRedirectTarget(
            '<script>window.location.href = "/x";</script>', 'https://steamcommunity.com/openid/login'),
            'https://steamcommunity.com/x');

        Assert.strictEqual(RustPlusLoginPages.findRedirectTarget(
            '<a href="https://companion-rust.facepunch.com/signin-steam?state=2">go</a>', 'https://a.example/b'),
            'https://companion-rust.facepunch.com/signin-steam?state=2');
    });

    Test.it('returns null when the page points at itself or nowhere', () => {
        Assert.strictEqual(RustPlusLoginPages.findRedirectTarget('<a href="https://a.example/b">x</a>',
            'https://a.example/b'), null);
        Assert.strictEqual(RustPlusLoginPages.findRedirectTarget('<html></html>', 'https://a.example/b'), null);
    });
});

Test.describe('RustPlusLoginPages.describePage', () => {
    Test.it('fingerprints a page for the log', () => {
        const description = RustPlusLoginPages.describePage(
            '<title>Sign In</title><form action="/login"><input name="username"></form>');

        Assert.match(description, /title "Sign In"/);
        Assert.match(description, /forms 1/);
        Assert.match(description, /openid fields no/);
        Assert.match(description, /steam login form yes/);
    });
});

Test.describe('RustPlusLoginPages.CookieJar', () => {
    Test.it('stores cookies per domain and only sends matching ones', () => {
        const jar = new RustPlusLoginPages.CookieJar();

        jar.storeFromResponse('https://companion-rust.facepunch.com/login', [
            '.AspNetCore.Antiforgery.xyz=value1; path=/; httponly',
            'plain=value2',
        ]);
        jar.storeFromResponse('https://steamcommunity.com/openid/login', [
            'steamLoginSecure=steamvalue; domain=.steamcommunity.com; path=/; secure',
        ]);

        Assert.strictEqual(jar.header('https://companion-rust.facepunch.com/signin-steam'),
            '.AspNetCore.Antiforgery.xyz=value1; plain=value2');
        Assert.strictEqual(jar.header('https://steamcommunity.com/openid/login'),
            'steamLoginSecure=steamvalue');
        Assert.strictEqual(jar.header('https://login.steampowered.com/jwt/finalizelogin'), '');
    });

    Test.it('replaces a cookie with the same name and domain', () => {
        const jar = new RustPlusLoginPages.CookieJar();

        jar.store('https://companion-rust.facepunch.com/', 'a=1');
        jar.store('https://companion-rust.facepunch.com/', 'a=2');

        Assert.strictEqual(jar.header('https://companion-rust.facepunch.com/'), 'a=2');
    });
});
