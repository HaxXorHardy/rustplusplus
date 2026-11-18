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

const Builder = require('@discordjs/builders');

const BotStatus = require('../util/botStatus.js');
const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const RustPlusAuth = require('../util/rustplusAuth.js');
const RustPlusPush = require('../util/rustplusPush.js');
const RustPlusPushListener = require('../util/rustplusPushListener.js');
const Timer = require('../util/timer.js');
const TokenRecovery = require('../util/tokenRecovery.js');
const Version = require('../../package.json').version;

function duration(ms) {
    return ms === null ? '-' : Timer.secondsToFullScale(Math.max(0, ms) / 1000);
}

function relative(ms) {
    return ms === null ? '-' : `<t:${Math.floor(ms / 1000)}:R>`;
}

function clock(ms) {
    return new Date(ms).toISOString().slice(11, 16);
}

/* The status as an embed. Exported for tests. */
function buildEmbed(client, guildId, status) {
    const intl = (key, variables) => client.intlGet(guildId, key, variables);
    const lines = [];

    lines.push(`🤖 **${intl('statusBot')}**: ${intl('statusUptime')} ${duration(status.botUptimeMs)}` +
        `${status.discordPingMs !== null ? `, Discord ${status.discordPingMs} ms` : ''}`);

    const connection = {
        operational: `${Constants.ONLINE_EMOJI} ${intl('statusOperational')}`,
        connecting: `🟡 ${intl('statusConnecting')}`,
        offline: `${Constants.OFFLINE_EMOJI} ${intl('statusOffline')}`,
    }[status.connection];
    lines.push(`🔌 **Rust+**: ${connection}${status.server ? ` - ${status.server}` : ''}`);
    if (status.connection !== 'offline') {
        lines.push(`　${intl('statusSocketAge')} ${duration(status.socketAgeMs)}, ` +
            `${intl('statusLastPoll', { time: duration(status.lastPollAgoMs) })}`);
    }
    lines.push(`　${intl('statusDisconnects', { count: `${status.disconnects.count}` })}` +
        `${status.disconnects.lastMs !== null ? ` (${relative(status.disconnects.lastMs)})` : ''}`);

    lines.push(`🔑 **${intl('statusToken')}**: ${intl('statusExpires')} ${relative(status.tokenExpiresMs)}` +
        `${status.tokenRefused ? `, ⚠️ ${intl('statusTokenRefused')}` : ''}`);

    let push = `${Constants.OFFLINE_EMOJI} ${intl('statusPushOff')}`;
    if (status.push !== null) {
        push = status.push.up ? `${Constants.ONLINE_EMOJI} ${intl('statusPushUp')}` :
            `🟡 ${intl('statusPushDown')} ${relative(status.push.downSince)}`;
    }
    lines.push(`📲 **Push**: ${push}` +
        `${status.pushNotifications !== null ? `, ${intl('statusPushReceived', { count: `${status.pushNotifications}` })}` : ''}` +
        `${status.pushRegistrationExpiresMs !== null ? `, ${intl('statusExpires')} ${relative(status.pushRegistrationExpiresMs)}` : ''}`);

    lines.push(`⚠️ **${intl('statusWarnings')}**: ${intl('statusWarningsLastHour', { count: `${status.warningsLastHour}` })}`);
    for (const warning of status.warnings) {
        const text = warning.text.replace(/`/g, "'");
        lines.push(`\`${clock(warning.atMs)}\` ${text.length > 110 ? `${text.slice(0, 110)}…` : text}`);
    }

    let color = Constants.COLOR_ACTIVE;
    if (status.connection !== 'operational') color = Constants.COLOR_INACTIVE;
    else if (status.warningsLastHour !== 0 || status.tokenRefused || (status.push !== null && !status.push.up)) {
        color = '#F5C400';
    }

    return DiscordEmbeds.getEmbed({
        title: intl('statusTitle', { version: status.version || Version }),
        color: color,
        description: lines.join('\n').slice(0, 4000),
        timestamp: true
    });
}

/* The values of the live objects and the stored files. Exported for tests. */
function gather(client, guildId) {
    const instance = client.getInstance(guildId);
    const server = (instance.activeServer !== null) ? instance.serverList[instance.activeServer] : null;
    const steamId = server ? server.steamId : null;

    let auth = null, push = null;
    try {
        auth = steamId ? RustPlusAuth.readAuth(steamId) : null;
        push = steamId ? RustPlusPush.readPush(steamId) : null;
    }
    catch (e) {
        /* The status shows what it can. */
    }

    return BotStatus.collect(client, guildId, {
        version: Version,
        auth: auth,
        push: push,
        pushState: steamId ? RustPlusPushListener.connectionState(steamId) : null,
        tokenRefused: steamId ? TokenRecovery.isTokenRefused(steamId) : false,
    });
}

module.exports = {
    name: 'status',
    buildEmbed: buildEmbed,
    gather: gather,

    getSlashCommandDefinition(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('status')
            .setDescription(client.intlGet(guildId, 'commandsStatusDesc'));
    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const embed = buildEmbed(client, interaction.guildId, gather(client, interaction.guildId));
        await client.interactionEditReply(interaction, { embeds: [embed], ephemeral: true });

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: 'status'
        }));
    },
};
