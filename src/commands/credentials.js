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

const Builder = require('@discordjs/builders');

const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const DiscordModals = require('../discordTools/discordModals.js');
const InstanceUtils = require('../util/instanceUtils.js');

module.exports = {
    name: 'credentials',

    getSlashCommandDefinition(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('credentials')
            .setDescription(client.intlGet(guildId, 'commandsCredentialsDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('login')
                .setDescription(client.intlGet(guildId, 'commandsCredentialsLoginDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription(client.intlGet(guildId, 'commandsCredentialsRemoveDesc'))
                .addStringOption(option => option
                    .setName('steam_id')
                    .setDescription(client.intlGet(guildId, 'commandsCredentialsRemoveSteamIdDesc'))
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('show')
                .setDescription(client.intlGet(guildId, 'commandsCredentialsShowDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('set_hoster')
                .setDescription(client.intlGet(guildId, 'commandsCredentialsSetHosterDesc'))
                .addStringOption(option => option
                    .setName('steam_id')
                    .setDescription(client.intlGet(guildId, 'commandsCredentialsSetHosterSteamIdDesc'))
                    .setRequired(false)));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;

        /* The login is answered with a modal, which is not possible after a deferred reply. */
        if (interaction.options.getSubcommand() === 'login') {
            return await interaction.showModal(DiscordModals.getCredentialsLoginModal(interaction.guildId));
        }

        await interaction.deferReply({ ephemeral: true });

        switch (interaction.options.getSubcommand()) {
            case 'remove': {
                removeCredentials(client, interaction, verifyId);
            } break;

            case 'show': {
                showCredentials(client, interaction, verifyId);
            } break;

            case 'set_hoster': {
                setHosterCredentials(client, interaction, verifyId);
            } break;

            default: {
            } break;
        }
    },
};

async function removeCredentials(client, interaction, verifyId) {
    const guildId = interaction.guildId;
    const credentials = InstanceUtils.readCredentialsFile(guildId);
    let steamId = interaction.options.getString('steam_id');

    if (steamId && (steamId in credentials) && credentials[steamId].discord_user_id !== interaction.member.user.id) {
        if (!await client.requireAdminPrivileges(interaction)) return;
    }

    if (!steamId) {
        for (const credential of Object.keys(credentials)) {
            if (credential === 'hoster') continue;

            if (credentials[credential].discord_user_id === interaction.member.user.id) {
                steamId = credential;
                break;
            }
        }
    }

    if (!(steamId in credentials)) {
        const str = client.intlGet(guildId, 'credentialsDoNotExist', {
            steamId: steamId ? steamId : client.intlGet(guildId, 'unknown')
        });
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
        client.log(client.intlGet(null, 'warningCap'), str);
        return;
    }

    /* A removed hoster leaves the guild without one, it has to be chosen again. */
    if (steamId === credentials.hoster) credentials.hoster = null;

    delete credentials[steamId];
    InstanceUtils.writeCredentialsFile(guildId, credentials);

    client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
        id: `${verifyId}`,
        value: `remove, ${steamId}`
    }));

    const str = client.intlGet(guildId, 'credentialsRemovedSuccessfully', { steamId: steamId });
    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
    client.log(client.intlGet(null, 'infoCap'), str);
}

async function showCredentials(client, interaction, verifyId) {
    client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
        id: `${verifyId}`,
        value: `show`
    }));

    await DiscordMessages.sendCredentialsShowMessage(interaction);
}

async function setHosterCredentials(client, interaction, verifyId) {
    const guildId = interaction.guildId;
    const credentials = InstanceUtils.readCredentialsFile(guildId);
    let steamId = interaction.options.getString('steam_id');

    if (!await client.requireAdminPrivileges(interaction)) return;

    if (!steamId) {
        steamId = Object.keys(credentials).find(e => credentials[e] &&
            credentials[e].discord_user_id === interaction.member.user.id);
    }

    if (!(steamId in credentials)) {
        const str = client.intlGet(guildId, 'credentialsDoNotExist', {
            steamId: steamId ? steamId : client.intlGet(guildId, 'unknown')
        });
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
        client.log(client.intlGet(null, 'warningCap'), str);
        return;
    }

    credentials.hoster = steamId;
    InstanceUtils.writeCredentialsFile(guildId, credentials);

    const instance = client.getInstance(guildId);
    const rustplus = client.rustplusInstances[guildId];
    if (rustplus) {
        instance.activeServer = null;
        client.setInstance(guildId, instance);
        client.resetRustplusVariables(guildId);
        rustplus.disconnect();
        delete client.rustplusInstances[guildId];
        await DiscordMessages.sendServerMessage(guildId, rustplus.serverId);
    }

    client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
        id: `${verifyId}`,
        value: `setHoster, ${steamId}`
    }));

    const str = client.intlGet(guildId, 'credentialsSetHosterSuccessfully', { steamId: steamId });
    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
    client.log(client.intlGet(null, 'infoCap'), str);
}
