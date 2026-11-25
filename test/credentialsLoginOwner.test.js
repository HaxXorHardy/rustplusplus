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

const CredentialsLoginHandler = require('../src/handlers/credentialsLoginHandler.js');
const InstanceUtils = require('../src/util/instanceUtils.js');

Test.describe('login of an account another member registered', () => {
    Test.it('names the other owner, and nobody for the own account or a new one', (t) => {
        t.mock.method(InstanceUtils, 'readCredentialsFile', () => ({
            hoster: '111', 111: { discord_user_id: 'owner' },
        }));

        Assert.strictEqual(CredentialsLoginHandler.getOtherOwner('g', '111', 'intruder'), 'owner');
        Assert.strictEqual(CredentialsLoginHandler.getOtherOwner('g', '111', 'owner'), null);
        Assert.strictEqual(CredentialsLoginHandler.getOtherOwner('g', '222', 'intruder'), null);
    });
});
