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

const Client = require('../structures/clientRegistry.js');
const TextInput = require('./discordTextInputs.js');
const StorageAlerts = require('../util/storageAlerts.js');
const SwitchGroupSchedule = require('../util/switchGroupSchedule.js');
const Timer = require('../util/timer.js');
const SwitchGroupState = require('../util/switchGroupState.js');

module.exports = {
    getModal: function (options = {}) {
        const modal = new Discord.ModalBuilder();

        if (options.hasOwnProperty('customId')) modal.setCustomId(options.customId);
        if (options.hasOwnProperty('title')) modal.setTitle(options.title.slice(0, 45));

        return modal;
    },

    getServerEditModal(guildId, serverId) {
        const instance = Client.client.getInstance(guildId);
        const server = instance.serverList[serverId];
        const identifier = JSON.stringify({ "serverId": serverId });

        const modal = module.exports.getModal({
            customId: `ServerEdit${identifier}`,
            title: Client.client.intlGet(guildId, 'editing')
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'ServerBattlemetricsId',
                label: Client.client.intlGet(guildId, 'battlemetricsId'),
                value: server.battlemetricsId === null ? '' : server.battlemetricsId,
                style: Discord.TextInputStyle.Short,
                required: false,
                minLength: 0
            }))
        );

        return modal;
    },

    getCredentialsLoginModal(guildId) {
        const modal = module.exports.getModal({
            customId: 'CredentialsLogin',
            title: Client.client.intlGet(guildId, 'credentialsLoginModalTitle')
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SteamAccountName',
                label: Client.client.intlGet(guildId, 'credentialsLoginAccountLabel'),
                style: Discord.TextInputStyle.Short,
                required: true,
                minLength: 1
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SteamPassword',
                label: Client.client.intlGet(guildId, 'credentialsLoginPasswordLabel'),
                style: Discord.TextInputStyle.Short,
                required: true,
                minLength: 1
            }))
        );

        return modal;
    },

    getCredentialsLoginTokenModal(guildId) {
        const modal = module.exports.getModal({
            customId: 'CredentialsLoginToken',
            title: Client.client.intlGet(guildId, 'credentialsLoginTokenModalTitle')
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SteamAuthToken',
                label: Client.client.intlGet(guildId, 'credentialsLoginTokenLabel'),
                style: Discord.TextInputStyle.Paragraph,
                required: true,
                minLength: 20
            }))
        );

        return modal;
    },

    getCredentialsLoginCodeModal(guildId) {
        const modal = module.exports.getModal({
            customId: 'CredentialsLoginCode',
            title: Client.client.intlGet(guildId, 'credentialsLoginCodeModalTitle')
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SteamGuardCode',
                label: Client.client.intlGet(guildId, 'credentialsLoginCodeLabel'),
                style: Discord.TextInputStyle.Short,
                required: true,
                minLength: 1
            }))
        );

        return modal;
    },

    getCustomTimersEditModal(guildId, serverId) {
        const instance = Client.client.getInstance(guildId);
        const server = instance.serverList[serverId];
        const identifier = JSON.stringify({ "serverId": serverId });

        const modal = module.exports.getModal({
            customId: `CustomTimersEdit${identifier}`,
            title: Client.client.intlGet(guildId, 'customTimerEditDesc')
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'CargoShipEgressTime',
                label: Client.client.intlGet(guildId, 'customTimerEditCargoShipEgressLabel'),
                value: `${server.cargoShipEgressTimeMs / 1000}`,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'OilRigCrateUnlockTime',
                label: Client.client.intlGet(guildId, 'customTimerEditCrateOilRigUnlockLabel'),
                value: `${server.oilRigLockedCrateUnlockTimeMs / 1000}`,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'DeepSeaMinWipeCooldownTime',
                label: Client.client.intlGet(guildId, 'customTimerEditDeepSeaMinWipeCooldownLabel'),
                value: `${server.deepSeaMinWipeCooldownMs / 1000}`,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'DeepSeaMaxWipeCooldownTime',
                label: Client.client.intlGet(guildId, 'customTimerEditDeepSeaMaxWipeCooldownLabel'),
                value: `${server.deepSeaMaxWipeCooldownMs / 1000}`,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'DeepSeaWipeDurationTime',
                label: Client.client.intlGet(guildId, 'customTimerEditDeepSeaWipeDurationLabel'),
                value: `${server.deepSeaWipeDurationMs / 1000}`,
                style: Discord.TextInputStyle.Short
            }))
        );

        return modal;
    },

    getSmartSwitchEditModal(guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].switches[entityId];
        const identifier = JSON.stringify({ "serverId": serverId, "entityId": entityId });

        const modal = module.exports.getModal({
            customId: `SmartSwitchEdit${identifier}`,
            title: Client.client.intlGet(guildId, 'editingOf', {
                entity: entity.name.length > 18 ? `${entity.name.slice(0, 18)}..` : entity.name
            })
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SmartSwitchName',
                label: Client.client.intlGet(guildId, 'name'),
                value: entity.name,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SmartSwitchCommand',
                label: Client.client.intlGet(guildId, 'customCommand'),
                value: entity.command,
                style: Discord.TextInputStyle.Short
            }))
        );

        if (entity.autoDayNightOnOff === 5 || entity.autoDayNightOnOff === 6) {
            modal.addComponents(
                new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                    customId: 'SmartSwitchProximity',
                    label: Client.client.intlGet(guildId, 'smartSwitchEditProximityLabel'),
                    value: `${entity.proximity}`,
                    style: Discord.TextInputStyle.Short
                }))
            );
        }

        return modal;
    },

    getGroupEditModal(guildId, serverId, groupId) {
        const instance = Client.client.getInstance(guildId);
        const group = instance.serverList[serverId].switchGroups[groupId];
        const identifier = JSON.stringify({ "serverId": serverId, "groupId": groupId });

        const modal = module.exports.getModal({
            customId: `GroupEdit${identifier}`,
            title: Client.client.intlGet(guildId, 'editingOf', {
                entity: group.name.length > 18 ? `${group.name.slice(0, 18)}..` : group.name
            })
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'GroupName',
                label: Client.client.intlGet(guildId, 'name'),
                value: group.name,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'GroupCommand',
                label: Client.client.intlGet(guildId, 'customCommand'),
                value: group.command,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'GroupAlarmOffAfter',
                label: Client.client.intlGet(guildId, 'groupAlarmOffAfterLabel'),
                value: group.alarmOffAfterSeconds ? Timer.secondsToFullScale(group.alarmOffAfterSeconds) : '',
                placeholder: '5m',
                required: false,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'GroupSchedule',
                label: Client.client.intlGet(guildId, 'groupScheduleLabel'),
                value: SwitchGroupSchedule.format(group.schedule),
                placeholder: 'Europe/Berlin: 22:00-06:00 off, 18:00-22:00 on',
                required: false,
                style: Discord.TextInputStyle.Paragraph
            }))
        );

        return modal;
    },

    getGroupTimerModal(guildId, serverId, groupId) {
        const instance = Client.client.getInstance(guildId);
        const group = instance.serverList[serverId].switchGroups[groupId];
        const identifier = JSON.stringify({ "serverId": serverId, "groupId": groupId });

        const modal = module.exports.getModal({
            customId: `GroupTimer${identifier}`,
            title: Client.client.intlGet(guildId, 'groupTimerTitle', {
                group: group.name.length > 25 ? `${group.name.slice(0, 25)}..` : group.name
            })
        });

        /* On or off is a choice (it was a text field the user had to type "an"/"aus" into). */
        const turnOn = SwitchGroupState.getGroupState(instance.serverList[serverId], group).on === 0;
        modal.addLabelComponents(
            new Discord.LabelBuilder()
                .setLabel(Client.client.intlGet(guildId, 'groupTimerStateChoice'))
                .setStringSelectMenuComponent(new Discord.StringSelectMenuBuilder()
                    .setCustomId('GroupTimerState')
                    .addOptions(
                        { label: Client.client.intlGet(guildId, 'turnOnCap'), value: 'on', default: turnOn },
                        { label: Client.client.intlGet(guildId, 'turnOffCap'), value: 'off', default: !turnOn })),
            new Discord.LabelBuilder()
                .setLabel(Client.client.intlGet(guildId, 'groupTimerDuration'))
                .setTextInputComponent(new Discord.TextInputBuilder()
                    .setCustomId('GroupTimerDuration')
                    .setStyle(Discord.TextInputStyle.Short)
                    .setValue('10m'))
        );

        return modal;
    },

    getSmartAlarmEditModal(guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].alarms[entityId];
        const identifier = JSON.stringify({ "serverId": serverId, "entityId": entityId });

        const modal = module.exports.getModal({
            customId: `SmartAlarmEdit${identifier}`,
            title: Client.client.intlGet(guildId, 'editingOf', {
                entity: entity.name.length > 18 ? `${entity.name.slice(0, 18)}..` : entity.name
            })
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SmartAlarmName',
                label: Client.client.intlGet(guildId, 'name'),
                value: entity.name,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SmartAlarmMessage',
                label: Client.client.intlGet(guildId, 'message'),
                value: entity.message,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'SmartAlarmCommand',
                label: Client.client.intlGet(guildId, 'customCommand'),
                value: entity.command,
                style: Discord.TextInputStyle.Short
            }))
        );

        return modal;
    },

    getStorageMonitorEditModal(guildId, serverId, entityId) {
        const instance = Client.client.getInstance(guildId);
        const entity = instance.serverList[serverId].storageMonitors[entityId];
        const identifier = JSON.stringify({ "serverId": serverId, "entityId": entityId });

        const modal = module.exports.getModal({
            customId: `StorageMonitorEdit${identifier}`,
            title: Client.client.intlGet(guildId, 'editingOf', {
                entity: entity.name.length > 18 ? `${entity.name.slice(0, 18)}..` : entity.name
            })
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'StorageMonitorName',
                label: Client.client.intlGet(guildId, 'name'),
                value: entity.name,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'StorageMonitorAlerts',
                label: Client.client.intlGet(guildId, 'storageMonitorAlertsLabel'),
                value: StorageAlerts.format(Client.client.items, entity.alerts),
                placeholder: 'Rifle Ammo < 100, Low Grade Fuel < 50, Sulfur > 10k',
                required: false,
                style: Discord.TextInputStyle.Paragraph
            }))
        );

        return modal;
    },

    getTrackerEditModal(guildId, trackerId) {
        const instance = Client.client.getInstance(guildId);
        const tracker = instance.trackers[trackerId];
        const identifier = JSON.stringify({ "trackerId": trackerId });

        const modal = module.exports.getModal({
            customId: `TrackerEdit${identifier}`,
            title: Client.client.intlGet(guildId, 'editingOf', {
                entity: tracker.name.length > 18 ? `${tracker.name.slice(0, 18)}..` : tracker.name
            })
        });

        modal.addComponents(
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'TrackerName',
                label: Client.client.intlGet(guildId, 'name'),
                value: tracker.name,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'TrackerBattlemetricsId',
                label: Client.client.intlGet(guildId, 'battlemetricsId'),
                value: tracker.battlemetricsId,
                style: Discord.TextInputStyle.Short
            })),
            new Discord.ActionRowBuilder().addComponents(TextInput.getTextInput({
                customId: 'TrackerClanTag',
                label: Client.client.intlGet(guildId, 'clanTag'),
                value: tracker.clanTag,
                style: Discord.TextInputStyle.Short,
                required: false,
                minLength: 0
            }))
        );

        return modal;
    },

    getTrackerAddPlayerModal(guildId, trackerId, sinceWipe = null) {
        const instance = Client.client.getInstance(guildId);
        const tracker = instance.trackers[trackerId];
        const identifier = JSON.stringify({ "trackerId": trackerId });

        const modal = module.exports.getModal({
            customId: `TrackerAddPlayer${identifier}`,
            title: Client.client.intlGet(guildId, 'trackerAddPlayerDesc', { tracker: tracker.name })
        });

        /*
            Players on the tracker's server to pick from, each choice sorted by name, without the players already in
            the tracker. Online: as Battlemetrics sees them now. Offline: played since the last wipe (sinceWipe, most
            time first), or without that list the players seen since the bot started. A form holds 5 fields and a
            choice 25 players: offline are the 25 with the most time, online get the remaining fields (25 each, A-Z).
        */
        const bmInstance = Client.client.battlemetricsInstances[tracker.battlemetricsId];
        const tracked = new Set(tracker.players.map(e => e.playerId).filter(e => e));
        const sinceWipeNames = new Map((sinceWipe || []).map(e => [`${e.id}`, e.name]));
        const playerName = (id) => {
            const name = bmInstance.players[id] ? bmInstance.players[id]['name'] : sinceWipeNames.get(`${id}`);
            return typeof name === 'string' && name.trim() !== '' ? name : '-';
        };
        const byName = (a, b) => playerName(a).localeCompare(playerName(b), undefined, { sensitivity: 'base' });
        const onlineAll = bmInstance ? bmInstance.onlinePlayers.map(e => `${e}`) : [];
        const online = onlineAll.filter(e => !tracked.has(e)).sort(byName);
        const offlineSource = !bmInstance ? [] : sinceWipe ? sinceWipe.map(e => `${e.id}`) :
            bmInstance.getOfflinePlayerIdsOrderedByLeastTimeSinceOnline();
        const offline = offlineSource.filter(e => !tracked.has(e) && !onlineAll.includes(e)).slice(0, 25).sort(byName);

        const playerChoice = (customId, label, ids) => new Discord.LabelBuilder()
            .setLabel(label.slice(0, 45))
            .setStringSelectMenuComponent(new Discord.StringSelectMenuBuilder()
                .setCustomId(customId)
                .setRequired(false)
                .setMinValues(0)
                .setMaxValues(ids.length)
                .addOptions(ids.map(id => ({ label: playerName(id).slice(0, 100), value: `${id}` }))));

        const labels = [];
        const onlineChunks = [];
        const onlineFields = 4 - (offline.length !== 0 ? 1 : 0);
        for (let i = 0; i < online.length && onlineChunks.length < onlineFields; i += 25) {
            onlineChunks.push(online.slice(i, i + 25));
        }
        onlineChunks.forEach((ids, i) => {
            const range = onlineChunks.length > 1 ?
                ` (${playerName(ids[0]).charAt(0).toUpperCase()}-` +
                `${playerName(ids[ids.length - 1]).charAt(0).toUpperCase()})` : '';
            labels.push(playerChoice(`TrackerAddPlayerOnline${i}`,
                `${Client.client.intlGet(guildId, 'trackerAddPlayerOnline')}${range}`, ids));
        });
        if (offline.length !== 0) {
            labels.push(playerChoice('TrackerAddPlayerOffline',
                Client.client.intlGet(guildId, 'trackerAddPlayerOffline'), offline));
        }

        labels.push(new Discord.LabelBuilder()
            .setLabel((`${Client.client.intlGet(guildId, 'steamId')} / ` +
                `${Client.client.intlGet(guildId, 'battlemetricsId')}`).slice(0, 45))
            .setTextInputComponent(new Discord.TextInputBuilder()
                .setCustomId('TrackerAddPlayerId')
                .setStyle(Discord.TextInputStyle.Short)
                .setRequired(labels.length === 0)));

        modal.addLabelComponents(...labels);

        return modal;
    },

    getTrackerRemovePlayerModal(guildId, trackerId) {
        const instance = Client.client.getInstance(guildId);
        const tracker = instance.trackers[trackerId];
        const identifier = JSON.stringify({ "trackerId": trackerId });

        const modal = module.exports.getModal({
            customId: `TrackerRemovePlayer${identifier}`,
            title: Client.client.intlGet(guildId, 'trackerRemovePlayerDesc', { tracker: tracker.name })
        });

        /*
            The players in the tracker to pick from, sorted by name, 25 per choice (up to 4 choices, the 5th field is
            the SteamID / Battlemetrics ID). The value says which id the player is removed by (see trackerPlayerKey).
        */
        const playerName = (player) =>
            typeof player.name === 'string' && player.name.trim() !== '' ? player.name : '-';
        const players = tracker.players.slice().sort((a, b) =>
            playerName(a).localeCompare(playerName(b), undefined, { sensitivity: 'base' }));
        const keys = new Set();
        const options = [];
        for (const player of players) {
            const key = module.exports.trackerPlayerKey(player);
            if (keys.has(key)) continue;
            keys.add(key);
            const description = [player.steamId ? `Steam ${player.steamId}` : null,
                player.playerId ? `BM ${player.playerId}` : null].filter(e => e).join(' / ');
            options.push({ label: playerName(player).slice(0, 100), value: key.slice(0, 100),
                ...(description !== '' ? { description: description.slice(0, 100) } : {}) });
        }

        const labels = [];
        const chunks = [];
        for (let i = 0; i < options.length && chunks.length < 4; i += 25) chunks.push(options.slice(i, i + 25));
        chunks.forEach((chunk, i) => {
            const range = chunks.length > 1 ? ` (${chunk[0].label.charAt(0).toUpperCase()}-` +
                `${chunk[chunk.length - 1].label.charAt(0).toUpperCase()})` : '';
            labels.push(new Discord.LabelBuilder()
                .setLabel(`${Client.client.intlGet(guildId, 'trackerRemovePlayerChoice')}${range}`.slice(0, 45))
                .setStringSelectMenuComponent(new Discord.StringSelectMenuBuilder()
                    .setCustomId(`TrackerRemovePlayerPick${i}`)
                    .setRequired(false)
                    .setMinValues(0)
                    .setMaxValues(chunk.length)
                    .addOptions(chunk)));
        });

        labels.push(new Discord.LabelBuilder()
            .setLabel((`${Client.client.intlGet(guildId, 'steamId')} / ` +
                `${Client.client.intlGet(guildId, 'battlemetricsId')}`).slice(0, 45))
            .setTextInputComponent(new Discord.TextInputBuilder()
                .setCustomId('TrackerRemovePlayerId')
                .setStyle(Discord.TextInputStyle.Short)
                .setRequired(labels.length === 0)));

        modal.addLabelComponents(...labels);

        return modal;
    },

    /* Which id a tracker player is picked by in the remove form: SteamID, else Battlemetrics id, else the name. */
    trackerPlayerKey(player) {
        if (player.steamId) return `s:${player.steamId}`;
        if (player.playerId) return `b:${player.playerId}`;
        return `n:${player.name}`;
    },
}
