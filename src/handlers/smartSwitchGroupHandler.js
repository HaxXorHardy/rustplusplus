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

const DiscordMessages = require('../discordTools/discordMessages.js');
const SwitchGroupSchedule = require('../util/switchGroupSchedule.js');
const SwitchGroupState = require('../util/switchGroupState.js');
const SwitchTimeouts = require('../util/switchTimeouts.js');
const Timer = require('../util/timer');

/* At most this many switches of a group are switched at the same time (the requests share the token bucket). */
const SWITCH_CONCURRENCY = 4;

/* A switch that did not answer is tried once more after this pause. */
const RETRY_DELAY_MS = 2000;

/* `${guildId}:${serverId}:${groupId}:${schedule}` -> inside/outside of each window at the last check */
const scheduleStates = new Map();

/* group.autoDayNight */
const { AUTO_OFF, AUTO_DAY, AUTO_NIGHT } = SwitchGroupState;

module.exports = {
    SWITCH_CONCURRENCY: SWITCH_CONCURRENCY,
    RETRY_DELAY_MS: RETRY_DELAY_MS,
    AUTO_OFF: AUTO_OFF,
    AUTO_DAY: AUTO_DAY,
    AUTO_NIGHT: AUTO_NIGHT,

    /*
        Day/night automation of the groups (group.autoDayNight): 1 = on during the day, off at night, 2 = on at
        night, off during the day. Runs every poll, acts only when the in-game time just turned.
    */
    handler: async function (rustplus, client, time) {
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;
        const instance = client.getInstance(guildId);
        const server = instance.serverList[serverId];
        if (!server || !server.switchGroups) return;

        await module.exports.runSchedules(client, rustplus, server);

        if (!rustplus.time) return;

        let turned = null;
        if (rustplus.time.isTurnedDay(time)) turned = 'day';
        else if (rustplus.time.isTurnedNight(time)) turned = 'night';
        if (turned === null) return;

        for (const [groupId, group] of Object.entries(server.switchGroups)) {
            const mode = module.exports.getAutoDayNight(group);
            if (mode === AUTO_OFF) continue;

            const active = (mode === AUTO_DAY) === (turned === 'day');
            rustplus.log(client.intlGet(null, 'infoCap'),
                `Switch group ${groupId} (${group.name}) is turned ${active ? 'on' : 'off'}, it became ${turned}.`);

            await module.exports.setGroup(client, rustplus, guildId, serverId, groupId, active);
        }
    },

    /* Real-time schedules (group.schedule, util/switchGroupSchedule.js): act on the begin and end of a window. */
    runSchedules: async function (client, rustplus, server, date = new Date()) {
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;

        for (const [groupId, group] of Object.entries(server.switchGroups)) {
            if (!group.schedule) continue;

            const key = `${guildId}:${serverId}:${groupId}:${JSON.stringify(group.schedule)}`;
            if (!scheduleStates.has(key)) scheduleStates.set(key, {});

            for (const change of SwitchGroupSchedule.transitions(group.schedule, scheduleStates.get(key), date)) {
                rustplus.log(client.intlGet(null, 'infoCap'),
                    `Switch group ${groupId} (${group.name}) is turned ${change.value ? 'on' : 'off'} by its schedule.`);

                await module.exports.setGroup(client, rustplus, guildId, serverId, groupId, change.value);
            }
        }
    },

    getAutoDayNight: SwitchGroupState.getAutoDayNight,
    getTriggerAlarms: SwitchGroupState.getTriggerAlarms,
    getAlarmOffAfterSeconds: SwitchGroupState.getAlarmOffAfterSeconds,
    getGroupState: SwitchGroupState.getGroupState,

    /* Cancel a running "on/off for X" of the group. */
    cancelGroupTimer: function (rustplus, groupId) {
        SwitchTimeouts.cancel(rustplus.guildId, rustplus.serverId, SwitchTimeouts.groupKey(groupId));
    },

    /*
        Turn the group on or off - from the in-game command, the Discord buttons, the timer, the day/night
        automation and the alarm trigger alike. A running timer of the group is cancelled.

        options.seconds: switch back after this long (a timer, shown in the group message),
        options.inGame: announce it in the team chat and name switches that did not answer,
        options.deps: passed to TurnOnOffGroup (tests).
    */
    setGroup: async function (client, rustplus, guildId, serverId, groupId, active, options = {}) {
        const onCap = client.intlGet(guildId, 'onCap');
        const offCap = client.intlGet(guildId, 'offCap');
        const group = client.getInstance(guildId).serverList[serverId].switchGroups[groupId];

        module.exports.cancelGroupTimer(rustplus, groupId);

        const turnAndReport = async (rustplus, value) => {
            const result = await module.exports.TurnOnOffGroup(client, rustplus, guildId, serverId, groupId, value,
                options.deps);

            /* The timer line of the group message changes even when no switch had to change. */
            if (result.switched.length === 0 && result.failed.length === 0) {
                await DiscordMessages.sendSmartSwitchGroupMessage(guildId, serverId, groupId);
            }

            if (!options.inGame || result.failed.length === 0) return result;

            /* The switches that did not answer are named in game as well, in one line. */
            const switches = client.getInstance(guildId).serverList[serverId].switches;
            rustplus.sendInGameMessage(client.intlGet(guildId, 'noCommunicationSmartSwitch', {
                name: result.failed.map((entityId) => switches[entityId] ? switches[entityId].name : entityId)
                    .join(', ')
            }));

            return result;
        };

        const seconds = options.seconds ? options.seconds : null;

        if (options.inGame) {
            let str = client.intlGet(guildId, 'turningGroupOnOff', { group: group.name, status: active ? onCap : offCap });
            if (seconds !== null) {
                str += client.intlGet(guildId, 'automaticallyTurnBackOnOff', {
                    status: active ? offCap : onCap,
                    time: Timer.secondsToFullScale(seconds)
                });
            }
            rustplus.sendInGameMessage(str);
        }

        if (seconds !== null) {
            const record = { kind: 'group', id: `${groupId}`, value: !active, inGame: Boolean(options.inGame) };
            SwitchTimeouts.schedule(guildId, serverId, SwitchTimeouts.groupKey(groupId), seconds * 1000, record,
                async function () {
                const instance = client.getInstance(guildId);
                if (!instance.serverList.hasOwnProperty(serverId) ||
                    !instance.serverList[serverId].switchGroups.hasOwnProperty(groupId)) {
                    return;
                }

                /* The connection may have been rebuilt since the timer started: the current one switches. */
                const rustplus = SwitchTimeouts.currentInstance(client, guildId, serverId);
                if (rustplus === null) return;

                if (options.inGame) {
                    rustplus.sendInGameMessage(client.intlGet(guildId, 'automaticallyTurningBackOnOff', {
                        device: instance.serverList[serverId].switchGroups[groupId].name,
                        status: !active ? onCap : offCap
                    }));
                }

                try {
                    await turnAndReport(rustplus, !active);
                }
                catch (e) {
                    client.log(client.intlGet(null, 'warningCap'),
                        `The timer of switch group ${groupId} could not switch it back: ${e && e.message ? e.message : e}`,
                        'warn');
                }
            });
        }

        return await turnAndReport(rustplus, active);
    },

    /* Turn everything off when anything is on, otherwise turn it on. */
    toggleGroup: async function (client, rustplus, guildId, serverId, groupId, options = {}) {
        const server = client.getInstance(guildId).serverList[serverId];
        const state = module.exports.getGroupState(server, server.switchGroups[groupId]);

        return await module.exports.setGroup(client, rustplus, guildId, serverId, groupId, state.on === 0, options);
    },

    /* A smart alarm of the connected server went off: the groups it is a trigger of are turned on. */
    onAlarmTriggered: async function (client, rustplus, alarmId) {
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;
        const instance = client.getInstance(guildId);
        const server = instance.serverList[serverId];
        if (!server || !server.switchGroups || !server.alarms || !server.alarms[`${alarmId}`]) return;

        const alarmName = server.alarms[`${alarmId}`].name;

        for (const [groupId, group] of Object.entries(server.switchGroups)) {
            if (!module.exports.getTriggerAlarms(server, group).includes(`${alarmId}`)) continue;

            const seconds = module.exports.getAlarmOffAfterSeconds(group);
            rustplus.log(client.intlGet(null, 'infoCap'),
                `Switch group ${groupId} (${group.name}) is turned on by the alarm ${alarmName}` +
                `${seconds !== 0 ? `, off again in ${seconds} s` : ''}.`);

            if (instance.generalSettings.smartAlarmNotifyInGame) {
                rustplus.sendInGameMessage(client.intlGet(guildId, 'groupTurnedOnByAlarm', {
                    group: group.name,
                    alarm: alarmName
                }));
            }

            await module.exports.setGroup(client, rustplus, guildId, serverId, groupId, true,
                { seconds: seconds !== 0 ? seconds : null });
        }
    },

    updateSwitchGroupIfContainSwitch: async function (client, guildId, serverId, switchId) {
        const instance = client.getInstance(guildId);

        for (const [groupId, content] of Object.entries(instance.serverList[serverId].switchGroups)) {
            if (content.switches.includes(`${switchId}`)) {
                await DiscordMessages.sendSmartSwitchGroupMessage(guildId, serverId, groupId);
            }
        }

    },

    getGroupsFromSwitchList: function (client, guildId, serverId, switches) {
        const instance = client.getInstance(guildId);

        let groupsId = [];
        for (let entity of switches) {
            for (const [groupId, content] of Object.entries(instance.serverList[serverId].switchGroups)) {
                if (content.switches.includes(entity) && !groupsId.includes(groupId)) {
                    groupsId.push(groupId);
                }
            }
        }

        return groupsId;
    },

    /*
        Switch every switch of the group that is not in the wanted state yet. Up to SWITCH_CONCURRENCY at a time (a
        group of ten took ten round trips one after another), a switch that does not answer gets one more try after
        RETRY_DELAY_MS, and the switches that stay unreachable are reported in one message, not one per switch.
        Returns { switched: [entityId], failed: [entityId] }. deps.retryDelayMs for tests.
    */
    TurnOnOffGroup: async function (client, rustplus, guildId, serverId, groupId, value, deps = {}) {
        const instance = client.getInstance(guildId);
        const server = instance.serverList[serverId];
        const switches = server.switchGroups[groupId].switches;
        const retryDelayMs = (deps.retryDelayMs !== undefined) ? deps.retryDelayMs : RETRY_DELAY_MS;

        const actionSwitches = [];
        for (const [entityId, content] of Object.entries(server.switches)) {
            if (!switches.includes(entityId)) continue;

            /* A running "on/off for X minutes" of a single switch is overruled by the group. */
            if (rustplus.currentSwitchTimeouts.hasOwnProperty(entityId)) {
                SwitchTimeouts.cancel(guildId, serverId, entityId);
            }

            if (Boolean(content.active) !== Boolean(value)) actionSwitches.push(entityId);
        }

        const switched = [];
        const failed = [];
        const newlyUnreachable = [];

        const turn = async (entityId) => {
            const entity = server.switches[entityId];
            const prevActive = entity.active;
            const wasReachable = entity.reachable;

            entity.active = value;
            rustplus.interactionSwitches.push(entityId);

            let ok = await rustplus.isResponseValid(await rustplus.turnSmartSwitchAsync(entityId, value));
            if (!ok) {
                /* A short hiccup of the relay is no destroyed switch. */
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                ok = await rustplus.isResponseValid(await rustplus.turnSmartSwitchAsync(entityId, value));
            }

            if (ok) {
                entity.reachable = true;
                switched.push(entityId);
            }
            else {
                entity.reachable = false;
                entity.active = prevActive;
                rustplus.interactionSwitches = rustplus.interactionSwitches.filter(e => e !== entityId);
                failed.push(entityId);
                if (wasReachable) newlyUnreachable.push(entityId);
            }

            client.setInstance(guildId, instance);
            DiscordMessages.sendSmartSwitchMessage(guildId, serverId, entityId);
        };

        const queue = actionSwitches.slice();
        const workers = [];
        for (let i = 0; i < Math.min(SWITCH_CONCURRENCY, queue.length); i++) {
            workers.push((async () => {
                while (queue.length !== 0) {
                    const entityId = queue.shift();
                    try {
                        await turn(entityId);
                    }
                    catch (e) {
                        failed.push(entityId);
                        client.log(client.intlGet(null, 'warningCap'),
                            `Switch ${entityId} of group ${groupId} could not be switched: ${e && e.message ? e.message : e}`,
                            'warn');
                    }
                }
            })());
        }
        await Promise.all(workers);

        if (actionSwitches.length !== 0) {
            client.log(client.intlGet(null, 'infoCap'),
                `Switch group ${groupId} turned ${value ? 'on' : 'off'}: ${switched.length}/${actionSwitches.length} ` +
                `switched${failed.length !== 0 ? `, not reachable: ${failed.join(', ')}` : ''}.`);
        }

        if (newlyUnreachable.length !== 0) {
            await DiscordMessages.sendSmartSwitchesNotFoundMessage(guildId, serverId, newlyUnreachable);
        }

        if (actionSwitches.length !== 0) {
            await DiscordMessages.sendSmartSwitchGroupMessage(guildId, serverId, groupId);
        }

        return { switched: switched, failed: failed };
    },

    smartSwitchGroupCommandHandler: async function (rustplus, client, command) {
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;
        const instance = client.getInstance(guildId);
        const switchGroups = instance.serverList[serverId].switchGroups;
        const prefix = rustplus.generalSettings.prefix;

        const onCap = client.intlGet(rustplus.guildId, 'onCap');
        const offCap = client.intlGet(rustplus.guildId, 'offCap');
        const notFoundCap = client.intlGet(rustplus.guildId, 'notFoundCap');

        const onEn = client.intlGet('en', 'commandSyntaxOn');
        const onLang = client.intlGet(guildId, 'commandSyntaxOn');
        const offEn = client.intlGet('en', 'commandSyntaxOff');
        const offLang = client.intlGet(guildId, 'commandSyntaxOff');
        const statusEn = client.intlGet('en', 'commandSyntaxStatus');
        const statusLang = client.intlGet(guildId, 'commandSyntaxStatus');

        const groupId = Object.keys(switchGroups).find(e =>
            command === `${prefix}${switchGroups[e].command}` ||
            command.startsWith(`${prefix}${switchGroups[e].command} `));

        if (!groupId) return false;

        const groupCommand = `${prefix}${switchGroups[groupId].command}`;
        let rest = command.replace(`${groupCommand} ${onEn}`, '');
        rest = rest.replace(`${groupCommand} ${onLang}`, '');
        rest = rest.replace(`${groupCommand} ${offEn}`, '');
        rest = rest.replace(`${groupCommand} ${offLang}`, '');
        rest = rest.replace(`${groupCommand}`, '').trim();

        let active;
        if (command.startsWith(`${groupCommand} ${onEn}`) || command.startsWith(`${groupCommand} ${onLang}`)) {
            active = true;
        }
        else if (command.startsWith(`${groupCommand} ${offEn}`) || command.startsWith(`${groupCommand} ${offLang}`)) {
            active = false;
        }
        else if (command === `${groupCommand} ${statusEn}` || command === `${groupCommand} ${statusLang}`) {
            const switchStatus = switchGroups[groupId].switches.map(switchId => {
                const { active, name, reachable } = instance.serverList[serverId].switches[switchId];
                return { active, name, reachable }
            });
            const statusMessage = switchStatus.map(status =>
                `${status.name}: ${status.reachable ? (status.active ? onCap : offCap) : notFoundCap}`).join(', ');
            rustplus.sendInGameMessage(`${client.intlGet(guildId, 'status')}: ${statusMessage}`);
            return true;
        }
        else {
            return true;
        }

        const timeSeconds = Timer.getSecondsFromStringTime(rest);

        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, `logSmartSwitchGroupValueChange`, {
            value: active
        }));

        await module.exports.setGroup(client, rustplus, guildId, serverId, groupId, active,
            { seconds: timeSeconds, inGame: true });
        return true;
    },
}