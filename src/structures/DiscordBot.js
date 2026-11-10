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

const FormatJS = require('@formatjs/intl');
const Discord = require('discord.js');
const Fs = require('fs');
const Path = require('path');

const Battlemetrics = require('../structures/Battlemetrics');
const Cctv = require('./Cctv');
const Config = require('../../config');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordTools = require('../discordTools/discordTools');
const LoadCommandModules = require('../discordTools/loadCommandModules.js');
const RegisterSlashCommands = require('../discordTools/RegisterSlashCommands.js');
const SetupGuildCategory = require('../discordTools/SetupGuildCategory.js');
const SetupGuildChannels = require('../discordTools/SetupGuildChannels.js');
const SetupSettingsMenu = require('../discordTools/SetupSettingsMenu.js');
const InstanceUtils = require('../util/instanceUtils.js');
const Items = require('./Items');
const LogChannelRelay = require('../util/logChannelRelay.js');
const Logger = require('./Logger.js');
const PermissionHandler = require('../handlers/permissionHandler.js');
const RustLabs = require('../structures/RustLabs');
const RustPlus = require('../structures/RustPlus');
const RustPlusTransport = require('../util/rustplusTransport.js');
const Version = require('../../package.json').version;

class DiscordBot extends Discord.Client {
    constructor(props) {
        super(props);

        this.logger = new Logger(Path.join(__dirname, '..', '..', 'logs/discordBot.log'), 'default');

        this.commands = new Discord.Collection();
        this.instances = {};
        this.guildIntl = {};
        this.botIntl = null;
        this.enIntl = null;
        this.enMessages = JSON.parse(Fs.readFileSync(Path.join(__dirname, '..', 'languages', 'en.json')), 'utf8');

        this.rustplusInstances = new Object();
        this.activeRustplusInstances = new Object();
        this.rustplusReconnectTimers = new Object();
        /* Number of reconnect attempts in a row, the delay grows with it. */
        this.rustplusReconnectAttempts = new Object();
        this.rustplusLiteReconnectTimers = new Object();
        this.rustplusReconnecting = new Object();
        this.rustplusMaps = new Object();
        /* Consecutive failed connection attempts per guild, decides about the websocket transport. */
        this.rustplusConnectFailures = new Object();
        this.steamLoginFlows = new Object();

        this.uptimeBot = null;

        this.items = new Items();
        this.rustlabs = new RustLabs();
        this.cctv = new Cctv();

        this.pollingIntervalMs = Config.general.pollingIntervalMs;

        this.battlemetricsInstances = new Object();

        this.battlemetricsIntervalId = null;
        this.battlemetricsIntervalCounter = 0;

        this.credentialsExpiryIntervalId = null;

        this.voiceLeaveTimeouts = new Object();

        this.loadDiscordCommands();
        this.loadDiscordEvents();
        this.loadEnIntl();
        this.loadBotIntl();
    }

    loadDiscordCommands() {
        for (const command of LoadCommandModules()) {
            this.commands.set(command.name, command);
        }
    }

    loadDiscordEvents() {
        const eventFiles = Fs.readdirSync(Path.join(__dirname, '..', 'discordEvents'))
            .filter(file => file.endsWith('.js'));
        for (const file of eventFiles) {
            const event = require(`../discordEvents/${file}`);

            if (event.name === 'rateLimited') {
                this.rest.on(event.name, (...args) => event.execute(this, ...args));
            }
            else if (event.once) {
                this.once(event.name, (...args) => event.execute(this, ...args));
            }
            else {
                this.on(event.name, (...args) => event.execute(this, ...args));
            }
        }
    }

    loadEnIntl() {
        const language = 'en';
        const path = Path.join(__dirname, '..', 'languages', `${language}.json`);
        const messages = JSON.parse(Fs.readFileSync(path, 'utf8'));
        const cache = FormatJS.createIntlCache();
        this.enIntl = FormatJS.createIntl({
            locale: language,
            defaultLocale: 'en',
            messages: messages
        }, cache);
    }

    loadBotIntl() {
        const language = Config.general.language;
        const path = Path.join(__dirname, '..', 'languages', `${language}.json`);
        const messages = JSON.parse(Fs.readFileSync(path, 'utf8'));
        const cache = FormatJS.createIntlCache();
        this.botIntl = FormatJS.createIntl({
            locale: language,
            defaultLocale: 'en',
            messages: messages
        }, cache);
    }

    loadGuildIntl(guildId) {
        const instance = InstanceUtils.readInstanceFile(guildId);
        const language = instance.generalSettings.language;
        const path = Path.join(__dirname, '..', 'languages', `${language}.json`);
        const messages = JSON.parse(Fs.readFileSync(path, 'utf8'));
        const cache = FormatJS.createIntlCache();
        this.guildIntl[guildId] = FormatJS.createIntl({
            locale: language,
            defaultLocale: 'en',
            messages: messages
        }, cache);
    }

    loadGuildsIntl() {
        for (const guild of this.guilds.cache) {
            this.loadGuildIntl(guild[0]);
        }
    }

    intlGet(guildId, id, variables = {}) {
        let intl = null;
        if (guildId && guildId !== 'en') {
            intl = this.guildIntl[guildId];
        }
        else {
            if (guildId === 'en') {
                intl = this.enIntl;
            }
            else {
                intl = this.botIntl;
            }
        }

        return intl.formatMessage({
            id: id,
            defaultMessage: this.enMessages[id]
        }, variables);
    }

    build() {
        if (Config.general.debug) {
            this.log(this.intlGet(null, 'infoCap'),
                'Debug mode is enabled (RPP_DEBUG=true), verbose logging is active.');
        }

        this.login(Config.discord.token).catch(error => {
            const formattedError = this.logger.formatError(error);
            switch (error.code) {
                case 502: {
                    this.log(this.intlGet(null, 'errorCap'),
                        this.intlGet(null, 'badGateway', { error: formattedError }), 'error')
                } break;

                case 503: {
                    this.log(this.intlGet(null, 'errorCap'),
                        this.intlGet(null, 'serviceUnavailable', { error: formattedError }), 'error')
                } break;

                default: {
                    this.log(this.intlGet(null, 'errorCap'), error, 'error');
                } break;
            }
        });
    }

    log(title, text, level = 'info') {
        this.logger.log(title, text, level);
    }

    debug(title, text) {
        this.logger.debug(title, text);
    }

    logInteraction(interaction, verifyId, type) {
        const channel = DiscordTools.getTextChannelById(interaction.guildId, interaction.channelId);
        const args = new Object();
        args['guild'] = `${interaction.member.guild.name} (${interaction.member.guild.id})`;
        args['channel'] = `${channel.name} (${interaction.channelId})`;
        args['user'] = `${interaction.user.username} (${interaction.user.id})`;
        args[(type === 'slashCommand') ? 'command' : 'customid'] = (type === 'slashCommand') ?
            `${interaction.commandName}` : `${interaction.customId}`;
        args['id'] = `${verifyId}`;

        this.log(this.intlGet(null, 'infoCap'), this.intlGet(null, `${type}Interaction`, args));
    }

    async setupGuild(guild) {
        const instance = this.getInstance(guild.id);
        const firstTime = instance.firstTime;

        await RegisterSlashCommands(this, guild);

        let category = await SetupGuildCategory(this, guild);
        await SetupGuildChannels(this, guild, category);
        if (firstTime) {
            const perms = PermissionHandler.getPermissionsRemoved(this, guild);
            try {
                await category.permissionOverwrites.set(perms);
            }
            catch (e) {
                this.log(this.intlGet(null, 'warningCap'), e, 'warning');
            }
        }
        else {
            await PermissionHandler.resetPermissionsAllChannels(this, guild);
        }

        await SetupSettingsMenu(this, guild);

        if (firstTime) await PermissionHandler.resetPermissionsAllChannels(this, guild);

        /*
            Lifecycle marker of the server-log channel. setupGuild() runs on startup (ready.js) and when the bot
            joins a guild (guildCreate.js), so the line marks the channel of the current process.
        */
        LogChannelRelay.pushStartLine(guild.id,
            `${this.intlGet(null, 'infoCap')}: rustplusplus ${Version} started`);

        this.resetRustplusVariables(guild.id);
    }

    async syncCredentialsWithUsers(guild) {
        const credentials = InstanceUtils.readCredentialsFile(guild.id);

        const members = await guild.members.fetch();
        const memberIds = [];
        for (const member of members) {
            memberIds.push(member[0]);
        }

        const steamIdRemoveCredentials = [];
        for (const [steamId, content] of Object.entries(credentials)) {
            if (steamId === 'hoster') continue;

            /* Credential files of older versions have no owner, they cannot be matched with the members. */
            if (!content || !content.discord_user_id) {
                this.log(this.intlGet(null, 'warningCap'),
                    `The stored credentials of ${steamId} have no Discord user, removing them., removing them.`);
                steamIdRemoveCredentials.push(steamId);
                continue;
            }

            if (!(memberIds.includes(content.discord_user_id))) {
                this.log(this.intlGet(null, 'warningCap'),
                    `The stored credentials of ${steamId} belong to ${content.discord_user_id}, who is not a member of ` +
                    `${guild.name} anymore - removing them.`);
                steamIdRemoveCredentials.push(steamId);
            }
        }

        /* Leave the file alone when nothing has to be removed, so its timestamp stays meaningful. */
        if (steamIdRemoveCredentials.length === 0) return;

        for (const steamId of steamIdRemoveCredentials) {
            /* The hoster of a removed credential has to be chosen again. */
            if (steamId === credentials.hoster) credentials.hoster = null;

            delete credentials[steamId];
        }

        InstanceUtils.writeCredentialsFile(guild.id, credentials);
    }

    getInstance(guildId) {
        return this.instances[guildId];
    }

    setInstance(guildId, instance) {
        this.instances[guildId] = instance;
        InstanceUtils.writeInstanceFile(guildId, instance);
    }

    readNotificationSettingsTemplate() {
        return JSON.parse(Fs.readFileSync(
            Path.join(__dirname, '..', 'templates/notificationSettingsTemplate.json'), 'utf8'));
    }

    readGeneralSettingsTemplate() {
        return JSON.parse(Fs.readFileSync(
            Path.join(__dirname, '..', 'templates/generalSettingsTemplate.json'), 'utf8'));
    }

    createRustplusInstance(guildId, serverIp, appPort, steamId, playerToken) {
        /*
            An entry without an address cannot be reached: the library would build `ws://undefined:undefined` and throw
            inside the WebSocket constructor. connect() refuses that connection, the reason is logged here already so
            the missing address is not mistaken for a network problem.
        */
        if (!serverIp || !appPort) {
            this.log(this.intlGet(null, 'warningCap'),
                `The server of ${guildId} has no address (${serverIp}:${appPort}), it cannot be connected. ` +
                'Use "/credentials login" in Discord so the Rust+ account provides its servers.', 'warn');
        }

        const directFailures = this.rustplusConnectFailures[guildId] || 0;
        const useFacepunchProxy = RustPlusTransport.shouldUseFacepunchProxy(
            Config.general.rustplusTransport, directFailures);

        /* Only one instance per guild, otherwise two sockets compete for the same relay connection. */
        if (this.rustplusInstances[guildId]) {
            this.rustplusInstances[guildId].deleteThisRustplusInstance();
        }

        let rustplus = new RustPlus(guildId, serverIp, appPort, steamId, playerToken, useFacepunchProxy);

        /* Add rustplus instance to Object */
        this.rustplusInstances[guildId] = rustplus;
        this.activeRustplusInstances[guildId] = true;

        rustplus.build();

        return rustplus;
    }

    createRustplusInstancesFromConfig() {
        const files = Fs.readdirSync(Path.join(__dirname, '..', '..', 'instances'));

        files.forEach(file => {
            if (!file.endsWith('.json')) return;

            const guildId = file.replace('.json', '');
            const instance = this.getInstance(guildId);
            if (!instance) return;

            /* A guild that already has an instance (renewed pairing, login) must not get a second one. */
            if (this.rustplusInstances[guildId]) return;

            if (instance.activeServer !== null && instance.serverList.hasOwnProperty(instance.activeServer)) {
                this.createRustplusInstance(
                    guildId,
                    instance.serverList[instance.activeServer].serverIp,
                    instance.serverList[instance.activeServer].appPort,
                    instance.serverList[instance.activeServer].steamId,
                    instance.serverList[instance.activeServer].playerToken);
            }
        });
    }

    resetRustplusVariables(guildId) {
        this.activeRustplusInstances[guildId] = false;
        this.rustplusReconnecting[guildId] = false;
        this.rustplusReconnectAttempts[guildId] = 0;
        delete this.rustplusMaps[guildId];

        if (this.rustplusReconnectTimers[guildId]) {
            clearTimeout(this.rustplusReconnectTimers[guildId]);
            this.rustplusReconnectTimers[guildId] = null;
        }
        if (this.rustplusLiteReconnectTimers[guildId]) {
            clearTimeout(this.rustplusLiteReconnectTimers[guildId]);
            this.rustplusLiteReconnectTimers[guildId] = null;
        }
    }

    isJpgImageChanged(guildId, map) {
        return ((JSON.stringify(this.rustplusMaps[guildId])) !== (JSON.stringify(map.jpgImage)));
    }

    findAvailableTrackerId(guildId) {
        const instance = this.getInstance(guildId);

        while (true) {
            const randomNumber = Math.floor(Math.random() * 1000);
            if (!instance.trackers.hasOwnProperty(randomNumber)) {
                return randomNumber;
            }
        }
    }

    findAvailableGroupId(guildId, serverId) {
        const instance = this.getInstance(guildId);

        while (true) {
            const randomNumber = Math.floor(Math.random() * 1000);
            if (!instance.serverList[serverId].switchGroups.hasOwnProperty(randomNumber)) {
                return randomNumber;
            }
        }
    }

    /**
     *  Check if Battlemetrics instances are missing/not required/need update.
     */
    async updateBattlemetricsInstances() {
        if (!Config.battlemetrics.enabled) {
            this.battlemetricsInstances = new Object();
            return;
        }

        const activeInstances = [];

        /* Check for instances that are missing or need update. */
        for (const guild of this.guilds.cache) {
            const guildId = guild[0];
            const instance = this.getInstance(guildId);
            const activeServer = instance.activeServer;
            if (activeServer !== null && instance.serverList.hasOwnProperty(activeServer)) {
                if (instance.serverList[activeServer].battlemetricsId !== null) {
                    /* A Battlemetrics ID exist. */
                    const battlemetricsId = instance.serverList[activeServer].battlemetricsId;
                    if (!activeInstances.includes(battlemetricsId)) {
                        activeInstances.push(battlemetricsId);
                        if (this.battlemetricsInstances.hasOwnProperty(battlemetricsId)) {
                            /* Update */
                            await this.battlemetricsInstances[battlemetricsId].evaluation();
                        }
                        else {
                            /* Add */
                            const bmInstance = new Battlemetrics(battlemetricsId);
                            await bmInstance.setup();
                            this.battlemetricsInstances[battlemetricsId] = bmInstance;
                        }
                    }
                }
                else {
                    /* Battlemetrics ID is missing, try with server name. */
                    const name = instance.serverList[activeServer].title;
                    const bmInstance = new Battlemetrics(null, name);
                    await bmInstance.setup();
                    if (bmInstance.lastUpdateSuccessful) {
                        /* Found an Id, is it a new Id? */
                        instance.serverList[activeServer].battlemetricsId = bmInstance.id;
                        this.setInstance(guildId, instance);

                        if (this.battlemetricsInstances.hasOwnProperty(bmInstance.id)) {
                            if (!activeInstances.includes(bmInstance.id)) {
                                activeInstances.push(bmInstance.id);
                                await this.battlemetricsInstances[bmInstance.id].evaluation(bmInstance.data);
                            }
                        }
                        else {
                            activeInstances.push(bmInstance.id);
                            this.battlemetricsInstances[bmInstance.id] = bmInstance;
                        }
                    }
                }
            }

            for (const [trackerId, content] of Object.entries(instance.trackers)) {
                if (!activeInstances.includes(content.battlemetricsId)) {
                    activeInstances.push(content.battlemetricsId);
                    if (this.battlemetricsInstances.hasOwnProperty(content.battlemetricsId)) {
                        /* Update */
                        await this.battlemetricsInstances[content.battlemetricsId].evaluation();
                    }
                    else {
                        /* Add */
                        const bmInstance = new Battlemetrics(content.battlemetricsId);
                        await bmInstance.setup();
                        this.battlemetricsInstances[content.battlemetricsId] = bmInstance;
                    }
                }
            }
        }

        /* Find instances that are no longer required and delete them. */
        const remove = Object.keys(this.battlemetricsInstances).filter(e => !activeInstances.includes(e));
        for (const id of remove) {
            delete this.battlemetricsInstances[id];
        }
    }

    async interactionReply(interaction, content) {
        try {
            return await interaction.reply(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'interactionReplyFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async interactionEditReply(interaction, content) {
        try {
            return await interaction.editReply(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'interactionEditReplyFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async interactionUpdate(interaction, content) {
        try {
            return await interaction.update(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'interactionUpdateFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async messageEdit(message, content) {
        try {
            return await message.edit(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'messageEditFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async messageSend(channel, content) {
        try {
            return await channel.send(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'messageSendFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async messageReply(message, content) {
        try {
            return await message.reply(content);
        }
        catch (e) {
            this.log(this.intlGet(null, 'errorCap'),
                this.intlGet(null, 'messageReplyFailed', { error: e }), 'error');
        }

        return undefined;
    }

    async validatePermissions(interaction) {
        const instance = this.getInstance(interaction.guildId);

        if (!this.isAllowedUser(interaction)) {
            return false;
        }

        /* If role isn't setup yet, validate as true */
        if (instance.role === null) return true;

        if (!interaction.member.permissions.has(Discord.PermissionsBitField.Flags.Administrator) &&
            !interaction.member.roles.cache.has(instance.role)) {
            let role = DiscordTools.getRole(interaction.guildId, instance.role);
            const str = this.intlGet(interaction.guildId, 'notPartOfRole', { role: role.name });
            await this.interactionReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            this.log(this.intlGet(null, 'warningCap'), str);
            return false;
        }
        return true;
    }

    isAdministrator(interaction) {
        return interaction.member.permissions.has(Discord.PermissionFlagsBits.Administrator);
    }

    /* Blacklisted users keep read access but may not trigger actions, unless they are administrators. */
    isBlacklisted(interaction) {
        return this.getInstance(interaction.guildId).blacklist['discordIds'].includes(interaction.user.id);
    }

    isAllowedUser(interaction) {
        return !this.isBlacklisted(interaction) || this.isAdministrator(interaction);
    }

    /* Single enforcement point for RPP_NEED_ADMIN_PRIVILEGES. Callers that need to answer the user
       should use requireAdminPrivileges; component handlers that only need to stop processing can
       use this predicate directly. */
    hasAdminPrivileges(interaction) {
        return !Config.discord.needAdminPrivileges || this.isAdministrator(interaction);
    }

    /* Returns false after telling the caller they are not allowed to run this action. */
    async requireAdminPrivileges(interaction) {
        if (this.hasAdminPrivileges(interaction)) return true;

        const str = this.intlGet(interaction.guildId, 'missingPermission');
        const embed = DiscordEmbeds.getActionInfoEmbed(1, str);
        if (interaction.deferred || interaction.replied) {
            await this.interactionEditReply(interaction, embed);
        }
        else {
            await this.interactionReply(interaction, embed);
        }
        this.log(this.intlGet(null, 'warningCap'), str);
        return false;
    }
}

module.exports = DiscordBot;
