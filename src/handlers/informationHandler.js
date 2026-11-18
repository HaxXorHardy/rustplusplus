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

const Client = require('../structures/clientRegistry.js');

const DiscordMessages = require('../discordTools/discordMessages.js');
const WithTimeout = require('../util/withTimeout.js');

/* Warming the time played asks Battlemetrics once per team member; the team message must not wait longer for it. */
const WARM_TIME_PLAYED_TIMEOUT_MS = 10 * 1000;

/* The part of the information step that runs, named by the slow-step warning of handlers/backgroundHandler.js. */
function phase(rustplus, name) {
    rustplus.backgroundPhase = `the information (${name})`;
}

async function warmTeamTimePlayed(rustplus) {
    const instance = Client.client.getInstance(rustplus.guildId);
    const server = instance.serverList[rustplus.serverId];
    if (!server || !server.battlemetricsId) return;

    const bmInstance = Client.client.battlemetricsInstances[server.battlemetricsId];
    if (!bmInstance || !bmInstance.lastUpdateSuccessful) return;

    await bmInstance.warmTimePlayedCacheByNames(rustplus.team.players.map(e => e.name));
}

module.exports = {
    handler: async function (rustplus) {
        if (rustplus.informationIntervalCounter === 0) {
            const instance = Client.client.getInstance(rustplus.guildId);

            phase(rustplus, 'server');
            await DiscordMessages.sendUpdateServerInformationMessage(rustplus);

            phase(rustplus, 'monuments');
            if (instance.generalSettings.displayInformationMonumentInformation) {
                await DiscordMessages.sendUpdateMonumentInformationMessage(rustplus);
            }
            else {
                await DiscordMessages.deleteInformationMessage(rustplus.guildId, 'monument');
            }

            phase(rustplus, 'events');
            if (instance.generalSettings.displayInformationEventInformation) {
                await DiscordMessages.sendUpdateEventInformationMessage(rustplus);
            }
            else {
                await DiscordMessages.deleteInformationMessage(rustplus.guildId, 'event');
            }

            phase(rustplus, 'time played');
            try {
                await WithTimeout.withTimeout(warmTeamTimePlayed(rustplus), WARM_TIME_PLAYED_TIMEOUT_MS,
                    'warming the time played');
            }
            catch (e) {
                rustplus.log(Client.client.intlGet(null, 'infoCap'),
                    `The team message goes on without it: ${e && e.message ? e.message : e}`, 'debug');
            }

            phase(rustplus, 'team');
            await DiscordMessages.sendUpdateTeamInformationMessage(rustplus);
            phase(rustplus, 'order');
            await DiscordMessages.ensureInformationMessageOrder(rustplus);
        }

        if (rustplus.informationIntervalCounter === 5) {
            rustplus.informationIntervalCounter = 0;
        }
        else {
            rustplus.informationIntervalCounter += 1;
        }
    },
}