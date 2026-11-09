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
const Path = require('path');

const Constants = require('../util/constants.js');
const Client = require('../structures/clientRegistry.js');
const DiscordButtons = require('./discordButtons.js');
const DiscordEmbeds = require('./discordEmbeds.js');
const DiscordSelectMenus = require('./discordSelectMenus.js');
const DiscordTools = require('./discordTools.js');
const InstanceUtils = require('../util/instanceUtils.js');
const Scrape = require('../util/scrape.js');

module.exports = {
    sendMessage: async function (guildId, content, messageId, channelId, interaction = null) {
        if (interaction) {
            await Client.client.interactionUpdate(interaction, content);
            return;
        }

        /*
            A message that cannot be fetched (removed by hand or in a previous reset) is posted again
            instead of throwing, the caller stores the returned id.
        */
        const message = (messageId && channelId) ?
            await DiscordTools.getMessageById(guildId, channelId, messageId) : null;

        if (message) {
            return await Client.client.messageEdit(message, content);
        }

        const channel = DiscordTools.getTextChannelById(guildId, channelId);

        if (!channel) {
            Client.client.log(Client.client.intlGet(null, 'errorCap'),
                Client.client.intlGet(null, 'couldNotGetChannelWithId', { id: channelId }), 'error');
            return;
        }

        return await Client.client.messageSend(channel, content);
    },

    sendServerMessage: async function (guildId, serverId, state = null, interaction = null) {
        const instance = Client.client.getInstance(guildId);
        const server = instance.serverList[serverId];

        const content = {
            embeds: [await DiscordEmbeds.getServerEmbed(guildId, serverId)],
            components: DiscordButtons.getServerButtons(guildId, serverId, state)
        }

        const message = await module.exports.sendMessage(guildId, content, server.messageId,
            instance.channelId.servers, interaction);

        if (!interaction && message) {
            instance.serverList[serverId].messageId = message.id;
            Client.client.setInstance(guildId, instance);
        }
    },

    sendTrackerMessage: async function (guildId, trackerId, interaction = null) {
        const instance = Client.client.getInstance(guildId);
        const tracker = instance.trackers[trackerId];

        const content = {
            embeds: [DiscordEmbeds.getTrackerEmbed(guildId, trackerId)],
            components: DiscordButtons.getTrackerButtons(guildId, trackerId)
        }

        const message = await module.exports.sendMessage(guildId, content, tracker.messageId,
            instance.channelId.trackers, interaction);

        if (!interaction && message) {
            instance.trackers[trackerId].messageId = message.id;
            Client.client.setInstance(guildId, instance);
        }
    },

    sendSmartSwitchMessage: async function (guildId, serverId, entityId, interaction = null) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].switches[entityId];

        const content = {
            embeds: [entity.reachable ?
                DiscordEmbeds.getSmartSwitchEmbed(guildId, serverId, entityId) :
                DiscordEmbeds.getNotFoundSmartDeviceEmbed(guildId, serverId, entityId, 'switches')],
            components: [
                DiscordSelectMenus.getSmartSwitchSelectMenu(guildId, serverId, entityId),
                DiscordButtons.getSmartSwitchButtons(guildId, serverId, entityId)
            ],
            files: [
                new Discord.AttachmentBuilder(Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))
            ]
        }

        const message = await module.exports.sendMessage(guildId, content, entity.messageId,
            instance.channelId.switches, interaction);

        if (!interaction && message) {
            instance.serverList[serverId].switches[entityId].messageId = message.id;
            Client.client.setInstance(guildId, instance);
        }
    },

    sendSmartAlarmMessage: async function (guildId, serverId, entityId, interaction = null) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].alarms[entityId];

        const content = {
            embeds: [entity.reachable ?
                DiscordEmbeds.getSmartAlarmEmbed(guildId, serverId, entityId) :
                DiscordEmbeds.getNotFoundSmartDeviceEmbed(guildId, serverId, entityId, 'alarms')],
            components: [DiscordButtons.getSmartAlarmButtons(guildId, serverId, entityId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))]
        }

        const message = await module.exports.sendMessage(guildId, content, entity.messageId,
            instance.channelId.alarms, interaction);

        if (!interaction && message) {
            instance.serverList[serverId].alarms[entityId].messageId = message.id;
            Client.client.setInstance(guildId, instance);
        }
    },

    sendStorageMonitorMessage: async function (guildId, serverId, entityId, interaction = null) {
        let instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].storageMonitors[entityId];

        const content = {
            embeds: [entity.reachable ?
                DiscordEmbeds.getStorageMonitorEmbed(guildId, serverId, entityId) :
                DiscordEmbeds.getNotFoundSmartDeviceEmbed(guildId, serverId, entityId, 'storageMonitors')],
            components: [entity.type === 'toolCupboard' ?
                DiscordButtons.getStorageMonitorToolCupboardButtons(guildId, serverId, entityId) :
                DiscordButtons.getStorageMonitorContainerButton(guildId, serverId, entityId)],
            files: [
                new Discord.AttachmentBuilder(
                    Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))]
        }

        instance = Client.client.getInstance(guildId);

        const message = await module.exports.sendMessage(guildId, content, entity.messageId,
            instance.channelId.storageMonitors, interaction);

        if (!interaction && message) {
            instance.serverList[serverId].storageMonitors[entityId].messageId = message.id;
            Client.client.setInstance(guildId, instance);
        }
    },

    sendSmartSwitchGroupMessage: async function (guildId, serverId, groupId, interaction = null) {
        const instance = Client.client.getInstance(guildId);
        const group = instance.serverList[serverId].switchGroups[groupId];

        const content = {
            embeds: [DiscordEmbeds.getSmartSwitchGroupEmbed(guildId, serverId, groupId)],
            components: DiscordButtons.getSmartSwitchGroupButtons(guildId, serverId, groupId),
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${group.image}`))]
        }

        const message = await module.exports.sendMessage(guildId, content, group.messageId,
            instance.channelId.switchGroups, interaction);

        if (!interaction && message) {
            instance.serverList[serverId].switchGroups[groupId].messageId = message.id;
            Client.client.setInstance(guildId, instance);
        }
    },

    sendStorageMonitorRecycleMessage: async function (guildId, serverId, entityId, items) {
        const instance = Client.client.getInstance(guildId);

        const content = {
            embeds: [DiscordEmbeds.getStorageMonitorRecycleEmbed(guildId, serverId, entityId, items)],
            components: [DiscordButtons.getRecycleDeleteButton()],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/electrics/recycler.png'))]
        }

        return await module.exports.sendMessage(guildId, content, null, instance.channelId.storageMonitors);
    },

    sendDecayingNotificationMessage: async function (guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].storageMonitors[entityId];

        const content = {
            embeds: [DiscordEmbeds.getDecayingNotificationEmbed(guildId, serverId, entityId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))],
            content: entity.everyone ? '@everyone' : ''
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendStorageMonitorDisconnectNotificationMessage: async function (guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].storageMonitors[entityId];

        const content = {
            embeds: [DiscordEmbeds.getStorageMonitorDisconnectNotificationEmbed(guildId, serverId, entityId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))],
            content: entity.everyone ? '@everyone' : ''
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendStorageMonitorNotFoundMessage: async function (guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].storageMonitors[entityId];

        const content = {
            embeds: [await DiscordEmbeds.getStorageMonitorNotFoundEmbed(guildId, serverId, entityId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))],
            content: entity.everyone ? '@everyone' : ''
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendSmartSwitchNotFoundMessage: async function (guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].switches[entityId];

        const content = {
            embeds: [await DiscordEmbeds.getSmartSwitchNotFoundEmbed(guildId, serverId, entityId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))]
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendSmartAlarmNotFoundMessage: async function (guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].alarms[entityId];

        const content = {
            embeds: [await DiscordEmbeds.getSmartAlarmNotFoundEmbed(guildId, serverId, entityId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))],
            content: entity.everyone ? '@everyone' : ''
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendSmartAlarmTriggerMessage: async function (guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].alarms[entityId];

        const content = {
            embeds: [await DiscordEmbeds.getAlarmEmbed(guildId, serverId, entityId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/electrics/${entity.image}`))],
            content: entity.everyone ? '@everyone' : ''
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendServerChangeStateMessage: async function (guildId, serverId, state) {
        const instance = Client.client.getInstance(guildId);

        const content = {
            embeds: [DiscordEmbeds.getServerChangedStateEmbed(guildId, serverId, state)]
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendServerWipeDetectedMessage: async function (guildId, serverId) {
        const instance = Client.client.getInstance(guildId);

        const content = {
            embeds: [DiscordEmbeds.getServerWipeDetectedEmbed(guildId, serverId)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', '..', `maps/${guildId}_map_full.png`))],
            content: instance.generalSettings.mapWipeNotifyEveryone ? '@everyone' : ''
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendServerConnectionInvalidMessage: async function (guildId, serverId) {
        const instance = Client.client.getInstance(guildId);

        const content = {
            embeds: [DiscordEmbeds.getServerConnectionInvalidEmbed(guildId, serverId)]
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    /* Posted when the map is ready (rustplusEvents/connected.js) and as part of the information cycle. */
    sendInformationMapMessage: async function (guildId) {
        await sendInformationMessage(guildId, 'map', {
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', '..', `maps/${guildId}_map_full.png`))]
        });
    },

    sendDiscordEventMessage: async function (guildId, serverId, text, image, color) {
        const instance = Client.client.getInstance(guildId);

        const content = {
            embeds: [DiscordEmbeds.getEventEmbed(guildId, serverId, text, image, color)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', `resources/images/events/${image}`))]
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.events);
    },

    sendActivityNotificationMessage: async function (guildId, serverId, color, text, steamId, title = null, everyone = false) {
        const instance = Client.client.getInstance(guildId);

        let png = null;
        if (steamId !== null) {
            png = await Scrape.scrapeSteamProfilePicture(Client.client, steamId);
        }
        const content = {
            embeds: [DiscordEmbeds.getActivityNotificationEmbed(guildId, serverId, color, text, steamId, png, title)]
        }

        if (everyone) {
            content.content = '@everyone';
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    /*
        The death notification of the account history as a direct message to the registered Discord users. The old FCM
        listener sent exactly this message; the history carries it while the bot was offline as well, so it replaces
        the push client (see util/rustplusHistory.js).
    */
    sendDeathDirectMessage: async function (guildId, death) {
        const userIds = InstanceUtils.getRegisteredDiscordUserIds(guildId);

        if (userIds.length === 0) {
            Client.client.log(Client.client.intlGet(null, 'warningCap'),
                'No Discord user is registered for the Rust+ account, the death notification was not sent as a direct ' +
                'message. Use "/credentials login" to register one.', 'warn');
            return 0;
        }

        const content = { embeds: [DiscordEmbeds.getDeathDirectMessageEmbed(guildId, death)] };

        let sent = 0;

        for (const userId of userIds) {
            const user = await DiscordTools.getUserById(guildId, userId);
            if (!user) continue;

            if (await Client.client.messageSend(user, content)) sent += 1;
        }

        return sent;
    },

    sendTeamChatMessage: async function (guildId, message) {
        const instance = Client.client.getInstance(guildId);

        let color = Constants.COLOR_TEAMCHAT_DEFAULT;
        if (instance.teamChatColors.hasOwnProperty(message.steamId)) {
            color = instance.teamChatColors[message.steamId];
        }

        const content = {
            embeds: [DiscordEmbeds.getEmbed({
                color: color,
                description: `**${message.name}**: ${message.message}`
            })]
        }

        if (message.message.includes('@everyone')) {
            content.content = '@everyone';
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.teamchat);
    },

    sendClanChatMessage: async function (guildId, message) {
        const instance = Client.client.getInstance(guildId);

        let color = Constants.COLOR_CLANCHAT_DEFAULT;
        if (instance.teamChatColors.hasOwnProperty(message.steamId)) {
            color = instance.teamChatColors[message.steamId];
        }

        const content = {
            embeds: [DiscordEmbeds.getEmbed({
                color: color,
                description: `**${message.name}**: ${message.message}`
            })]
        }

        if (message.message.includes('@everyone')) {
            content.content = '@everyone';
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.clanchat);
    },

    sendTTSMessage: async function (guildId, name, text) {
        const instance = Client.client.getInstance(guildId);

        const content = {
            content: Client.client.intlGet(guildId, 'userSaid', { user: name, text: text }),
            tts: true
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.teamchat);
    },

    deleteInformationMessage: async function (guildId, messageType) {
        const instance = Client.client.getInstance(guildId);
        const messageId = instance.informationMessageId[messageType];

        if (!messageId) return;

        const deleted = await DiscordTools.deleteMessageById(guildId, instance.channelId.information, messageId);
        if (!deleted) return;

        instance.informationMessageId[messageType] = null;
        Client.client.setInstance(guildId, instance);
    },

    sendUpdateMapInformationMessage: async function (rustplus) {
        await sendInformationMessage(rustplus.guildId, 'map', {
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', '..', `maps/${rustplus.guildId}_map_full.png`))]
        });
    },

    sendUpdateServerInformationMessage: async function (rustplus) {
        await sendInformationMessage(rustplus.guildId, 'server', {
            embeds: [DiscordEmbeds.getUpdateServerInformationEmbed(rustplus)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/server_info_logo.png'))]
        });
    },

    sendUpdateEventInformationMessage: async function (rustplus) {
        await sendInformationMessage(rustplus.guildId, 'event', {
            embeds: [DiscordEmbeds.getUpdateEventInformationEmbed(rustplus)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/event_info_logo.png'))]
        });
    },

    sendUpdateMonumentInformationMessage: async function (rustplus) {
        await sendInformationMessage(rustplus.guildId, 'monument', {
            embeds: [DiscordEmbeds.getUpdateMonumentInformationEmbed(rustplus)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/monument_info_logo.png'))]
        });
    },

    sendUpdateTeamInformationMessage: async function (rustplus) {
        await sendInformationMessage(rustplus.guildId, 'team', {
            embeds: [DiscordEmbeds.getUpdateTeamInformationEmbed(rustplus)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/team_info_logo.png'))]
        });
    },

    sendUpdateBattlemetricsOnlinePlayersInformationMessage: async function (rustplus, battlemetricsId) {
        await sendInformationMessage(rustplus.guildId, 'battlemetricsPlayers', {
            embeds: [DiscordEmbeds.getUpdateBattlemetricsOnlinePlayersInformationEmbed(rustplus, battlemetricsId)]
        });
    },

    /*
        Discord messages can only be appended to a channel, they cannot be moved. If the information messages are
        out of order (for example because a section was enabled later on), remove them and create them again in
        the wanted order. The Map message is kept when it is already the first message.
    */
    ensureInformationMessageOrder: async function (rustplus) {
        const instance = Client.client.getInstance(rustplus.guildId);
        const channel = DiscordTools.getTextChannelById(rustplus.guildId, instance.channelId.information);
        if (!channel) return;

        const order = ['map', 'server', 'monument', 'event', 'team', 'battlemetricsPlayers'];

        let messages = null;
        try {
            messages = await channel.messages.fetch({ limit: 100 });
        }
        catch (e) {
            return;
        }

        const positions = new Object();
        Array.from(messages.values())
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .forEach((message, index) => { positions[message.id] = index; });

        /*
            Remove information messages that are not tracked anymore, for example duplicates that were created by an
            earlier race condition. Only messages written by the bot with one of the section titles are considered.
        */
        const trackedIds = Object.values(instance.informationMessageId).filter(messageId => messageId !== null);
        const sectionTitles = [
            Client.client.intlGet(rustplus.guildId, 'serverInfo'),
            Client.client.intlGet(rustplus.guildId, 'monumentInformation'),
            Client.client.intlGet(rustplus.guildId, 'eventInfo'),
            Client.client.intlGet(rustplus.guildId, 'teamMemberInfo'),
            Client.client.intlGet(rustplus.guildId, 'battlemetricsOnlinePlayers')
        ];

        if (Client.client.user) {
            for (const message of messages.values()) {
                if (message.author.id !== Client.client.user.id) continue;
                if (trackedIds.includes(message.id)) continue;
                if (message.embeds.length === 0) continue;
                if (!sectionTitles.includes(message.embeds[0].title)) continue;

                await message.delete().catch(() => undefined);
            }
        }

        let previousPosition = -1;
        let firstSectionType = null;
        let isOrdered = true;

        for (const type of order) {
            const messageId = instance.informationMessageId[type];
            if (!messageId || !positions.hasOwnProperty(messageId)) continue;

            if (firstSectionType === null) firstSectionType = type;
            if (positions[messageId] < previousPosition) isOrdered = false;

            previousPosition = positions[messageId];
        }

        if (isOrdered) return;

        const keepMap = (firstSectionType === 'map');

        for (const type of order) {
            if (keepMap && type === 'map') continue;
            await informationMessageOperationsUnlocked.deleteInformationMessage(rustplus.guildId, type);
        }

        if (!keepMap) {
            await informationMessageOperationsUnlocked.sendUpdateMapInformationMessage(rustplus);
        }

        await informationMessageOperationsUnlocked.sendUpdateServerInformationMessage(rustplus);

        if (instance.generalSettings.displayInformationMonumentInformation) {
            await informationMessageOperationsUnlocked.sendUpdateMonumentInformationMessage(rustplus);
        }

        if (instance.generalSettings.displayInformationEventInformation) {
            await informationMessageOperationsUnlocked.sendUpdateEventInformationMessage(rustplus);
        }

        await informationMessageOperationsUnlocked.sendUpdateTeamInformationMessage(rustplus);

        const server = (instance.activeServer !== null) ? instance.serverList[instance.activeServer] : null;
        const battlemetricsId = (server !== null) ? server.battlemetricsId : null;
        if (instance.generalSettings.displayInformationBattlemetricsAllOnlinePlayers &&
            battlemetricsId !== null && battlemetricsId !== undefined &&
            Client.client.battlemetricsInstances.hasOwnProperty(battlemetricsId)) {
            await informationMessageOperationsUnlocked.sendUpdateBattlemetricsOnlinePlayersInformationMessage(
                rustplus, battlemetricsId);
        }
    },

    sendDiscordCommandResponseMessage: async function (rustplus, client, message, response) {
        const content = {
            embeds: [DiscordEmbeds.getDiscordCommandResponseEmbed(rustplus, response)]
        }

        await client.messageReply(message, content);
    },

    sendCredentialsShowMessage: async function (interaction) {
        const content = {
            embeds: [await DiscordEmbeds.getCredentialsShowEmbed(interaction.guildId)],
            ephemeral: true
        }

        await Client.client.interactionEditReply(interaction, content);
    },

    sendItemAvailableInVendingMachineMessage: async function (rustplus, str) {
        const instance = Client.client.getInstance(rustplus.guildId);

        const content = {
            embeds: [DiscordEmbeds.getItemAvailableVendingMachineEmbed(
                rustplus.guildId, rustplus.serverId, str
            )]
        }

        await module.exports.sendMessage(rustplus.guildId, content, null, instance.channelId.activity);
    },

    sendHelpMessage: async function (interaction) {
        const content = {
            embeds: [DiscordEmbeds.getHelpEmbed(interaction.guildId)],
            components: DiscordButtons.getHelpButtons(),
            ephemeral: true
        }

        await Client.client.interactionReply(interaction, content);
    },

    sendCctvMessage: async function (interaction, monument, cctvCodes, dynamic) {
        const content = {
            embeds: [DiscordEmbeds.getCctvEmbed(interaction.guildId, monument, cctvCodes, dynamic)],
            ephemeral: true
        }

        await Client.client.interactionReply(interaction, content);
    },

    sendUptimeMessage: async function (interaction, uptime) {
        const content = {
            embeds: [DiscordEmbeds.getUptimeEmbed(interaction.guildId, uptime)],
            ephemeral: true
        }

        await Client.client.interactionEditReply(interaction, content);
    },

    sendVoiceMessage: async function (interaction, state) {
        const content = {
            embeds: [DiscordEmbeds.getVoiceEmbed(interaction.guildId, state)],
            ephemeral: true
        }

        await Client.client.interactionEditReply(interaction, content);
    },

    sendCraftMessage: async function (interaction, craftDetails, quantity) {
        const content = {
            embeds: [DiscordEmbeds.getCraftEmbed(interaction.guildId, craftDetails, quantity)],
            ephemeral: true
        }

        await Client.client.interactionEditReply(interaction, content);
    },

    sendResearchMessage: async function (interaction, researchDetails) {
        const content = {
            embeds: [DiscordEmbeds.getResearchEmbed(interaction.guildId, researchDetails)],
            ephemeral: true
        }

        await Client.client.interactionEditReply(interaction, content);
    },

    sendRecycleMessage: async function (interaction, recycleDetails, quantity, recyclerType) {
        const content = {
            embeds: [DiscordEmbeds.getRecycleEmbed(interaction.guildId, recycleDetails, quantity, recyclerType)],
            ephemeral: true
        }

        await Client.client.interactionEditReply(interaction, content);
    },

    sendBattlemetricsEventMessage: async function (guildId, battlemetricsId, title, description, fields = null, everyone = false) {
        const instance = Client.client.getInstance(guildId);

        const content = {
            embeds: [DiscordEmbeds.getBattlemetricsEventEmbed(guildId, battlemetricsId, title, description, fields)]
        }

        if (everyone) {
            content.content = '@everyone';
        }

        await module.exports.sendMessage(guildId, content, null, instance.channelId.activity);
    },

    sendItemMessage: async function (interaction, itemName, itemId, type) {
        const content = {
            embeds: [DiscordEmbeds.getItemEmbed(interaction.guildId, itemName, itemId, type)],
            ephemeral: true
        }

        await Client.client.interactionEditReply(interaction, content);
    },
}

/*
    Sends (or edits) one of the messages of the information channel and stores its id in the instance. A message
    that does not exist anymore is posted again by sendMessage, the id of the section is then replaced.
*/
async function sendInformationMessage(guildId, messageType, content) {
    const instance = Client.client.getInstance(guildId);
    const previousId = instance.informationMessageId[messageType];

    const message = await module.exports.sendMessage(guildId, content, previousId,
        instance.channelId.information);

    if (!message || message.id === previousId) return;

    instance.informationMessageId[messageType] = message.id;
    Client.client.setInstance(guildId, instance);
}

/*
    Every information channel message is created, edited and deleted through the functions above and they all read
    and write the same message ids in the instance. Running them concurrently (for example when two toggles are
    clicked right after each other, or when a toggle is clicked while the information cycle runs) can therefore
    create duplicate messages. Serialize these operations per guild to prevent that.
*/
const informationMessageQueues = new Object();
const informationMessageOperationsUnlocked = new Object();

function queueInformationMessageOperation(guildId, operation) {
    const previous = informationMessageQueues[guildId] || Promise.resolve();

    const current = previous
        .catch(() => undefined)
        .then(operation);

    informationMessageQueues[guildId] = current.catch(() => undefined);

    return current;
}

const informationMessageOperations = [
    'sendInformationMapMessage',
    'sendUpdateMapInformationMessage',
    'sendUpdateServerInformationMessage',
    'sendUpdateEventInformationMessage',
    'sendUpdateMonumentInformationMessage',
    'sendUpdateTeamInformationMessage',
    'sendUpdateBattlemetricsOnlinePlayersInformationMessage',
    'deleteInformationMessage',
    'ensureInformationMessageOrder'
];

for (const operation of informationMessageOperations) {
    if (typeof module.exports[operation] !== 'function') continue;

    informationMessageOperationsUnlocked[operation] = module.exports[operation];

    module.exports[operation] = async function (...args) {
        const guildId = (typeof args[0] === 'string') ? args[0] : (args[0] ? args[0].guildId : null);

        /* Without a guild there is nothing to serialize. */
        if (guildId === null) return informationMessageOperationsUnlocked[operation].apply(module.exports, args);

        return queueInformationMessageOperation(guildId, () =>
            informationMessageOperationsUnlocked[operation].apply(module.exports, args));
    };
}