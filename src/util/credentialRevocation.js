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

const Fs = require('fs');
const Path = require('path');

const CREDENTIALS_DIR = Path.join(__dirname, '..', '..', 'credentials');

/*
    The account token (credentials/rustplusAuth/<steamId>.json) is shared by every guild the account was registered
    in, and the token renewal and the push listener work on every stored account, whichever guild it came from. A
    credential removed in Discord therefore has to take that file along, or the bot keeps renewing a Steam login its
    owner revoked. It stays while another guild still lists the account.
*/
function isRegisteredInAnyGuild(steamId, credentialsDir = CREDENTIALS_DIR) {
    let files;
    try {
        files = Fs.readdirSync(credentialsDir).filter((file) => file.endsWith('.json'));
    }
    catch (e) {
        /* Unreadable directory: keep the login rather than remove one that might still be used. */
        return true;
    }

    for (const file of files) {
        try {
            const credentials = JSON.parse(Fs.readFileSync(Path.join(credentialsDir, file), 'utf8'));
            if (credentials && Object.prototype.hasOwnProperty.call(credentials, `${steamId}`)) return true;
        }
        catch (e) {
            /* A file that cannot be read might list the account: keep the login. */
            return true;
        }
    }

    return false;
}

/*
    The Discord users that registered the account, over every guild. The login file is shared by all guilds, so a
    login in one guild has to know whether the stored file belongs to somebody else.
*/
function getOwners(steamId, credentialsDir = CREDENTIALS_DIR) {
    const owners = [];
    let files;
    try {
        files = Fs.readdirSync(credentialsDir).filter((file) => file.endsWith('.json'));
    }
    catch (e) {
        return owners;
    }

    for (const file of files) {
        try {
            const credentials = JSON.parse(Fs.readFileSync(Path.join(credentialsDir, file), 'utf8'));
            if (!credentials || !Object.prototype.hasOwnProperty.call(credentials, `${steamId}`)) continue;

            const entry = credentials[`${steamId}`];
            const owner = (entry && entry.discord_user_id) ? `${entry.discord_user_id}` : null;
            if (owner !== null && !owners.includes(owner)) owners.push(owner);
        }
        catch (e) {
            /* Unreadable file, nothing to learn from it. */
        }
    }

    return owners;
}

/*
    Removes the stored login, the push registration and the push listener of an account that no guild lists anymore.
    Returns whether it was removed.
*/
function revokeIfUnregistered(steamId, deps = {}) {
    if (!steamId || steamId === 'hoster') return false;
    if (isRegisteredInAnyGuild(steamId, deps.credentialsDir)) return false;

    /* Loaded here: these modules pull in the Discord client. */
    const pushListener = deps.pushListener || require('./rustplusPushListener.js');
    const rustplusPush = deps.rustplusPush || require('./rustplusPush.js');
    const rustplusAuth = deps.rustplusAuth || require('./rustplusAuth.js');

    pushListener.stopAccount(`${steamId}`);
    rustplusPush.removePush(`${steamId}`);
    rustplusAuth.removeAuth(`${steamId}`);
    return true;
}

module.exports = {
    getOwners,
    isRegisteredInAnyGuild,
    revokeIfUnregistered,
};
