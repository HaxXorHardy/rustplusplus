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
    The clan of the paired account: before only the name and the member counts were parsed, the message of the day, the
    roles with their permissions and the invitations were dropped. structures/Clan.js keeps the whole AppClanInfo.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Clan = require('../src/structures/Clan.js');

const LEADER_STEAM_ID = '76561198000000001';
const MEMBER_STEAM_ID = '76561198000000002';

const CLAN_INFO = {
    clanId: '4711',
    name: 'Rust Lords',
    created: 1700000000,
    creator: LEADER_STEAM_ID,
    motd: 'No raiding at night',
    motdTimestamp: 1700000100,
    motdAuthor: LEADER_STEAM_ID,
    color: 16711680,
    maxMemberCount: 20,
    roles: [
        { roleId: 1, rank: 0, name: 'Leader', canSetMotd: true, canInvite: true, canKick: true },
        { roleId: 2, rank: 1, name: 'Member', canSetMotd: false },
    ],
    members: [
        { steamId: LEADER_STEAM_ID, roleId: 1, joined: 1700000001, lastSeen: 1700000200, online: true },
        { steamId: MEMBER_STEAM_ID, roleId: 2, joined: 1700000002, lastSeen: 1700000150, online: false },
    ],
    invites: [{ steamId: '76561198000000003', recruiter: LEADER_STEAM_ID, timestamp: 1700000300 }],
};

function response(clanInfo) {
    /* AppResponse.clanInfo is an AppClanInfo wrapper, the data is nested. */
    return { clanInfo: { clanInfo: clanInfo } };
}

Test.describe('Clan.fromResponse', () => {
    Test.it('reads the whole clan', () => {
        const clan = Clan.fromResponse(response(CLAN_INFO));

        Assert.ok(clan !== null);
        Assert.strictEqual(clan.clanId, '4711');
        Assert.strictEqual(clan.name, 'Rust Lords');
        Assert.strictEqual(clan.motd, 'No raiding at night');
        Assert.strictEqual(clan.motdTimestamp, 1700000100);
        Assert.strictEqual(clan.motdAuthor, LEADER_STEAM_ID);
        Assert.strictEqual(clan.created, 1700000000);
        Assert.strictEqual(clan.creator, LEADER_STEAM_ID);
        Assert.strictEqual(clan.color, 16711680);
        Assert.strictEqual(clan.maxMemberCount, 20);
        Assert.strictEqual(clan.memberCount, 2);
        Assert.strictEqual(clan.onlineMemberCount, 1);
        Assert.strictEqual(clan.roles.length, 2);
        Assert.strictEqual(clan.invites.length, 1);
        Assert.strictEqual(clan.invites[0].recruiter, LEADER_STEAM_ID);
    });

    Test.it('tells whether a role may set the message of the day', () => {
        const clan = Clan.fromResponse(response(CLAN_INFO));

        Assert.strictEqual(clan.getMemberRole(LEADER_STEAM_ID).name, 'Leader');
        Assert.strictEqual(clan.canMemberSetMotd(LEADER_STEAM_ID), true);
        Assert.strictEqual(clan.canMemberSetMotd(MEMBER_STEAM_ID), false);
        Assert.strictEqual(clan.canMemberSetMotd('76561198000000099'), false);
    });

    Test.it('returns null when the account is in no clan', () => {
        Assert.strictEqual(Clan.fromResponse({}), null);
        Assert.strictEqual(Clan.fromResponse({ clanInfo: {} }), null);
        Assert.strictEqual(Clan.fromResponse({ error: 'not_in_clan' }), null);
        Assert.strictEqual(Clan.fromResponse(undefined), null);
    });

    Test.it('survives a clan without roles, members or invites', () => {
        const clan = Clan.fromResponse(response({ name: 'Empty', maxMemberCount: 8 }));

        Assert.strictEqual(clan.name, 'Empty');
        Assert.strictEqual(clan.motd, '');
        Assert.strictEqual(clan.memberCount, 0);
        Assert.strictEqual(clan.onlineMemberCount, 0);
        Assert.deepStrictEqual(clan.roles, []);
        Assert.deepStrictEqual(clan.invites, []);
        Assert.strictEqual(clan.canMemberSetMotd(LEADER_STEAM_ID), false);
    });
});
