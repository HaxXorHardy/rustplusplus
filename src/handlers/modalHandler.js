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

const Battlemetrics = require('../structures/Battlemetrics');
const Config = require('../../config');
const Constants = require('../util/constants.js');
const CredentialsLoginHandler = require('./credentialsLoginHandler.js');
const CustomIds = require('../util/customIds.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const DiscordModals = require('../discordTools/discordModals.js');
const Keywords = require('../util/keywords.js');
const Scrape = require('../util/scrape.js');
const SmartSwitchGroupHandler = require('./smartSwitchGroupHandler.js');
const StorageAlerts = require('../util/storageAlerts.js');
const SwitchGroupSchedule = require('../util/switchGroupSchedule.js');
const Timer = require('../util/timer.js');
const TrackerInputParser = require('../util/trackerInputParser.js');

/*
    A field that was added to a form later: a form opened before the deploy is submitted without it. null then, and
    the setting it belongs to stays as it is.
*/
function optionalField(interaction, customId) {
    try {
        return interaction.fields.getTextInputValue(customId);
    }
    catch (e) {
        return null;
    }
}

/* On (true) or off (false) of the group timer form: the choice, or the text of a form opened before 1.51.8. */
function groupTimerState(client, guildId, interaction) {
    try {
        const values = interaction.fields.getStringSelectValues('GroupTimerState');
        if (values.includes('on')) return true;
        if (values.includes('off')) return false;
    }
    catch (e) {
        /* An older form: a text field. */
    }

    const text = optionalField(interaction, 'GroupTimerState');
    if (text === null) return null;
    const state = text.trim().toLowerCase();
    if (['on', 'an', 'ein', client.intlGet(guildId, 'onCap').toLowerCase()].includes(state)) return true;
    if (['off', 'aus', client.intlGet(guildId, 'offCap').toLowerCase()].includes(state)) return false;
    return null;
}

module.exports = async (client, interaction) => {
    const instance = client.getInstance(interaction.guildId);
    const guildId = interaction.guildId;

    const verifyId = Math.floor(100000 + Math.random() * 900000);
    client.logInteraction(interaction, verifyId, 'userModal');

    if (!client.isAllowedUser(interaction)) {
        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userPartOfBlacklist', {
            id: `${verifyId}`,
            user: `${interaction.user.username} (${interaction.user.id})`
        }));
        return;
    }

    if (interaction.customId === 'CredentialsLogin') {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
        await CredentialsLoginHandler.start(client, interaction,
            interaction.fields.getTextInputValue('SteamAccountName'),
            interaction.fields.getTextInputValue('SteamPassword'));
        return;
    }

    if (interaction.customId === 'CredentialsLoginToken') {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
        await CredentialsLoginHandler.token(client, interaction,
            interaction.fields.getTextInputValue('SteamAuthToken'));
        return;
    }

    if (interaction.customId === 'CredentialsLoginCode') {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
        await CredentialsLoginHandler.submitCode(client, interaction,
            interaction.fields.getTextInputValue('SteamGuardCode'));
        return;
    }

    if (interaction.customId.startsWith('CustomTimersEdit')) {
        const ids = JSON.parse(interaction.customId.replace('CustomTimersEdit', ''));
        const server = instance.serverList[ids.serverId];
        const cargoShipEgressTime = parseInt(interaction.fields.getTextInputValue('CargoShipEgressTime'));
        const oilRigCrateUnlockTime = parseInt(interaction.fields.getTextInputValue('OilRigCrateUnlockTime'));
        const deepSeaMinWipeCooldown = parseInt(interaction.fields.getTextInputValue('DeepSeaMinWipeCooldownTime'));
        const deepSeaMaxWipeCooldown = parseInt(interaction.fields.getTextInputValue('DeepSeaMaxWipeCooldownTime'));
        const deepSeaWipeDuration = parseInt(interaction.fields.getTextInputValue('DeepSeaWipeDurationTime'));

        if (!server) {
            interaction.deferUpdate();
            return;
        }

        if (cargoShipEgressTime && ((cargoShipEgressTime * 1000) !== server.cargoShipEgressTimeMs)) {
            server.cargoShipEgressTimeMs = cargoShipEgressTime * 1000;
        }
        if (oilRigCrateUnlockTime && ((oilRigCrateUnlockTime * 1000) !== server.oilRigLockedCrateUnlockTimeMs)) {
            server.oilRigLockedCrateUnlockTimeMs = oilRigCrateUnlockTime * 1000;
        }
        if (deepSeaMinWipeCooldown && ((deepSeaMinWipeCooldown * 1000) !== server.deepSeaMinWipeCooldownMs)) {
            server.deepSeaMinWipeCooldownMs = deepSeaMinWipeCooldown * 1000;
        }
        if (deepSeaMaxWipeCooldown && ((deepSeaMaxWipeCooldown * 1000) !== server.deepSeaMaxWipeCooldownMs)) {
            server.deepSeaMaxWipeCooldownMs = deepSeaMaxWipeCooldown * 1000;
        }
        if (deepSeaWipeDuration && ((deepSeaWipeDuration * 1000) !== server.deepSeaWipeDurationMs)) {
            server.deepSeaWipeDurationMs = deepSeaWipeDuration * 1000;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${server.cargoShipEgressTimeMs}, ${server.oilRigLockedCrateUnlockTimeMs}, ${server.deepSeaMinWipeCooldownMs}, ${server.deepSeaMaxWipeCooldownMs}, ${server.deepSeaWipeDurationMs}`
        }));
    }
    else if (interaction.customId.startsWith('ServerEdit')) {
        const ids = JSON.parse(interaction.customId.replace('ServerEdit', ''));
        const server = instance.serverList[ids.serverId];
        const battlemetricsId = interaction.fields.getTextInputValue('ServerBattlemetricsId');

        if (battlemetricsId !== server.battlemetricsId) {
            if (battlemetricsId === '') {
                server.battlemetricsId = null;
            }
            else if (!Config.battlemetrics.enabled) {
                /* Keep the existing Battlemetrics ID while the integration is disabled. */
            }
            else if (client.battlemetricsInstances.hasOwnProperty(battlemetricsId)) {
                /*
                    The connect string is not taken from Battlemetrics: its port is the query port of the server, the
                    game connects to the game port. It comes from the server list of the game instead (see
                    handlers/serverAddressHandler.js).
                */
                server.battlemetricsId = battlemetricsId;
            }
            else {
                const bmInstance = new Battlemetrics(battlemetricsId);
                await bmInstance.setup();
                if (bmInstance.lastUpdateSuccessful) {
                    client.battlemetricsInstances[battlemetricsId] = bmInstance;
                    server.battlemetricsId = battlemetricsId;
                }
            }
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${server.battlemetricsId}`
        }));

        await DiscordMessages.sendServerMessage(interaction.guildId, ids.serverId);

        /* To force search of player name via scrape */
        client.battlemetricsIntervalCounter = 0;
    }
    else if (interaction.customId.startsWith('SmartSwitchEdit')) {
        const ids = JSON.parse(interaction.customId.replace('SmartSwitchEdit', ''));
        const server = instance.serverList[ids.serverId];
        const smartSwitchName = interaction.fields.getTextInputValue('SmartSwitchName');
        const smartSwitchCommand = interaction.fields.getTextInputValue('SmartSwitchCommand');
        let smartSwitchProximity = null;
        try {
            smartSwitchProximity = parseInt(interaction.fields.getTextInputValue('SmartSwitchProximity'));
        }
        catch (e) {
            smartSwitchProximity = null;
        }

        if (!server || (server && !server.switches.hasOwnProperty(ids.entityId))) {
            interaction.deferUpdate();
            return;
        }

        server.switches[ids.entityId].name = smartSwitchName;

        if (smartSwitchCommand !== server.switches[ids.entityId].command &&
            !Keywords.getListOfUsedKeywords(client, guildId, ids.serverId).includes(smartSwitchCommand)) {
            server.switches[ids.entityId].command = smartSwitchCommand;
        }

        if (smartSwitchProximity !== null && smartSwitchProximity >= 0) {
            server.switches[ids.entityId].proximity = smartSwitchProximity;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${smartSwitchName}, ${server.switches[ids.entityId].command}`
        }));

        await DiscordMessages.sendSmartSwitchMessage(guildId, ids.serverId, ids.entityId);
    }
    else if (interaction.customId.startsWith('GroupEdit')) {
        const ids = JSON.parse(interaction.customId.replace('GroupEdit', ''));
        const server = instance.serverList[ids.serverId];
        const groupName = interaction.fields.getTextInputValue('GroupName');
        const groupCommand = interaction.fields.getTextInputValue('GroupCommand');

        if (!server || (server && !server.switchGroups.hasOwnProperty(ids.groupId))) {
            interaction.deferUpdate();
            return;
        }

        server.switchGroups[ids.groupId].name = groupName;

        /* Empty: a group turned on by an alarm stays on. Something that is no time leaves the setting alone. */
        const alarmOffAfterField = optionalField(interaction, 'GroupAlarmOffAfter');
        const alarmOffAfter = alarmOffAfterField === null ? null : alarmOffAfterField.trim();
        if (alarmOffAfter === '') {
            server.switchGroups[ids.groupId].alarmOffAfterSeconds = 0;
        }
        else if (alarmOffAfter !== null) {
            const seconds = Timer.getSecondsFromStringTime(alarmOffAfter);
            if (seconds !== null && seconds > 0) server.switchGroups[ids.groupId].alarmOffAfterSeconds = seconds;
        }

        /* "22:00-06:00 off, 18:00-22:00 on", optionally with a time zone in front. Empty = no schedule. */
        const scheduleField = optionalField(interaction, 'GroupSchedule');
        const schedule = scheduleField === null ? { schedule: null, rejected: [] } :
            SwitchGroupSchedule.parse(scheduleField, ['on', 'an', 'ein', client.intlGet(guildId, 'onCap')],
                ['off', 'aus', client.intlGet(guildId, 'offCap')]);
        if (scheduleField !== null && (schedule.rejected.length === 0 || schedule.schedule !== null)) {
            server.switchGroups[ids.groupId].schedule = schedule.schedule;
        }
        if (schedule.rejected.length !== 0) {
            client.log(client.intlGet(null, 'warningCap'),
                `Switch group ${ids.groupId}: no schedule in "${schedule.rejected.join('", "')}".`, 'warn');
        }

        if (groupCommand !== server.switchGroups[ids.groupId].command &&
            !Keywords.getListOfUsedKeywords(client, interaction.guildId, ids.serverId).includes(groupCommand)) {
            server.switchGroups[ids.groupId].command = groupCommand;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${groupName}, ${server.switchGroups[ids.groupId].command}`
        }));

        await DiscordMessages.sendSmartSwitchGroupMessage(interaction.guildId, ids.serverId, ids.groupId);
    }
    else if (interaction.customId.startsWith('GroupTimer')) {
        const ids = JSON.parse(interaction.customId.replace('GroupTimer', ''));
        const server = instance.serverList[ids.serverId];
        const rustplus = client.rustplusInstances[guildId];

        const seconds = Timer.getSecondsFromStringTime(interaction.fields.getTextInputValue('GroupTimerDuration'));
        const active = groupTimerState(client, guildId, interaction);

        /* Answered first: the group message is edited through this interaction (setGroup options.interaction). */
        await interaction.deferUpdate();

        if (!server || !server.switchGroups.hasOwnProperty(ids.groupId) || seconds === null || seconds <= 0 ||
            active === null || !rustplus || rustplus.serverId !== ids.serverId) {
            return;
        }

        if (instance.generalSettings.smartSwitchNotifyInGameWhenChangedFromDiscord) {
            rustplus.sendInGameMessage(client.intlGet(guildId, 'userTurnedOnOffSmartSwitchGroupFromDiscord', {
                user: interaction.user.username,
                name: server.switchGroups[ids.groupId].name,
                status: active ? client.intlGet(guildId, 'onCap') : client.intlGet(guildId, 'offCap')
            }));
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${active}, ${seconds}`
        }));

        try {
            await SmartSwitchGroupHandler.setGroup(client, rustplus, guildId, ids.serverId, ids.groupId, active,
                { seconds: seconds, interaction: interaction });
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `The timer of switch group ${ids.groupId} failed: ${e && e.message ? e.message : e}`, 'warn');
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userModalInteractionSuccess', {
            id: `${verifyId}`
        }));
        return;
    }
    else if (interaction.customId.startsWith('SmartAlarmEdit')) {
        const ids = JSON.parse(interaction.customId.replace('SmartAlarmEdit', ''));
        const server = instance.serverList[ids.serverId];
        const smartAlarmName = interaction.fields.getTextInputValue('SmartAlarmName');
        const smartAlarmMessage = interaction.fields.getTextInputValue('SmartAlarmMessage');
        const smartAlarmCommand = interaction.fields.getTextInputValue('SmartAlarmCommand');

        if (!server || (server && !server.alarms.hasOwnProperty(ids.entityId))) {
            interaction.deferUpdate();
            return;
        }

        server.alarms[ids.entityId].name = smartAlarmName;
        server.alarms[ids.entityId].message = smartAlarmMessage;

        if (smartAlarmCommand !== server.alarms[ids.entityId].command &&
            !Keywords.getListOfUsedKeywords(client, guildId, ids.serverId).includes(smartAlarmCommand)) {
            server.alarms[ids.entityId].command = smartAlarmCommand;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${smartAlarmName}, ${smartAlarmMessage}, ${server.alarms[ids.entityId].command}`
        }));

        await DiscordMessages.sendSmartAlarmMessage(interaction.guildId, ids.serverId, ids.entityId);
    }
    else if (interaction.customId.startsWith('StorageMonitorEdit')) {
        const ids = CustomIds.parse(interaction.customId, 'StorageMonitorEdit', ['serverId', 'entityId']);
        const server = instance.serverList[ids.serverId];
        const storageMonitorName = interaction.fields.getTextInputValue('StorageMonitorName');

        if (!server || (server && !server.storageMonitors.hasOwnProperty(ids.entityId))) {
            interaction.deferUpdate();
            return;
        }

        server.storageMonitors[ids.entityId].name = storageMonitorName;

        /* Alert rules such as "Rifle Ammo < 100"; parts that name no item are left out (and logged). */
        const alertsField = optionalField(interaction, 'StorageMonitorAlerts');
        const alerts = alertsField === null ? { rules: null, rejected: [] } : StorageAlerts.parse(client.items, alertsField);
        if (alerts.rules !== null) server.storageMonitors[ids.entityId].alerts = alerts.rules;
        if (alerts.rejected.length !== 0) {
            client.log(client.intlGet(null, 'warningCap'),
                `Storage monitor ${ids.entityId}: no alert rule in "${alerts.rejected.join('", "')}".`, 'warn');
        }
        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${storageMonitorName}`
        }));

        await DiscordMessages.sendStorageMonitorMessage(interaction.guildId, ids.serverId, ids.entityId);

        /* New rules are checked against the current contents now (detached: the form must be answered in 3 s). */
        const rustplus = client.rustplusInstances[guildId];
        if (alerts.rules !== null && rustplus && rustplus.serverId === ids.serverId) {
            StorageAlerts.check(client, rustplus, ids.entityId).catch((e) => {
                client.log(client.intlGet(null, 'warningCap'),
                    `Storage monitor ${ids.entityId}: the alert rules could not be checked: ${e.message}`, 'warn');
            });
        }
    }
    else if (interaction.customId.startsWith('TrackerEdit')) {
        const ids = JSON.parse(interaction.customId.replace('TrackerEdit', ''));
        const tracker = instance.trackers[ids.trackerId];
        const trackerName = interaction.fields.getTextInputValue('TrackerName');
        const trackerBattlemetricsId = interaction.fields.getTextInputValue('TrackerBattlemetricsId');
        const trackerClanTag = interaction.fields.getTextInputValue('TrackerClanTag');

        if (!tracker) {
            interaction.deferUpdate();
            return;
        }

        tracker.name = trackerName;
        if (trackerClanTag !== tracker.clanTag) {
            tracker.clanTag = trackerClanTag;
            client.battlemetricsIntervalCounter = 0;
        }

        if (Config.battlemetrics.enabled && trackerBattlemetricsId !== tracker.battlemetricsId) {
            if (client.battlemetricsInstances.hasOwnProperty(trackerBattlemetricsId)) {
                const bmInstance = client.battlemetricsInstances[trackerBattlemetricsId];
                tracker.battlemetricsId = trackerBattlemetricsId;
                tracker.serverId = `${bmInstance.server_ip}-${bmInstance.server_port}`;
                tracker.img = Constants.DEFAULT_SERVER_IMG;
                tracker.title = bmInstance.server_name;
            }
            else {
                const bmInstance = new Battlemetrics(trackerBattlemetricsId);
                await bmInstance.setup();
                if (bmInstance.lastUpdateSuccessful) {
                    client.battlemetricsInstances[trackerBattlemetricsId] = bmInstance;
                    tracker.battlemetricsId = trackerBattlemetricsId;
                    tracker.serverId = `${bmInstance.server_ip}-${bmInstance.server_port}`;
                    tracker.img = Constants.DEFAULT_SERVER_IMG;
                    tracker.title = bmInstance.server_name;
                }
            }
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${trackerName}, ${tracker.battlemetricsId}, ${tracker.clanTag}`
        }));

        await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
    }
    else if (interaction.customId.startsWith('TrackerAddPlayer')) {
        const ids = JSON.parse(interaction.customId.replace('TrackerAddPlayer', ''));
        const tracker = instance.trackers[ids.trackerId];
        const input = (optionalField(interaction, 'TrackerAddPlayerId') || '').trim();

        if (!tracker) {
            interaction.deferUpdate();
            return;
        }

        /* Players picked from the online / offline choices (Battlemetrics ids). */
        const picked = [];
        for (const customId of ['TrackerAddPlayerOnline0', 'TrackerAddPlayerOnline1', 'TrackerAddPlayerOnline2',
            'TrackerAddPlayerOnline3', 'TrackerAddPlayerOffline']) {
            try {
                picked.push(...interaction.fields.getStringSelectValues(customId));
            }
            catch (e) {
                /* Not in this form. */
            }
        }

        const pickedBmInstance = client.battlemetricsInstances[tracker.battlemetricsId];
        const added = [];
        for (const playerId of picked) {
            if (tracker.players.some(e => e.playerId === playerId)) continue;
            /* Offline players since the wipe are not in the players Battlemetrics sent with the server. */
            const sinceWipe = pickedBmInstance ? (pickedBmInstance.getCachedPlayersSinceWipe() || []) : [];
            const sinceWipePlayer = sinceWipe.find(e => e.id === playerId);
            const name = pickedBmInstance && pickedBmInstance.players.hasOwnProperty(playerId) ?
                pickedBmInstance.players[playerId]['name'] : sinceWipePlayer ? sinceWipePlayer.name : '-';
            tracker.players.push({ name: name, steamId: null, playerId: playerId });
            added.push(playerId);
        }

        if (added.length !== 0) {
            client.setInstance(interaction.guildId, instance);
            client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
                id: `${verifyId}`,
                value: added.join(', ')
            }));
        }

        if (input === '') {
            if (added.length !== 0) await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
            client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userModalInteractionSuccess', {
                id: `${verifyId}`
            }));
            interaction.deferUpdate();
            return;
        }

        const parsedInput = TrackerInputParser.parseTrackerPlayerInput(input);
        if (!parsedInput.valid) {
            if (added.length !== 0) await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
            const str = client.intlGet(interaction.guildId, 'trackerPlayerInputInvalid');
            await client.interactionReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            return;
        }

        let id = parsedInput.value;
        let isSteamId64 = parsedInput.type === 'steamId';
        if (parsedInput.type === 'steamVanityUrl') {
            const resolvedSteamId = await Scrape.scrapeSteamIdFromVanity(client, parsedInput.value);
            if (!resolvedSteamId) {
                if (added.length !== 0) await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
                const str = client.intlGet(interaction.guildId, 'trackerPlayerInputInvalid');
                await client.interactionReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                return;
            }

            id = resolvedSteamId;
            isSteamId64 = true;
        }

        const bmInstance = client.battlemetricsInstances[tracker.battlemetricsId];

        if ((isSteamId64 && tracker.players.some(e => e.steamId === id)) ||
            (!isSteamId64 && tracker.players.some(e => e.playerId === id))) {
            if (added.length !== 0) await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
            interaction.deferUpdate();
            return;
        }

        let name = null;
        let steamId = null;
        let playerId = null;

        if (isSteamId64) {
            steamId = id;
            name = await Scrape.scrapeSteamProfileName(client, id);

            if (name && bmInstance) {
                playerId = Object.keys(bmInstance.players).find(e => bmInstance.players[e]['name'] === name);
                if (!playerId) playerId = null;
            }
        }
        else {
            playerId = id;
            if (bmInstance && bmInstance.players.hasOwnProperty(id)) {
                name = bmInstance.players[id]['name'];
            }
            else {
                name = '-';
            }
        }

        tracker.players.push({
            name: name,
            steamId: steamId,
            playerId: playerId
        });
        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${id}`
        }));

        await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
    }
    else if (interaction.customId.startsWith('TrackerRemovePlayer')) {
        const ids = JSON.parse(interaction.customId.replace('TrackerRemovePlayer', ''));
        const tracker = instance.trackers[ids.trackerId];
        const input = (optionalField(interaction, 'TrackerRemovePlayerId') || '').trim();

        if (!tracker) {
            interaction.deferUpdate();
            return;
        }

        /* Players picked from the choices of the players in the tracker. */
        const picked = new Set();
        for (let i = 0; i < 4; i++) {
            try {
                for (const key of interaction.fields.getStringSelectValues(`TrackerRemovePlayerPick${i}`)) {
                    picked.add(key);
                }
            }
            catch (e) {
                /* Not in this form. */
            }
        }

        const pickedRemoved = tracker.players.filter(e => picked.has(DiscordModals.trackerPlayerKey(e)));
        if (pickedRemoved.length !== 0) {
            tracker.players = tracker.players.filter(e => !picked.has(DiscordModals.trackerPlayerKey(e)));
            client.setInstance(interaction.guildId, instance);
            client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
                id: `${verifyId}`,
                value: pickedRemoved.map(e => e.steamId || e.playerId || e.name).join(', ')
            }));
        }

        if (input === '') {
            if (pickedRemoved.length !== 0) {
                await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
            }
            client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userModalInteractionSuccess', {
                id: `${verifyId}`
            }));
            interaction.deferUpdate();
            return;
        }

        const parsedInput = TrackerInputParser.parseTrackerPlayerInput(input);
        let id = parsedInput.valid ? parsedInput.value : parsedInput.normalizedInput;
        let isSteamId64 = parsedInput.valid ? parsedInput.type === 'steamId' : false;
        let useRawRemoval = !parsedInput.valid;
        if (parsedInput.valid && parsedInput.type === 'steamVanityUrl') {
            const resolvedSteamId = await Scrape.scrapeSteamIdFromVanity(client, parsedInput.value);
            if (resolvedSteamId) {
                id = resolvedSteamId;
                isSteamId64 = true;
            }
            else {
                useRawRemoval = true;
                id = parsedInput.normalizedInput;
                isSteamId64 = false;
            }
        }

        const previousLength = tracker.players.length;

        if (useRawRemoval) {
            tracker.players = tracker.players.filter(e => e.steamId !== id && e.playerId !== id);
        }
        else if (isSteamId64) {
            tracker.players = tracker.players.filter(e => e.steamId !== id);
        }
        else {
            tracker.players = tracker.players.filter(e => e.playerId !== id);
        }

        if (useRawRemoval && previousLength === tracker.players.length) {
            if (pickedRemoved.length !== 0) {
                await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
            }
            const str = client.intlGet(interaction.guildId, 'trackerPlayerInputInvalid');
            await client.interactionReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            return;
        }

        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${id}`
        }));

        await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
    }

    client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userModalInteractionSuccess', {
        id: `${verifyId}`
    }));

    interaction.deferUpdate();
}
