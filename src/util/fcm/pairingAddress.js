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
    Pairing notifications are keyed by the server address (ip-appPort) in the instance file, and they carry the
    pairing id (uuid) the authenticated Rust+ websocket is addressed with.

    Since Facepunch removed the direct connections a pairing notification may only carry the id and no ip/port
    anymore. In that case the server is stored under a key built from the id, because ip/port are only used as the
    key - the relay never connects to them. serverIp/appPort are set to values that rebuild that key, so the
    rustplus instance (`${server}-${port}`) matches the entry in the instance file.
*/

const RELAY_SERVER_IP = 'relay';

function resolveServerAddress(instance, body) {
    if (!body) return null;

    if (body.ip && body.port) {
        return {
            serverId: `${body.ip}-${body.port}`,
            serverIp: `${body.ip}`,
            appPort: `${body.port}`,
            guid: body.id ? `${body.id}` : null,
        };
    }

    const guid = body.id ? `${body.id}` : null;
    if (guid === null) return null;

    /* An entry that was paired with this server before keeps its key, so nothing to migrate. */
    for (const serverId in instance.serverList || {}) {
        const server = instance.serverList[serverId];
        if (server && server.guid === guid) {
            return { serverId: serverId, serverIp: server.serverIp, appPort: server.appPort, guid: guid };
        }
    }

    return { serverId: `${RELAY_SERVER_IP}-${guid}`, serverIp: RELAY_SERVER_IP, appPort: guid, guid: guid };
}

module.exports = {
    RELAY_SERVER_IP: RELAY_SERVER_IP,
    resolveServerAddress: resolveServerAddress,
};
