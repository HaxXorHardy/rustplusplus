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

const Discord = require('discord.js');

const DiscordEmbeds = require('../discordTools/discordEmbeds');

module.exports = {
    name: 'interactionCreate',

    /*
        Message components (buttons, menus) only count from the bot channels. Ephemeral replies are exempt: the login
        chooser and the remove-devices question answer a slash command, which can be used in any channel. Slash
        commands and modal submits are not message components and have their own permission checks.
    */
    isFromForeignChannel(instance, interaction) {
        if (!interaction.isMessageComponent()) return false;
        if (interaction.message && interaction.message.flags &&
            interaction.message.flags.has(Discord.MessageFlags.Ephemeral)) return false;
        return !Object.values(instance.channelId).includes(interaction.channelId);
    },

    /*
        Runs a button, select menu or modal handler. A throw is logged instead of becoming an unhandled rejection,
        and an interaction the handler did not answer yet is acknowledged so the user does not see it fail.
    */
    async runComponentHandler(client, interaction, handler) {
        try {
            await handler(client, interaction);
        }
        catch (e) {
            client.log(client.intlGet(null, 'errorCap'), e, 'error');

            if (!interaction.deferred && !interaction.replied) {
                try {
                    await interaction.deferUpdate();
                }
                catch (deferError) {
                    client.log(client.intlGet(null, 'errorCap'),
                        `${client.intlGet(null, 'couldNotDeferInteraction')} ${deferError}`, 'error');
                }
            }
        }
    },

    async execute(client, interaction) {
        /* Only guild interactions carry an instance; a DM holds nothing but link buttons (credentials expiry). */
        const instance = interaction.guildId ? client.getInstance(interaction.guildId) : undefined;
        if (!instance) return;

        /* A button or menu on a message outside the bot channels (a stale message) must not act on the guild. */
        if (module.exports.isFromForeignChannel(instance, interaction)) {
            client.log(client.intlGet(null, 'warningCap'), client.intlGet(null, 'interactionInvalidChannel'));
            await interaction.deferUpdate().catch(() => {
                client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'couldNotDeferInteraction'), 'error');
            });
            return;
        }

        if (interaction.isButton()) {
            await module.exports.runComponentHandler(client, interaction, require('../handlers/buttonHandler'));
        }
        else if (interaction.isStringSelectMenu()) {
            await module.exports.runComponentHandler(client, interaction, require('../handlers/selectMenuHandler'));
        }
        else if (interaction.type === Discord.InteractionType.ApplicationCommand) {
            const command = interaction.client.commands.get(interaction.commandName);

            /* If the command doesn't exist, return */
            if (!command) return;

            try {
                await command.execute(client, interaction);
            }
            catch (e) {
                client.log(client.intlGet(null, 'errorCap'), e, 'error');

                const str = client.intlGet(interaction.guildId, 'errorExecutingCommand');
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                client.log(client.intlGet(null, 'errorCap'), str, 'error');
            }
        }
        else if (interaction.type === Discord.InteractionType.ModalSubmit) {
            await module.exports.runComponentHandler(client, interaction, require('../handlers/modalHandler'));
        }
        else {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'unknownInteraction'), 'error');

            if (interaction.isButton()) {
                try {
                    interaction.deferUpdate();
                }
                catch (e) {
                    client.log(client.intlGet(null, 'errorCap'),
                        client.intlGet(null, 'couldNotDeferInteraction'), 'error');
                }
            }
        }
    },
};