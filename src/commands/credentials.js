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
const Discord = require('discord.js');

const CredentialRevocation = require('../util/credentialRevocation.js');
const CredentialsLoginHandler = require('../handlers/credentialsLoginHandler.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
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

        /*
            The login offers three ways: the QR code of the Steam app, a pasted account token and the password form. The
            first two keep the Steam credentials out of Discord, so they are offered first.
        */
        if (interaction.options.getSubcommand() === 'login') {
            return await interaction.reply(Object.assign(
                { flags: Discord.MessageFlags.Ephemeral },
                CredentialsLoginHandler.getLoginChooser(client, interaction.guildId)));
        }

        await interaction.deferReply({ ephemeral: true });

        /* Awaited: a throw must reach the command error handler, not become an unhandled rejection. */
        switch (interaction.options.getSubcommand()) {
            case 'remove': {
                await removeCredentials(client, interaction, verifyId);
            } break;

            case 'show': {
                await showCredentials(client, interaction, verifyId);
            } break;

            case 'set_hoster': {
                await setHosterCredentials(client, interaction, verifyId);
            } break;

            default: {
            } break;
        }
    },
};

/*
    Whether the credentials file has an account entry of that steam id. Own keys only (not "toString" and the like),
    and never the "hoster" key, which holds the steam id of the hoster and is no account.
*/
function hasCredentialEntry(credentials, steamId) {
    return typeof steamId === 'string' && steamId !== 'hoster' &&
        Object.prototype.hasOwnProperty.call(credentials, steamId);
}

async function removeCredentials(client, interaction, verifyId) {
    const guildId = interaction.guildId;
    const credentials = InstanceUtils.readCredentialsFile(guildId);
    let steamId = interaction.options.getString('steam_id');

    /* An entry without an owner (null) can only be removed by an admin. */
    if (hasCredentialEntry(credentials, steamId) && (!credentials[steamId] ||
        credentials[steamId].discord_user_id !== interaction.member.user.id)) {
        if (!await client.requireAdminPrivileges(interaction)) return;
    }

    if (!steamId) {
        for (const credential of Object.keys(credentials)) {
            if (credential === 'hoster') continue;

            if (credentials[credential] && credentials[credential].discord_user_id === interaction.member.user.id) {
                steamId = credential;
                break;
            }
        }
    }

    if (!hasCredentialEntry(credentials, steamId)) {
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

    /* Without a guild that lists the account, its stored login must not keep being renewed. */
    CredentialRevocation.revokeIfUnregistered(steamId);

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

    /* A null entry holds no login, it cannot host. */
    if (!hasCredentialEntry(credentials, steamId) || !credentials[steamId]) {
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
