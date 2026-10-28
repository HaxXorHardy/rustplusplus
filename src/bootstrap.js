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

const Discord = require('discord.js');
const Fs = require('fs');
const Path = require('path');

const ClientRegistry = require('./structures/clientRegistry.js');
const DiscordBot = require('./structures/DiscordBot');

/* Directories the bot writes to at runtime. Created before the client starts so no handler has to
   worry about their existence. */
function createMissingDirectories() {
    for (const directory of ['logs', 'instances', 'credentials', 'maps']) {
        const path = Path.join(__dirname, '..', directory);
        if (!Fs.existsSync(path)) {
            Fs.mkdirSync(path);
        }
    }
}

/*
    Build the bot, publish it to the client registry and start it. Kept as an explicit function so
    importing a module never boots the application.
*/
function start() {
    createMissingDirectories();

    const client = new DiscordBot({
        intents: [
            Discord.GatewayIntentBits.Guilds,
            Discord.GatewayIntentBits.GuildMessages,
            Discord.GatewayIntentBits.MessageContent,
            Discord.GatewayIntentBits.GuildMembers,
            Discord.GatewayIntentBits.GuildVoiceStates],
        retryLimit: 2,
        restRequestTimeout: 60000,
        disableEveryone: false
    });

    ClientRegistry.client = client;
    client.build();

    return client;
}

module.exports = { start };
