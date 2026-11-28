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
const Map = require('../util/map.js');
const SmartSwitchGroupHandler = require('./smartSwitchGroupHandler.js');
const Timer = require('../util/timer');
const SwitchTimeouts = require('../util/switchTimeouts.js');
const UnreachableDevices = require('../util/unreachableDevices.js');

/* A switch-back of a timer that did not answer is tried again after these pauses, then given up. */
const SWITCH_BACK_RETRY_DELAYS_MS = [15 * 1000, 30 * 1000, 60 * 1000, 120 * 1000];

/*
    Switch one switch for its automation (day/night, auto on/off, proximity, online). A switch that did not answer keeps
    its previous state, so the automation tries again (the level-triggered modes on the next poll) instead of showing
    a state the switch is not in. A switch deleted in the meantime is left alone.
*/
async function autoTurn(rustplus, client, entityId, active, changedSwitches) {
    const guildId = rustplus.guildId;
    const serverId = rustplus.serverId;
    const switchOf = () => {
        const server = client.getInstance(guildId).serverList[serverId];
        return server && server.switches ? server.switches[entityId] : undefined;
    };

    let entity = switchOf();
    if (!entity) return;

    const prevActive = entity.active;
    entity.active = active;
    client.setInstance(guildId, client.getInstance(guildId));

    rustplus.interactionSwitches.push(entityId);

    const response = await rustplus.turnSmartSwitchAsync(entityId, active);
    const switched = await rustplus.isResponseValid(response);

    entity = switchOf();
    if (!entity) {
        rustplus.interactionSwitches = rustplus.interactionSwitches.filter(e => e !== entityId);
        return;
    }

    if (!switched) {
        /* Only not_found means the switch is gone, a timeout or a closed socket says nothing about it. */
        if (UnreachableDevices.isNotFound(response)) {
            if (entity.reachable) {
                await DiscordMessages.sendSmartSwitchNotFoundMessage(guildId, serverId, entityId);
                entity = switchOf();
                if (!entity) return;
            }
            entity.reachable = false;
        }
        entity.active = prevActive;

        rustplus.interactionSwitches = rustplus.interactionSwitches.filter(e => e !== entityId);
    }
    else {
        entity.reachable = true;
    }
    client.setInstance(guildId, client.getInstance(guildId));

    DiscordMessages.sendSmartSwitchMessage(guildId, serverId, entityId).catch(() => undefined);
    changedSwitches.push(entityId);
}

module.exports = {
    handler: async function (rustplus, client, time) {
        const instance = client.getInstance(rustplus.guildId);
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;

        if (!instance.serverList.hasOwnProperty(serverId)) return;

        if (rustplus.smartSwitchIntervalCounter === 29) {
            rustplus.smartSwitchIntervalCounter = 0;
        }
        else {
            rustplus.smartSwitchIntervalCounter += 1;
        }

        /* The switch may be deleted while a request or a Discord call is awaited. */
        const switchOf = (entityId) => {
            const server = client.getInstance(guildId).serverList[serverId];
            return server && server.switches ? server.switches[entityId] : undefined;
        };

        /* Go through all Smart Switches and see if some of them do not answer on request. */
        const changedSwitches = [];
        if (rustplus.smartSwitchIntervalCounter === 0) {
            for (const entityId in instance.serverList[serverId].switches) {
                /* A device the server does not know anymore is asked once an hour instead of on every round. */
                if (UnreachableDevices.isUnreachable(rustplus, entityId)) continue;

                const info = await rustplus.getEntityInfoAsync(entityId);
                const answered = await rustplus.isResponseValid(info, { expectNotFound: true });
                if (!switchOf(entityId)) continue;

                /* No answer is no not_found: the switch is asked again on the next round. */
                if (!answered && !UnreachableDevices.isNotFound(info)) continue;

                if (!answered) {
                    UnreachableDevices.markUnreachable(rustplus, entityId);

                    if (switchOf(entityId).reachable) {
                        await DiscordMessages.sendSmartSwitchNotFoundMessage(guildId, serverId, entityId);
                        if (!switchOf(entityId)) continue;

                        switchOf(entityId).reachable = false;
                        client.setInstance(guildId, client.getInstance(guildId));

                        DiscordMessages.sendSmartSwitchMessage(guildId, serverId, entityId).catch(() => undefined);
                        changedSwitches.push(entityId);
                    }
                }
                else {
                    UnreachableDevices.markReachable(rustplus, entityId);

                    if (!switchOf(entityId).reachable) {
                        switchOf(entityId).reachable = true;
                        client.setInstance(guildId, client.getInstance(guildId));

                        DiscordMessages.sendSmartSwitchMessage(guildId, serverId, entityId).catch(() => undefined);
                        changedSwitches.push(entityId);
                    }
                }
            }
        }

        /*
            Go through all Smart Switches and see if the auto day/night setting is on and if it became day/night. The
            turn counts as applied only after the round went through: a round that was skipped (the previous one still
            running) or that failed is done on the next poll instead of waiting for the next turn.
        */
        const turned = rustplus.time.pendingDayNightTurn('switches', time);
        if (turned !== null) {
            for (const [entityId, content] of Object.entries(instance.serverList[serverId].switches)) {
                let active = null;
                if (content.autoDayNightOnOff === 1) active = (turned === 'day');       /* AUTO-DAY */
                else if (content.autoDayNightOnOff === 2) active = (turned === 'night'); /* AUTO-NIGHT */
                if (active === null) continue;

                try {
                    await autoTurn(rustplus, client, entityId, active, changedSwitches);
                }
                catch (e) {
                    rustplus.log(client.intlGet(null, 'warningCap'),
                        `Switch ${entityId} could not be switched at ${turned}: ${e && e.message ? e.message : e}`,
                        'warn');
                }
            }

            rustplus.time.markDayNightApplied('switches', turned);
        }

        for (const [entityId, content] of Object.entries(instance.serverList[serverId].switches)) {
            if (content.autoDayNightOnOff === 3) { /* AUTO-ON */
                if (content.active) continue;

                await autoTurn(rustplus, client, entityId, true, changedSwitches);
            }
            else if (content.autoDayNightOnOff === 4) { /* AUTO-OFF */
                if (!content.active) continue;

                await autoTurn(rustplus, client, entityId, false, changedSwitches);
            }
            else if (content.autoDayNightOnOff === 5 && content.location !== null) { /* AUTO-ON-PROXIMITY */
                let shouldBeOn = false;
                for (const player of rustplus.team.players) {
                    if (Map.getDistance(content.x, content.y, player.x, player.y) <= content.proximity) {
                        shouldBeOn = true;
                    }
                }

                if ((shouldBeOn && !content.active) || (!shouldBeOn && content.active)) {
                    await autoTurn(rustplus, client, entityId, shouldBeOn, changedSwitches);
                }
            }
            else if (content.autoDayNightOnOff === 6 && content.location !== null) { /* AUTO-OFF-PROXIMITY */
                let shouldBeOn = true;
                for (const player of rustplus.team.players) {
                    if (Map.getDistance(content.x, content.y, player.x, player.y) <= content.proximity) {
                        shouldBeOn = false;
                    }
                }

                if ((shouldBeOn && !content.active) || (!shouldBeOn && content.active)) {
                    await autoTurn(rustplus, client, entityId, shouldBeOn, changedSwitches);
                }
            }
            else if (content.autoDayNightOnOff === 7) { /* AUTO-ON-ANY-ONLINE */
                let shouldBeOn = false;
                for (const player of rustplus.team.players) {
                    if (player.isOnline) shouldBeOn = true;
                }

                if ((shouldBeOn && !content.active) || (!shouldBeOn && content.active)) {
                    await autoTurn(rustplus, client, entityId, shouldBeOn, changedSwitches);
                }
            }
            else if (content.autoDayNightOnOff === 8) { /* AUTO-OFF-ANY-ONLINE */
                let shouldBeOn = true;
                for (const player of rustplus.team.players) {
                    if (player.isOnline) shouldBeOn = false;
                }

                if ((shouldBeOn && !content.active) || (!shouldBeOn && content.active)) {
                    await autoTurn(rustplus, client, entityId, shouldBeOn, changedSwitches);
                }
            }
        }

        let groupsId = SmartSwitchGroupHandler.getGroupsFromSwitchList(
            client, guildId, serverId, changedSwitches);

        for (let groupId of groupsId) {
            DiscordMessages.sendSmartSwitchGroupMessage(guildId, serverId, groupId).catch(() => undefined);
        }
    },

    smartSwitchCommandHandler: async function (rustplus, client, chatCommand) {
        /*
            In-game commands match without regard to case, like the built-in ones: "!lamp OFF" used to miss "off" and
            fall through to the toggle, which turned an OFF lamp ON.
        */
        const command = `${chatCommand}`.toLowerCase();
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;
        const instance = client.getInstance(guildId);
        const switches = instance.serverList[serverId].switches;
        const prefix = rustplus.generalSettings.prefix;

        const onCap = client.intlGet(guildId, 'onCap');
        const offCap = client.intlGet(guildId, 'offCap');

        const onEn = client.intlGet('en', 'commandSyntaxOn').toLowerCase();
        const onLang = client.intlGet(guildId, 'commandSyntaxOn').toLowerCase();
        const offEn = client.intlGet('en', 'commandSyntaxOff').toLowerCase();
        const offLang = client.intlGet(guildId, 'commandSyntaxOff').toLowerCase();
        const statusEn = client.intlGet('en', 'commandSyntaxStatus').toLowerCase();
        const statusLang = client.intlGet(guildId, 'commandSyntaxStatus').toLowerCase();

        const entityCommandOf = (e) => `${prefix}${switches[e].command}`.toLowerCase();
        const entityId = Object.keys(switches).find(e =>
            command === entityCommandOf(e) || command.startsWith(`${entityCommandOf(e)} `));

        if (!entityId) return false;

        const entityCommand = entityCommandOf(entityId);
        let rest = command.replace(`${entityCommand} ${onEn}`, '');
        rest = rest.replace(`${entityCommand} ${onLang}`, '');
        rest = rest.replace(`${entityCommand} ${offEn}`, '');
        rest = rest.replace(`${entityCommand} ${offLang}`, '');
        rest = rest.replace(`${entityCommand}`, '').trim();

        let active;
        if (command.startsWith(`${entityCommand} ${onEn}`) || command.startsWith(`${entityCommand} ${onLang}`)) {
            if (!switches[entityId].active) {
                active = true;
            }
            else {
                const str = client.intlGet(guildId, 'deviceIsAlreadyOnOff', {
                    device: switches[entityId].name,
                    status: onCap
                });
                rustplus.sendInGameMessage(str);
                return true;
            }
        }
        else if (command.startsWith(`${entityCommand} ${offEn}`) || command.startsWith(`${entityCommand} ${offLang}`)) {
            if (switches[entityId].active) {
                active = false;
            }
            else {
                const str = client.intlGet(guildId, 'deviceIsAlreadyOnOff', {
                    device: switches[entityId].name,
                    status: offCap
                });
                rustplus.sendInGameMessage(str);
                return true;
            }
        }
        else if (command === `${entityCommand} ${statusEn}` || command === `${entityCommand} ${statusLang}`) {
            const info = await rustplus.getEntityInfoAsync(entityId);
            if (!(await rustplus.isResponseValid(info))) {
                /* Only not_found means the switch is gone, a timeout says nothing about it. */
                if (UnreachableDevices.isNotFound(info)) switches[entityId].reachable = false;
                client.setInstance(guildId, instance);
                DiscordMessages.sendSmartSwitchMessage(guildId, serverId, entityId);
                SmartSwitchGroupHandler.updateSwitchGroupIfContainSwitch(client, guildId, serverId, entityId);

                rustplus.sendInGameMessage(client.intlGet(guildId, 'noCommunicationSmartSwitch', {
                    name: switches[entityId].name
                }));
                return true;
            }

            rustplus.sendInGameMessage(client.intlGet(guildId, 'deviceIsCurrentlyOnOff', {
                device: switches[entityId].name,
                status: info.entityInfo.payload.value ? onCap : offCap
            }));
            return true;
        }
        else if (command.startsWith(`${entityCommand}`)) {
            active = !switches[entityId].active;
        }
        else {
            return true;
        }

        SwitchTimeouts.cancel(guildId, serverId, entityId);

        const timeSeconds = Timer.getSecondsFromStringTime(rest);

        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, `logSmartSwitchValueChange`, {
            value: active
        }));

        /*
            Awaited: a switch that did not answer already got the "no communication" message and must neither be
            reported as switched nor get a timer that would switch it back.
        */
        const switched = await module.exports.smartSwitchCommandTurnOnOff(rustplus, client, entityId, active);

        if (!switched || !switches[entityId] || !switches[entityId].reachable) return true;

        let str = client.intlGet(guildId, 'deviceWasTurnedOnOff', {
            device: switches[entityId].name,
            status: active ? onCap : offCap
        });

        /* "0s" is no timer, as for switch groups: a 0 ms timer would switch back at once. */
        if (timeSeconds === null || timeSeconds <= 0) {
            rustplus.sendInGameMessage(str);
            return true;
        }

        const time = Timer.secondsToFullScale(timeSeconds);
        str += client.intlGet(guildId, 'automaticallyTurnBackOnOff', {
            status: active ? offCap : onCap,
            time: time
        });

        const record = { kind: 'switch', id: `${entityId}`, value: !active, inGame: true };
        SwitchTimeouts.schedule(guildId, serverId, entityId, timeSeconds * 1000, record,
            () => module.exports.switchBack(client, guildId, serverId, entityId, !active, true));

        rustplus.sendInGameMessage(str);
        return true;
    },

    SWITCH_BACK_RETRY_DELAYS_MS: SWITCH_BACK_RETRY_DELAYS_MS,

    /*
        The end of an "on/off for X" timer of a switch (also a restored one, handlers/switchTimerRestore.js): switch it
        to value on the connection that is current now. A switch that did not answer (a timeout, a closed socket) is
        tried again after SWITCH_BACK_RETRY_DELAYS_MS, as a timer of its own (it shows in Discord, is cancelled by a
        new command and survives a restart); one the server does not know (not_found) is given up. inGame: announce
        the switch-back in the team chat. Returns whether it switched.
    */
    switchBack: async function (client, guildId, serverId, entityId, value, inGame, attempt = 0) {
        const switchOf = () => {
            const server = client.getInstance(guildId).serverList[serverId];
            return server && server.switches ? server.switches[entityId] : undefined;
        };
        if (!switchOf()) return false;

        /* The connection may have been rebuilt since the timer started: the current one switches. */
        const rustplus = SwitchTimeouts.currentInstance(client, guildId, serverId);
        if (rustplus === null) return false;

        let switched = false;
        try {
            switched = await module.exports.smartSwitchCommandTurnOnOff(rustplus, client, entityId, value);
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `The timer of switch ${entityId} could not switch: ${e && e.message ? e.message : e}`, 'warn');
        }

        const entity = switchOf();
        if (switched) {
            if (inGame && entity) {
                rustplus.sendInGameMessage(client.intlGet(guildId, 'automaticallyTurningBackOnOff', {
                    device: entity.name,
                    status: client.intlGet(guildId, value ? 'onCap' : 'offCap')
                }));
            }
            return true;
        }

        /* Gone (deleted, or not_found made it unreachable): asking again changes nothing. */
        if (!entity || entity.reachable === false || attempt >= SWITCH_BACK_RETRY_DELAYS_MS.length) {
            client.log(client.intlGet(null, 'warningCap'),
                `The timer of switch ${entityId} could not switch it ${value ? 'on' : 'off'}, it is given up.`, 'warn');
            return false;
        }

        const delayMs = SWITCH_BACK_RETRY_DELAYS_MS[attempt];
        client.log(client.intlGet(null, 'warningCap'),
            `The timer of switch ${entityId} could not switch it ${value ? 'on' : 'off'}, ` +
            `it tries again in ${Math.round(delayMs / 1000)} s.`, 'warn');

        const record = { kind: 'switch', id: `${entityId}`, value: value, inGame: Boolean(inGame) };
        SwitchTimeouts.schedule(guildId, serverId, entityId, delayMs, record,
            () => module.exports.switchBack(client, guildId, serverId, entityId, value, inGame, attempt + 1));
        return false;
    },

    smartSwitchCommandTurnOnOff: async function (rustplus, client, entityId, active) {
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;
        const instance = client.getInstance(guildId);
        const switches = instance.serverList[serverId].switches;

        const prevActive = switches[entityId].active;
        switches[entityId].active = active;
        client.setInstance(guildId, instance);

        rustplus.interactionSwitches.push(entityId);

        const response = await rustplus.turnSmartSwitchAsync(entityId, active);
        const switched = await rustplus.isResponseValid(response);
        if (!switched) {
            rustplus.sendInGameMessage(client.intlGet(guildId, 'noCommunicationSmartSwitch', {
                name: switches[entityId].name
            }));
            /* Only not_found means the switch is gone, a timeout or a closed socket says nothing about it. */
            if (UnreachableDevices.isNotFound(response)) {
                if (switches[entityId].reachable) {
                    await DiscordMessages.sendSmartSwitchNotFoundMessage(guildId, serverId, entityId);
                }
                switches[entityId].reachable = false;
            }
            switches[entityId].active = prevActive;

            rustplus.interactionSwitches = rustplus.interactionSwitches.filter(e => e !== entityId);
        }
        else {
            switches[entityId].reachable = true;
        }
        client.setInstance(guildId, instance);

        DiscordMessages.sendSmartSwitchMessage(guildId, serverId, entityId);
        SmartSwitchGroupHandler.updateSwitchGroupIfContainSwitch(client, guildId, serverId, entityId);

        /* Whether the switch answered: the caller only confirms (and starts a timer) for a switch that changed. */
        return switched;
    },
}