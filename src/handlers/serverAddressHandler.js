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

const DiscordMessages = require('../discordTools/discordMessages.js');
const RustServerList = require('../util/rustServerList.js');

/*
    The connect string of the server messages and of the server information.

    A server that is adopted from Rust+ carries no address: a relay paired server does not need one and the account
    state does not report it. The connect field of the messages stayed empty because of that. The address comes from
    the server list of the game and not from Battlemetrics - the list is what the game itself shows in the server
    browser, and the Battlemetrics entry of a server can be missing or point at its query port.
*/

async function fillGuildAddresses(client, guildId, options = {}) {
    const instance = client.getInstance(guildId);
    const serverList = (instance && instance.serverList) ? instance.serverList : null;
    if (!serverList) return [];

    /* The tests replace the lookup, the bot reads the server list of the game. */
    const resolveConnect = options.resolveConnect ||
        ((title) => RustServerList.getConnectCommand(title));

    const updated = [];

    for (const [serverId, server] of Object.entries(serverList)) {
        if (!server || server.connect) continue;

        const connect = await resolveConnect(server.title);
        if (connect === null) continue;

        server.connect = connect;
        updated.push(serverId);

        client.log(client.intlGet(null, 'infoCap'),
            `Address of the server "${server.title}" is ${connect.replace('connect ', '')}.`);
    }

    if (updated.length > 0) client.setInstance(guildId, instance);

    return updated;
}

module.exports = {
    fillGuildAddresses: fillGuildAddresses,
    handler: async function (client, options = {}) {
        for (const guildId of Object.keys(client.instances || {})) {
            try {
                const updated = await fillGuildAddresses(client, guildId, options);

                /* The connect field sits on the server message, it has to be written again. */
                for (const serverId of updated) {
                    await DiscordMessages.sendServerMessage(guildId, serverId);
                }
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'),
                    `Could not read the address of the servers of ${guildId}: ` +
                    `${e && e.message ? e.message : e}`, 'warn');
            }
        }
    },
};
