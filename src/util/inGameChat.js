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
    Helpers for the in-game chat channel selection. rustplusplus writes its own In-Game messages either to the
    team chat (default) or to the clan chat, In-Game commands are read from both of them.
*/

const CHANNELS = {
    TEAM: 'team',
    CLAN: 'clan',
};

function normalizeChannel(channel) {
    return (`${channel}`.toLowerCase() === CHANNELS.CLAN) ? CHANNELS.CLAN : CHANNELS.TEAM;
}

/* The channel that is configured for the guild in its settings (defaults to the team chat). */
function getConfiguredChannel(generalSettings) {
    return normalizeChannel(generalSettings ? generalSettings.inGameChatChannel : CHANNELS.TEAM);
}

/* The channel to use for a specific message: an explicit channel wins over the configured one. */
function resolveChannel(generalSettings, chatChannel = null) {
    return (chatChannel === null) ? getConfiguredChannel(generalSettings) : normalizeChannel(chatChannel);
}

module.exports = {
    CHANNELS: CHANNELS,
    normalizeChannel: normalizeChannel,
    getConfiguredChannel: getConfiguredChannel,
    resolveChannel: resolveChannel,
};
