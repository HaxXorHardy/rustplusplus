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
    "On/off for X" timers of switches and groups that were running when the bot stopped (a restart, a redeploy) are
    stored in the instance (server.pendingTimers, util/switchTimeouts.js). After the connection is up they are started
    again with the time that is left; one that is already due fires after RESTORE_MIN_DELAY_MS, when the connection
    has settled.
*/

const SmartSwitchGroupHandler = require('./smartSwitchGroupHandler.js');
const SmartSwitchHandler = require('./smartSwitchHandler.js');
const SwitchTimeouts = require('../util/switchTimeouts.js');

const RESTORE_MIN_DELAY_MS = 5 * 1000;

/* What a restored timer does when it is due, on the connection that is current then. */
async function fire(client, guildId, serverId, key, record) {
    const rustplus = SwitchTimeouts.currentInstance(client, guildId, serverId);
    if (rustplus === null) return;

    const server = client.getInstance(guildId).serverList[serverId];
    if (!server) return;

    const status = client.intlGet(guildId, record.value ? 'onCap' : 'offCap');

    if (record.kind === 'group') {
        const group = server.switchGroups ? server.switchGroups[record.id] : null;
        if (!group) return;

        if (record.inGame) {
            rustplus.sendInGameMessage(client.intlGet(guildId, 'automaticallyTurningBackOnOff', {
                device: group.name,
                status: status
            }));
        }

        const result = await SmartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, guildId, serverId, record.id,
            record.value);
        if (result.switched.length === 0 && result.failed.length === 0) {
            /* The timer line of the group message goes away. */
            const DiscordMessages = require('../discordTools/discordMessages.js');
            await DiscordMessages.sendSmartSwitchGroupMessage(guildId, serverId, record.id);
        }
        return;
    }

    const entity = server.switches ? server.switches[record.id] : null;
    if (!entity) return;

    await SmartSwitchHandler.smartSwitchCommandTurnOnOff(rustplus, client, record.id, record.value);
    if (record.inGame) {
        rustplus.sendInGameMessage(client.intlGet(guildId, 'automaticallyTurningBackOnOff', {
            device: entity.name,
            status: status
        }));
    }
}

/* Start the stored timers of the server the connection belongs to. Returns how many were started. */
function restore(client, rustplus, now = Date.now()) {
    const guildId = rustplus.guildId;
    const serverId = rustplus.serverId;
    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server || !server.pendingTimers || typeof server.pendingTimers !== 'object') return 0;

    let started = 0;

    for (const [key, record] of Object.entries(Object.assign({}, server.pendingTimers))) {
        /* Still running (a reconnect, not a restart). */
        if (SwitchTimeouts.of(guildId, serverId)[key]) continue;

        const valid = record && (record.kind === 'group' || record.kind === 'switch') &&
            typeof record.value === 'boolean' && Number.isFinite(Number(record.endsAtMs));
        if (!valid) {
            SwitchTimeouts.cancel(guildId, serverId, key);
            continue;
        }

        const delayMs = Math.max(RESTORE_MIN_DELAY_MS, Number(record.endsAtMs) - now);
        const plain = { kind: record.kind, id: `${record.id}`, value: record.value, inGame: Boolean(record.inGame) };

        SwitchTimeouts.schedule(guildId, serverId, key, delayMs, plain, async () => {
            try {
                await fire(client, guildId, serverId, key, plain);
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'),
                    `The restored timer ${key} could not switch: ${e && e.message ? e.message : e}`, 'warn');
            }
        });

        started += 1;
        rustplus.log(client.intlGet(null, 'infoCap'),
            `The timer of ${record.kind} ${record.id} was restored, it switches ${record.value ? 'on' : 'off'} in ` +
            `${Math.round(delayMs / 1000)} s.`);
    }

    return started;
}

module.exports = {
    RESTORE_MIN_DELAY_MS: RESTORE_MIN_DELAY_MS,
    restore: restore,
};
