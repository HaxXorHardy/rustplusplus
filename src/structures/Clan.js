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
    The clan of the paired steam account (AppResponse.clanInfo). Only the name and the member counts were kept before,
    everything else the server sends - the message of the day, the roles with their permissions, the members with their
    online state and the open invitations - was dropped. The whole AppClanInfo is kept here, so a command can show it and
    the permission of a role (canSetMotd) can be checked.
*/

const { isResponseFailure } = require('../util/responseUtils.js');

function toId(value) {
    return (value === undefined || value === null) ? null : `${value}`;
}

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

class Clan {
    constructor(clanInfo) {
        this._clanId = null;
        this._name = '';
        this._created = null;
        this._creator = null;
        this._motd = '';
        this._motdTimestamp = null;
        this._motdAuthor = null;
        this._color = null;
        this._roles = [];
        this._members = [];
        this._invites = [];
        this._maxMemberCount = 0;

        this.updateClan(clanInfo);
    }

    /*
        The clan of a getClanInfo response, null when the account is in no clan or the request was not answered.
        AppResponse.clanInfo is an AppClanInfo wrapper, the data is nested in its clanInfo.
    */
    static fromResponse(response) {
        if (isResponseFailure(response) || !response || !response.clanInfo) return null;
        if (!response.clanInfo.clanInfo) return null;

        return new Clan(response.clanInfo.clanInfo);
    }

    /* Getters and Setters */
    get clanId() { return this._clanId; }
    set clanId(clanId) { this._clanId = clanId; }
    get name() { return this._name; }
    set name(name) { this._name = name; }
    get created() { return this._created; }
    set created(created) { this._created = created; }
    get creator() { return this._creator; }
    set creator(creator) { this._creator = creator; }
    get motd() { return this._motd; }
    set motd(motd) { this._motd = motd; }
    get motdTimestamp() { return this._motdTimestamp; }
    set motdTimestamp(motdTimestamp) { this._motdTimestamp = motdTimestamp; }
    get motdAuthor() { return this._motdAuthor; }
    set motdAuthor(motdAuthor) { this._motdAuthor = motdAuthor; }
    get color() { return this._color; }
    set color(color) { this._color = color; }
    get roles() { return this._roles; }
    set roles(roles) { this._roles = roles; }
    get members() { return this._members; }
    set members(members) { this._members = members; }
    get invites() { return this._invites; }
    set invites(invites) { this._invites = invites; }
    get maxMemberCount() { return this._maxMemberCount; }
    set maxMemberCount(maxMemberCount) { this._maxMemberCount = maxMemberCount; }
    get memberCount() { return this._members.length; }
    get onlineMemberCount() { return this._members.filter((member) => member.online).length; }

    /* The role of a member, null when the member or the role is unknown. */
    getMemberRole(steamId) {
        const member = this._members.find((entry) => entry.steamId === `${steamId}`);
        if (!member) return null;

        return this._roles.find((role) => role.id === member.roleId) || null;
    }

    /* Does the role of the member allow to set the message of the day? */
    canMemberSetMotd(steamId) {
        const role = this.getMemberRole(steamId);
        return (role !== null && role.canSetMotd === true);
    }

    updateClan(clanInfo) {
        if (!clanInfo) return;

        this.clanId = toId(clanInfo.clanId);
        this.name = `${clanInfo.name === undefined || clanInfo.name === null ? '' : clanInfo.name}`;
        this.created = Number.isFinite(clanInfo.created) ? clanInfo.created : null;
        this.creator = toId(clanInfo.creator);
        this.motd = `${clanInfo.motd === undefined || clanInfo.motd === null ? '' : clanInfo.motd}`;
        this.motdTimestamp = Number.isFinite(clanInfo.motdTimestamp) ? clanInfo.motdTimestamp : null;
        this.motdAuthor = toId(clanInfo.motdAuthor);
        this.color = Number.isFinite(clanInfo.color) ? clanInfo.color : null;
        this.maxMemberCount = Number.isFinite(clanInfo.maxMemberCount) ? clanInfo.maxMemberCount : 0;

        this.roles = toArray(clanInfo.roles).map((role) => ({
            id: Number.isFinite(role.roleId) ? role.roleId : null,
            rank: Number.isFinite(role.rank) ? role.rank : null,
            name: `${role.name === undefined || role.name === null ? '' : role.name}`,
            canSetMotd: role.canSetMotd === true,
            canSetLogo: role.canSetLogo === true,
            canInvite: role.canInvite === true,
            canKick: role.canKick === true,
            canPromote: role.canPromote === true,
            canDemote: role.canDemote === true,
            canSetPlayerNotes: role.canSetPlayerNotes === true,
            canAccessLogs: role.canAccessLogs === true,
        }));

        this.members = toArray(clanInfo.members).map((member) => ({
            steamId: toId(member.steamId),
            roleId: Number.isFinite(member.roleId) ? member.roleId : null,
            joined: Number.isFinite(member.joined) ? member.joined : null,
            lastSeen: Number.isFinite(member.lastSeen) ? member.lastSeen : null,
            online: member.online === true,
            notes: member.notes === undefined || member.notes === null ? null : `${member.notes}`,
        }));

        this.invites = toArray(clanInfo.invites).map((invite) => ({
            steamId: toId(invite.steamId),
            recruiter: toId(invite.recruiter),
            timestamp: Number.isFinite(invite.timestamp) ? invite.timestamp : null,
        }));
    }
}

module.exports = Clan;
