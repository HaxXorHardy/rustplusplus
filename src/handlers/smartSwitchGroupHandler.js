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
const SwitchTimeouts = require('../util/switchTimeouts.js');
const Timer = require('../util/timer');

/* At most this many switches of a group are switched at the same time (the requests share the token bucket). */
const SWITCH_CONCURRENCY = 4;

/* A switch that did not answer is tried once more after this pause. */
const RETRY_DELAY_MS = 2000;

module.exports = {
    SWITCH_CONCURRENCY: SWITCH_CONCURRENCY,
    RETRY_DELAY_MS: RETRY_DELAY_MS,

    handler: async function (rustplus, client) {
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
                clearTimeout(rustplus.currentSwitchTimeouts[entityId]);
                delete rustplus.currentSwitchTimeouts[entityId];
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

        if (rustplus.currentSwitchTimeouts.hasOwnProperty(groupId)) {
            clearTimeout(rustplus.currentSwitchTimeouts[groupId]);
            delete rustplus.currentSwitchTimeouts[groupId];
        }

        const timeSeconds = Timer.getSecondsFromStringTime(rest);

        let str = client.intlGet(guildId, 'turningGroupOnOff', {
            group: switchGroups[groupId].name,
            status: active ? onCap : offCap
        });

        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, `logSmartSwitchGroupValueChange`, {
            value: active
        }));

        /* The switches that did not answer are named in game as well, in one line. */
        const turnAndReport = async (rustplus, value) => {
            const result = await module.exports.TurnOnOffGroup(client, rustplus, guildId, serverId, groupId, value);
            if (result.failed.length === 0) return;

            const switches = client.getInstance(guildId).serverList[serverId].switches;
            rustplus.sendInGameMessage(client.intlGet(guildId, 'noCommunicationSmartSwitch', {
                name: result.failed.map((entityId) => switches[entityId] ? switches[entityId].name : entityId)
                    .join(', ')
            }));
        };

        if (timeSeconds === null) {
            rustplus.sendInGameMessage(str);
            await turnAndReport(rustplus, active);
            return true;
        }

        const time = Timer.secondsToFullScale(timeSeconds);
        str += client.intlGet(guildId, 'automaticallyTurnBackOnOff', {
            status: active ? offCap : onCap,
            time: time
        });

        const timeouts = rustplus.currentSwitchTimeouts;
        timeouts[groupId] = setTimeout(async function () {
            delete timeouts[groupId];

            const instance = client.getInstance(guildId);
            if (!instance.serverList.hasOwnProperty(serverId) ||
                !instance.serverList[serverId].switchGroups.hasOwnProperty(groupId)) {
                return;
            }

            /* The connection may have been rebuilt since the timer started: the current one switches. */
            const rustplus = SwitchTimeouts.currentInstance(client, guildId, serverId);
            if (rustplus === null) return;

            const str = client.intlGet(guildId, 'automaticallyTurningBackOnOff', {
                device: instance.serverList[serverId].switchGroups[groupId].name,
                status: !active ? onCap : offCap
            });
            rustplus.sendInGameMessage(str);

            await turnAndReport(rustplus, !active);
        }, timeSeconds * 1000);

        rustplus.sendInGameMessage(str);
        await turnAndReport(rustplus, active);
        return true;
    },
}