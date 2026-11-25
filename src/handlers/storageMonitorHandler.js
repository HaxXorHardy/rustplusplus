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

const Constants = require('../util/constants.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const GuildSettings = require('../util/guildSettings.js');
const StorageAlerts = require('../util/storageAlerts.js');
const Timer = require('../util/timer.js');
const UnreachableDevices = require('../util/unreachableDevices.js');
const UpkeepWarning = require('../util/upkeepWarning.js');

const Config = require('../../config');

/*
    The storage monitors are read every STORAGE_MONITOR_EVERY_CYCLES background cycles (60 s each): every 5 minutes.
    It was 30 cycles, which made 30 minutes once the monitors moved from the poll (10 s) to the background cycle.
    The counter starts at null: the first cycle after a connect reads them at once.
*/
const STORAGE_MONITOR_EVERY_CYCLES = 5;

/*
    The early upkeep warning of a tool cupboard (util/upkeepWarning.js), from the cycle and from the change broadcasts.
    Changes monitor.upkeepWarned; the caller saves the instance.
*/
function warnUpkeep(rustplus, client, serverId, entityId, expiry) {
    const guildId = rustplus.guildId;
    const instance = client.getInstance(guildId);
    const monitor = instance.serverList[serverId] ? instance.serverList[serverId].storageMonitors[entityId] : null;
    if (!monitor) return;

    const upkeep = UpkeepWarning.check(monitor, expiry, Math.floor(Date.now() / 1000),
        GuildSettings.upkeepWarningHours(guildId));

    if (upkeep === 'warn') {
        monitor.upkeepWarned = true;
        client.setInstance(guildId, instance);

        DiscordMessages.sendUpkeepWarningMessage(guildId, serverId, entityId, expiry).catch(() => undefined);

        if (monitor.inGame) {
            rustplus.sendInGameMessage(client.intlGet(guildId, 'upkeepRunsOut', {
                device: monitor.name,
                time: Timer.secondsToFullScale(Math.max(0, expiry - Date.now() / 1000), 's')
            }));
        }
    }
    else if (upkeep === 'rearm') {
        monitor.upkeepWarned = false;
        client.setInstance(guildId, instance);
    }
}

module.exports = {
    STORAGE_MONITOR_EVERY_CYCLES: STORAGE_MONITOR_EVERY_CYCLES,
    warnUpkeep: warnUpkeep,

    handler: async function (rustplus, client) {
        let instance = client.getInstance(rustplus.guildId);
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;

        if (!instance.serverList.hasOwnProperty(serverId)) return;

        const counter = rustplus.storageMonitorIntervalCounter;
        if (counter === null || counter === undefined || counter >= STORAGE_MONITOR_EVERY_CYCLES - 1) {
            rustplus.storageMonitorIntervalCounter = 0;
        }
        else {
            rustplus.storageMonitorIntervalCounter += 1;
        }

        if (rustplus.storageMonitorIntervalCounter === 0) {
            let instance = client.getInstance(guildId);
            for (const entityId in instance.serverList[serverId].storageMonitors) {
                instance = client.getInstance(guildId);

                /* A device the server does not know anymore is asked once an hour instead of on every round. */
                if (UnreachableDevices.isUnreachable(rustplus, entityId)) continue;

                const info = await rustplus.getEntityInfoAsync(entityId);
                const answered = await rustplus.isResponseValid(info, { expectNotFound: true });

                /* No answer is no not_found: the monitor is asked again on the next round. */
                if (!answered && !UnreachableDevices.isNotFound(info)) continue;

                if (!answered) {
                    UnreachableDevices.markUnreachable(rustplus, entityId);

                    if (instance.serverList[serverId].storageMonitors[entityId].reachable) {
                        await DiscordMessages.sendStorageMonitorNotFoundMessage(guildId, serverId, entityId);
                    }
                    instance.serverList[serverId].storageMonitors[entityId].reachable = false;
                }
                else {
                    UnreachableDevices.markReachable(rustplus, entityId);

                    instance.serverList[serverId].storageMonitors[entityId].reachable = true;
                }
                client.setInstance(guildId, instance);

                if (instance.serverList[serverId].storageMonitors[entityId].reachable) {
                    if (rustplus.storageMonitors.hasOwnProperty(entityId) &&
                        (rustplus.storageMonitors[entityId].capacity !== 0 &&
                            info.entityInfo.payload.capacity === 0)) {
                        await DiscordMessages.sendStorageMonitorDisconnectNotificationMessage(
                            guildId, serverId, entityId);
                    }

                    rustplus.storageMonitors[entityId] = {
                        items: info.entityInfo.payload.items,
                        expiry: info.entityInfo.payload.protectionExpiry,
                        capacity: info.entityInfo.payload.capacity,
                        hasProtection: info.entityInfo.payload.hasProtection
                    }

                    if (info.entityInfo.payload.capacity !== 0) {
                        if (info.entityInfo.payload.capacity === Constants.STORAGE_MONITOR_TOOL_CUPBOARD_CAPACITY) {
                            instance.serverList[serverId].storageMonitors[entityId].type = 'toolCupboard';
                            if (info.entityInfo.payload.protectionExpiry === 0 &&
                                instance.serverList[serverId].storageMonitors[entityId].decaying === false) {
                                instance.serverList[serverId].storageMonitors[entityId].decaying = true;

                                await DiscordMessages.sendDecayingNotificationMessage(
                                    guildId, serverId, entityId);

                                if (instance.serverList[serverId].storageMonitors[entityId].inGame) {
                                    rustplus.sendInGameMessage(client.intlGet(rustplus.guildId, 'isDecaying', {
                                        device: instance.serverList[serverId].storageMonitors[entityId].name
                                    }));
                                }
                            }
                            else if (info.entityInfo.payload.protectionExpiry !== 0) {
                                instance.serverList[serverId].storageMonitors[entityId].decaying = false;
                            }

                            /* Early warning: the upkeep runs out within the configured hours. */
                            client.setInstance(guildId, instance);
                            warnUpkeep(rustplus, client, serverId, entityId,
                                info.entityInfo.payload.protectionExpiry);
                            instance = client.getInstance(guildId);
                        }
                        else if (info.entityInfo.payload.capacity ===
                            Constants.STORAGE_MONITOR_VENDING_MACHINE_CAPACITY) {
                            instance.serverList[serverId].storageMonitors[entityId].type = 'vendingMachine';
                        }
                        else if (info.entityInfo.payload.capacity ===
                            Constants.STORAGE_MONITOR_LARGE_WOOD_BOX_CAPACITY) {
                            instance.serverList[serverId].storageMonitors[entityId].type = 'largeWoodBox';
                        }
                        client.setInstance(guildId, instance);
                    }
                }

                await DiscordMessages.sendStorageMonitorMessage(guildId, serverId, entityId);
                await StorageAlerts.check(client, rustplus, entityId);
            }
        }
    },
}