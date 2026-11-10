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
    The team map notes (AppTeamInfo.mapNotes/leaderMapNotes, the marks the team placed on the map) were not parsed, and
    the server information dropped logoImage, nexus, nexusId and nexusZone. Both are kept now.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const Info = require('../src/structures/Info.js');
const Team = require('../src/structures/Team.js');

const LEADER_STEAM_ID = '76561198000000001';

function infoPayload(overrides = {}) {
    return Object.assign({
        name: 'Rustpc.uk',
        headerImage: 'header.png',
        url: 'rustpc.uk',
        map: 'Procedural Map',
        mapSize: 3000,
        wipeTime: 1700000000,
        players: 12,
        maxPlayers: 100,
        queuedPlayers: 0,
        seed: 1234567,
        logoImage: 'logo.png',
        nexus: 'Rust+ Nexus',
        nexusId: 4711,
        nexusZone: 'EU',
    }, overrides);
}

function fakeRustplus() {
    return {
        guildId: 'testguild',
        info: { correctedMapSize: 3000 },
        log: () => undefined,
        timestampToDate: () => null,
        getRuntimeState: () => null,
        setRuntimeState: () => undefined,
    };
}

function teamPayload(overrides = {}) {
    return Object.assign({
        leaderSteamId: LEADER_STEAM_ID,
        members: [{
            steamId: LEADER_STEAM_ID,
            name: 'Leader',
            x: 100,
            y: 200,
            isOnline: true,
            spawnTime: 1700000000,
            isAlive: true,
            deathTime: 0,
        }],
        mapNotes: [{ type: 0, x: 100, y: 200 }],
        leaderMapNotes: [{ type: 1, x: 300, y: 400 }],
    }, overrides);
}

Test.describe('Info', () => {
    Test.it('keeps the logo and the nexus information of the server', () => {
        const info = new Info(infoPayload());

        Assert.strictEqual(info.logoImage, 'logo.png');
        Assert.strictEqual(info.nexus, 'Rust+ Nexus');
        Assert.strictEqual(info.nexusId, 4711);
        Assert.strictEqual(info.nexusZone, 'EU');
    });

    Test.it('updates the logo and the nexus information', () => {
        const info = new Info(infoPayload());
        const changed = infoPayload({ logoImage: 'other.png', nexus: '', nexusId: 0, nexusZone: '' });

        Assert.strictEqual(info.isLogoImageChanged(changed), true);
        Assert.strictEqual(info.isNexusChanged(changed), true);

        info.updateInfo(changed);

        Assert.strictEqual(info.logoImage, 'other.png');
        Assert.strictEqual(info.nexus, '');
        Assert.strictEqual(info.nexusId, 0);
        Assert.strictEqual(info.nexusZone, '');
        Assert.strictEqual(info.isLogoImageChanged(changed), false);
    });
});

Test.describe('Team', () => {
    /* The instance and its game server state are not needed for the team structures themselves. */
    Client.client = {
        getInstance: () => ({ teamChatColors: {} }),
        setInstance: () => undefined,
        intlGet: (guildId, key) => key,
    };

    Test.it('keeps the map notes of the team and of the leader', () => {
        const team = new Team(teamPayload(), fakeRustplus());

        Assert.deepStrictEqual(team.mapNotes, [{ type: 0, x: 100, y: 200 }]);
        Assert.deepStrictEqual(team.leaderMapNotes, [{ type: 1, x: 300, y: 400 }]);
        Assert.strictEqual(team.teamSize, 1);
    });

    Test.it('resets the map notes when the team has none', () => {
        const team = new Team(teamPayload(), fakeRustplus());

        team.updateTeam(teamPayload({ mapNotes: undefined, leaderMapNotes: undefined }));

        Assert.deepStrictEqual(team.mapNotes, []);
        Assert.deepStrictEqual(team.leaderMapNotes, []);
    });
});
