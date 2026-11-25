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

const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const CredentialRevocation = require('../src/util/credentialRevocation.js');

Test.describe('stored logins of removed credentials', () => {
    function credentialsDir(t, files) {
        const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'rpp-credentials-'));
        t.after(() => Fs.rmSync(dir, { recursive: true, force: true }));
        for (const [name, content] of Object.entries(files)) {
            Fs.writeFileSync(Path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
        }
        return dir;
    }

    function fakes() {
        const calls = [];
        return {
            calls,
            pushListener: { stopAccount: (id) => calls.push(['stop', id]) },
            rustplusPush: { removePush: (id) => calls.push(['push', id]) },
            rustplusAuth: { removeAuth: (id) => calls.push(['auth', id]) },
        };
    }

    Test.it('removes the login, the push registration and the listener when no guild lists the account', (t) => {
        const dir = credentialsDir(t, { 'g1.json': { hoster: null }, 'g2.json': { hoster: null, 222: {} } });
        const deps = Object.assign(fakes(), { credentialsDir: dir });

        Assert.strictEqual(CredentialRevocation.revokeIfUnregistered('111', deps), true);
        Assert.deepStrictEqual(deps.calls, [['stop', '111'], ['push', '111'], ['auth', '111']]);
    });

    Test.it('keeps the login while another guild still lists the account', (t) => {
        const dir = credentialsDir(t, { 'g1.json': { hoster: null }, 'g2.json': { 111: { discord_user_id: 'u' } } });
        const deps = Object.assign(fakes(), { credentialsDir: dir });

        Assert.strictEqual(CredentialRevocation.revokeIfUnregistered('111', deps), false);
        Assert.deepStrictEqual(deps.calls, []);
    });

    Test.it('keeps the login when a credentials file cannot be read', (t) => {
        const dir = credentialsDir(t, { 'g1.json': '{ broken' });
        const deps = Object.assign(fakes(), { credentialsDir: dir });

        Assert.strictEqual(CredentialRevocation.revokeIfUnregistered('111', deps), false);
        Assert.deepStrictEqual(deps.calls, []);
    });
});
