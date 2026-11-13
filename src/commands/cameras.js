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
    /cameras - the cameras of the server: list, add, remove, snapshot and the watch that reports strangers in the
    camera channel.

    A camera code is what the game calls the identifier of a camera: it is set at the camera itself (look at it and press
    E) and typed into the computer station there.
*/

const Builder = require('@discordjs/builders');

const Camera = require('../structures/Camera.js');
const CameraWatch = require('../util/cameraWatch.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');

module.exports = {
    name: 'cameras',

    getSlashCommandDefinition(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('cameras')
            .setDescription(client.intlGet(guildId, 'commandsCamerasDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('list')
                .setDescription(client.intlGet(guildId, 'commandsCamerasListDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('add')
                .setDescription(client.intlGet(guildId, 'commandsCamerasAddDesc'))
                .addStringOption(option =>
                    option.setName('code')
                        .setDescription(client.intlGet(guildId, 'cameraCode'))
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription(client.intlGet(guildId, 'cameraName'))
                        .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('remove')
                .setDescription(client.intlGet(guildId, 'commandsCamerasRemoveDesc'))
                .addStringOption(option =>
                    option.setName('code')
                        .setDescription(client.intlGet(guildId, 'cameraCode'))
                        .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('watch')
                .setDescription(client.intlGet(guildId, 'commandsCamerasWatchDesc'))
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription(client.intlGet(guildId, 'cameraWatchState'))
                        .setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName('snapshot')
                .setDescription(client.intlGet(guildId, 'commandsCamerasSnapshotDesc'))
                .addStringOption(option =>
                    option.setName('code')
                        .setDescription(client.intlGet(guildId, 'cameraCode'))
                        .setRequired(true)));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;

        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();
        const rustplus = client.rustplusInstances[guildId];
        const instance = client.getInstance(guildId);

        await interaction.deferReply({ ephemeral: subcommand !== 'snapshot' });

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${subcommand}`
        }));

        if (!rustplus) {
            await client.interactionEditReply(interaction,
                DiscordEmbeds.getActionInfoEmbed(1, client.intlGet(guildId, 'offline')));
            return;
        }

        const server = instance.serverList[rustplus.serverId];
        server.watchedCameras = server.watchedCameras || {};

        switch (subcommand) {
            case 'list': await listCameras(client, interaction, instance, server); break;
            case 'add': await addCamera(client, interaction, instance, server, rustplus); break;
            case 'remove': await removeCamera(client, interaction, instance, server); break;
            case 'watch': await setWatch(client, interaction, instance); break;
            case 'snapshot': await snapshotCamera(client, interaction, rustplus, server); break;
            default: break;
        }
    },
};

async function listCameras(client, interaction, instance, server) {
    const guildId = interaction.guildId;
    const cameras = Object.entries(server.watchedCameras || {}).map(([code, camera]) => ({
        code: code,
        name: camera.name || null,
        enabled: camera.enabled !== false
    }));

    await client.interactionEditReply(interaction, {
        embeds: [DiscordEmbeds.getCameraListEmbed(guildId, cameras,
            instance.generalSettings.cameraWatchEnabled === true)]
    });
}

async function addCamera(client, interaction, instance, server, rustplus) {
    const guildId = interaction.guildId;
    const code = `${interaction.options.getString('code')}`.trim();
    const name = interaction.options.getString('name');

    if (code === '') {
        await client.interactionEditReply(interaction,
            DiscordEmbeds.getActionInfoEmbed(1, client.intlGet(guildId, 'cameraCodeMissing')));
        return;
    }

    server.watchedCameras[code] = { name: name === null ? null : `${name}`, enabled: true };
    client.setInstance(guildId, instance);

    /* Ask the server once, so a wrong code is visible right away (player_online is not an error of the code). */
    const camera = new Camera(rustplus, code);
    const subscribed = await camera.subscribe();
    const error = camera.lastError;
    await camera.unsubscribe();

    if (!subscribed && error !== 'player_online') {
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1,
            client.intlGet(guildId, 'cameraSubscribeFailed', { code: code, error: error })));
        return;
    }

    const suffix = (error === 'player_online') ? `\n${client.intlGet(guildId, 'cameraPlayerOnline')}` : '';
    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0,
        `${client.intlGet(guildId, 'cameraAdded', { code: code })}${suffix}`));
}

async function removeCamera(client, interaction, instance, server) {
    const guildId = interaction.guildId;
    const code = `${interaction.options.getString('code')}`.trim();

    if (!server.watchedCameras.hasOwnProperty(code)) {
        await client.interactionEditReply(interaction,
            DiscordEmbeds.getActionInfoEmbed(1, client.intlGet(guildId, 'cameraUnknown', { code: code })));
        return;
    }

    delete server.watchedCameras[code];
    client.setInstance(guildId, instance);

    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0,
        client.intlGet(guildId, 'cameraRemoved', { code: code })));
}

async function setWatch(client, interaction, instance) {
    const guildId = interaction.guildId;
    const enabled = interaction.options.getBoolean('enabled');

    instance.generalSettings.cameraWatchEnabled = enabled === true;
    client.setInstance(guildId, instance);

    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0,
        client.intlGet(guildId, enabled ? 'cameraWatchEnabled' : 'cameraWatchDisabled')));
}

async function snapshotCamera(client, interaction, rustplus, server) {
    const guildId = interaction.guildId;
    const code = `${interaction.options.getString('code')}`.trim();
    const cameraSettings = server.watchedCameras[code] || {};

    const camera = new Camera(rustplus, code);
    const result = await camera.snapshot(4000);

    if (!result.ok) {
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1,
            client.intlGet(guildId, 'cameraSubscribeFailed', { code: code, error: result.error })));
        return;
    }

    /* Everybody the camera saw, with the distance to the camera (relative, in metres). */
    const seen = result.players.map((player) => ({
        name: player.name === undefined ? null : `${player.name}`,
        entityId: player.entityId,
        distance: CameraWatch.distanceOf(player)
    }));

    const imageName = `camera-${code}.png`;
    await client.interactionEditReply(interaction, {
        embeds: [DiscordEmbeds.getCameraAlertEmbed(guildId, code, cameraSettings.name || null, seen, imageName)],
        files: [new (require('discord.js').AttachmentBuilder)(result.png, { name: imageName })]
    });
}
