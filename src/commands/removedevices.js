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
    /removedevices: remove all smart devices of the active server (after a wipe the bot did not notice, or to start
    over). Asks first, the removal itself is the confirm button (handlers/buttonHandler.js, WipeRemoveDevicesConfirm).
*/

const Builder = require('@discordjs/builders');

const DiscordButtons = require('../discordTools/discordButtons.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const WipeHelper = require('../handlers/wipeHelper.js');

module.exports = {
    name: 'removedevices',

    getSlashCommandDefinition(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('removedevices')
            .setDescription(client.intlGet(guildId, 'commandsRemoveDevicesDesc'));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        if (!await client.requireAdminPrivileges(interaction)) return;

        const guildId = interaction.guildId;
        const instance = client.getInstance(guildId);
        const serverId = instance.activeServer;
        const server = serverId !== null ? instance.serverList[serverId] : null;

        if (!server) {
            const str = client.intlGet(guildId, 'notConnectedToRustServer');
            await client.interactionReply(interaction, Object.assign(DiscordEmbeds.getActionInfoEmbed(1, str),
                { ephemeral: true }));
            return;
        }

        const devices = WipeHelper.devicesToRemove(server, { all: true });
        await client.interactionReply(interaction, {
            embeds: DiscordEmbeds.getActionInfoEmbed(1, client.intlGet(guildId, 'wipeRemoveDevicesAsk', {
                switches: `${devices.switches.length}`, alarms: `${devices.alarms.length}`,
                monitors: `${devices.storageMonitors.length}`
            })).embeds,
            components: [DiscordButtons.getWipeRemoveDevicesButton(guildId, serverId, true, true)],
            ephemeral: true
        });

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: 'removedevices'
        }));
    },
};
