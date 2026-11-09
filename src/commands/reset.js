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
const DiscordTools = require('../discordTools/discordTools.js');
const RemoveGuildChannels = require('../discordTools/RemoveGuildChannels.js');
const SetupGuildCategory = require('../discordTools/SetupGuildCategory.js');
const SetupGuildChannels = require('../discordTools/SetupGuildChannels.js');
const SetupServerList = require('../discordTools/SetupServerList.js');
const SetupSettingsMenu = require('../discordTools/SetupSettingsMenu.js');
const SetupSwitches = require('../discordTools/SetupSwitches.js');
const SetupSwitchGroups = require('../discordTools/SetupSwitchGroups.js');
const SetupAlarms = require('../discordTools/SetupAlarms.js');
const SetupStorageMonitors = require('../discordTools/SetupStorageMonitors.js');
const SetupTrackers = require('../discordTools/SetupTrackers.js');
const InstanceUtils = require('../util/instanceUtils.js');
const LogChannelRelay = require('../util/logChannelRelay.js');
const PermissionHandler = require('../handlers/permissionHandler.js');

/* Catches that must not abort a reset: the category may be missing or the bot may lack Manage Roles.
   Log the failure instead of swallowing it. */
async function setCategoryPermissions(client, category, permissions) {
    if (!category) return;

    try {
        await category.permissionOverwrites.set(permissions);
    }
    catch (e) {
        client.log(client.intlGet(null, 'warningCap'), e, 'warning');
    }
}

async function resetCategoryPermissions(client, guild, instance) {
    const category = DiscordTools.getCategoryById(guild.id, instance.channelId.category);
    await setCategoryPermissions(client, category, PermissionHandler.getPermissionsRemoved(client, guild));
}

/*
    Reports the result of a reset. /reset discord removes the channel the command was used in, which also removes
    the ephemeral reply, so the result is posted in the activity channel in that case.
*/
async function sendResetResult(client, interaction, str) {
    const content = DiscordEmbeds.getActionInfoEmbed(0, str);

    if (DiscordTools.getTextChannelById(interaction.guildId, interaction.channelId)) {
        await client.interactionEditReply(interaction, content);
        return;
    }

    const instance = client.getInstance(interaction.guildId);
    const channel = DiscordTools.getTextChannelById(interaction.guildId, instance.channelId.activity);

    if (!channel) return;

    await client.messageSend(channel, { embeds: content.embeds });
}

module.exports = {
    name: 'reset',

    getSlashCommandDefinition(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('reset')
            .setDescription(client.intlGet(guildId, 'commandsResetDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('discord')
                .setDescription(client.intlGet(guildId, 'commandsResetDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('information')
                .setDescription(client.intlGet(guildId, 'commandsResetInformationDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('servers')
                .setDescription(client.intlGet(guildId, 'commandsResetServersDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('settings')
                .setDescription(client.intlGet(guildId, 'commandsResetSettingsDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('switches')
                .setDescription(client.intlGet(guildId, 'commandsResetSwitchesDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('alarms')
                .setDescription(client.intlGet(guildId, 'commandsResetAlarmsDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('storagemonitors')
                .setDescription(client.intlGet(guildId, 'commandsResetStorageMonitorsDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('trackers')
                .setDescription(client.intlGet(guildId, 'commandsResetTrackersDesc')));
    },

    async execute(client, interaction) {
        const instance = client.getInstance(interaction.guildId);

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;

        if (!await client.requireAdminPrivileges(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const guild = DiscordTools.getGuild(interaction.guildId);

        switch (interaction.options.getSubcommand()) {
            case 'discord': {
                /*
                    Everything that is still queued belongs to the channel that is about to be deleted: drop it
                    instead of posting it into the recreated channel. The relay resolves the channel id on every
                    flush, so it follows the new channel afterwards.
                */
                LogChannelRelay.reset(guild.id);

                await RemoveGuildChannels(client, guild);

                /*
                    The channels are created from scratch here, so they are empty and are not cleared afterwards.
                    Clearing would delete the messages the polling handlers post into them in the meantime, which
                    leaves the stored message ids dangling.
                */
                const category = await SetupGuildCategory(client, guild);
                await SetupGuildChannels(client, guild, category);

                await setCategoryPermissions(client, category,
                    PermissionHandler.getPermissionsRemoved(client, guild));

                const rustplus = client.rustplusInstances[guild.id];
                if (rustplus && rustplus.isOperational) {
                    await rustplus.map.writeMap(false, true);
                    await DiscordMessages.sendUpdateMapInformationMessage(rustplus);
                }

                await SetupServerList.postServerMessages(client, guild.id);
                await SetupSettingsMenu(client, guild, true);

                if (rustplus && rustplus.isOperational) {
                    await SetupSwitches(client, rustplus);
                    await SetupSwitchGroups(client, rustplus);
                    await SetupAlarms(client, rustplus);
                    await SetupStorageMonitors(client, rustplus);
                }

                await SetupTrackers(client, guild);

                await PermissionHandler.resetPermissionsAllChannels(client, guild);

                /* Marker line: it proves that the relay already switched to the recreated channel. */
                LogChannelRelay.pushStartLine(guild.id,
                    `${client.intlGet(null, 'infoCap')}: ${client.intlGet(null, 'serverLogChannelsRecreated')}`);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `discord`
                }));
            } break;

            case 'information': {
                /* The information messages are removed below, their ids are dead. */
                InstanceUtils.clearInformationMessageIds(instance);
                client.setInstance(guild.id, instance);

                await DiscordTools.clearTextChannel(guild.id, instance.channelId.information, 100);

                const rustplus = client.rustplusInstances[guild.id];
                if (rustplus && rustplus.isOperational) {
                    await rustplus.map.writeMap(false, true);
                    await DiscordMessages.sendUpdateMapInformationMessage(rustplus);
                }

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `information`
                }));
            } break;

            case 'servers': {
                await resetCategoryPermissions(client, guild, instance);

                await SetupServerList.postServerMessages(client, guild.id);

                await PermissionHandler.resetPermissionsAllChannels(client, guild);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `servers`
                }));
            } break;

            case 'settings': {
                await resetCategoryPermissions(client, guild, instance);

                await SetupSettingsMenu(client, guild, true);

                await PermissionHandler.resetPermissionsAllChannels(client, guild);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `settings`
                }));
            } break;

            case 'switches': {
                await DiscordTools.clearTextChannel(guild.id, instance.channelId.switches, 100);
                await DiscordTools.clearTextChannel(guild.id, instance.channelId.switchGroups, 100);

                await resetCategoryPermissions(client, guild, instance);

                const rustplus = client.rustplusInstances[guild.id];
                if (rustplus && rustplus.isOperational) {
                    await SetupSwitches(client, rustplus);
                    await SetupSwitchGroups(client, rustplus);
                }

                await PermissionHandler.resetPermissionsAllChannels(client, guild);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `switches`
                }));
            } break;

            case 'alarms': {
                const rustplus = client.rustplusInstances[guild.id];
                if (rustplus && rustplus.isOperational) {
                    await SetupAlarms(client, rustplus);
                }

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `alarms`
                }));
            } break;

            case 'storagemonitors': {
                await DiscordTools.clearTextChannel(guild.id, instance.channelId.storageMonitors, 100);

                await resetCategoryPermissions(client, guild, instance);

                const rustplus = client.rustplusInstances[guild.id];
                if (rustplus && rustplus.isOperational) {
                    await SetupStorageMonitors(client, rustplus);
                }

                await PermissionHandler.resetPermissionsAllChannels(client, guild);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `storagemonitors`
                }));
            } break;

            case 'trackers': {
                await resetCategoryPermissions(client, guild, instance);

                await SetupTrackers(client, guild);

                await PermissionHandler.resetPermissionsAllChannels(client, guild);

                client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
                    id: `${verifyId}`,
                    value: `trackers`
                }));
            } break;

            default: {
            } break;
        }

        const str = client.intlGet(interaction.guildId, 'resetSuccess');
        await sendResetResult(client, interaction, str);
        client.log(client.intlGet(null, 'infoCap'), str);
    },
};
