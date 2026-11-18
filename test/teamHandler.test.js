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

const Assert = require('node:assert');
const Test = require('node:test');

const DiscordMessages = require('../src/discordTools/discordMessages.js');
const TeamHandler = require('../src/handlers/teamHandler.js');

function fakePlayer(steamId, isOnline) {
    return {
        steamId: steamId,
        name: `player${steamId}`,
        isOnline: isOnline,
        pos: null,
        isGoneDead: () => false,
        isGoneAfk: () => false,
        isAfk: () => false,
        isMoved: () => false,
        isGoneOnline: (updated) => isOnline === false && updated.isOnline === true,
        isGoneOffline: (updated) => isOnline === true && updated.isOnline === false,
    };
}

function setup(players) {
    const sent = [];
    const rustplus = {
        guildId: 'guild',
        serverId: 'server',
        team: {
            players: players,
            allOffline: players.every((p) => !p.isOnline),
            isLeaderSteamIdChanged: () => false,
            getNewPlayers: () => [],
            getLeftPlayers: () => [],
        },
        log: () => undefined,
        updateConnections: () => undefined,
        /* What the in-game chat sees when the message is written. */
        sendInGameMessage: async (text) => { sent.push({ text: text, allOffline: rustplus.team.allOffline }); },
    };
    const client = {
        intlGet: (guildId, key, args) => (args && args.name ? `${key}:${args.name}` : key),
        getInstance: () => ({
            serverList: { server: { title: 'Server' } },
            generalSettings: { connectionNotify: true, deathNotify: false, afkNotify: false },
        }),
    };

    return { rustplus, client, sent };
}

Test.describe('Team handler', () => {
    Test.it('announces the first member coming online in-game, the team is no longer all offline', async (t) => {
        t.mock.method(DiscordMessages, 'sendActivityNotificationMessage', async () => undefined);
        const { rustplus, client, sent } = setup([fakePlayer('1', false), fakePlayer('2', false)]);

        await TeamHandler.checkChanges(rustplus, client, {
            members: [{ steamId: '1', isOnline: true }, { steamId: '2', isOnline: false }],
        });

        Assert.deepStrictEqual(sent, [{ text: 'playerJustConnected:player1', allOffline: false }]);
        Assert.strictEqual(DiscordMessages.sendActivityNotificationMessage.mock.callCount(), 1);
    });

    Test.it('keeps the team all offline when nobody is online', async (t) => {
        t.mock.method(DiscordMessages, 'sendActivityNotificationMessage', async () => undefined);
        const { rustplus, client, sent } = setup([fakePlayer('1', false)]);

        await TeamHandler.checkChanges(rustplus, client, { members: [{ steamId: '1', isOnline: false }] });

        Assert.strictEqual(rustplus.team.allOffline, true);
        Assert.deepStrictEqual(sent, []);
    });
});
