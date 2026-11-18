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

const Builder = require('@discordjs/builders');
const Discord = require('discord.js');
const Path = require('path');

const Constants = require('../util/constants.js');
const DeathLog = require('../util/deathLog.js');
const DeathMap = require('../util/deathMap.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');

module.exports = {
    name: 'deathmap',

    getSlashCommandDefinition(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('deathmap')
            .setDescription(client.intlGet(guildId, 'commandsDeathMapDesc'))
            .addStringOption(option => option
                .setName('player')
                .setDescription(client.intlGet(guildId, 'commandsDeathMapPlayerDesc'))
                .setRequired(false))
            .addIntegerOption(option => option
                .setName('hours')
                .setDescription(client.intlGet(guildId, 'commandsDeathMapHoursDesc'))
                .setMinValue(1)
                .setRequired(false));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guildId;
        const rustplus = client.rustplusInstances[guildId];
        if (!rustplus || !rustplus.isOperational) {
            const str = client.intlGet(guildId, 'notConnectedToRustServer');
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            return;
        }

        const instance = client.getInstance(guildId);
        const server = instance.serverList[rustplus.serverId];
        const player = interaction.options.getString('player');
        const hours = interaction.options.getInteger('hours');
        const deaths = DeathLog.list(server, {
            player: player,
            sinceMs: hours ? Date.now() - hours * 60 * 60 * 1000 : 0
        });

        if (deaths.length === 0) {
            await client.interactionEditReply(interaction,
                DiscordEmbeds.getActionInfoEmbed(0, client.intlGet(guildId, 'deathMapNoDeaths')));
            return;
        }

        const path = await DeathMap.render(rustplus, deaths);
        if (path === null) {
            const str = client.intlGet(guildId, 'notConnectedToRustServer');
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            return;
        }

        /* Where the team dies most: the grids with the most deaths. */
        const grids = {};
        for (const death of deaths) if (death.grid) grids[death.grid] = (grids[death.grid] || 0) + 1;
        const top = Object.entries(grids).sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([grid, count]) => `${grid}: ${count}×`).join(', ');

        const options = {
            title: `💀 ${client.intlGet(guildId, 'deathMapTitle', { count: `${deaths.length}` })}`,
            color: Constants.COLOR_DEFAULT,
            image: `attachment://${Path.basename(path)}`,
            footer: { text: server.title }
        };
        if (top !== '') options.description = `${client.intlGet(guildId, 'deathMapMost')}: ${top}`;

        await client.interactionEditReply(interaction, {
            embeds: [DiscordEmbeds.getEmbed(options)],
            files: [new Discord.AttachmentBuilder(path)],
            ephemeral: true
        });

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `deathmap ${player || ''} ${hours || ''}`
        }));
    },
};
