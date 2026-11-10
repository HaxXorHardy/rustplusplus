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
    The requests of the Rust+ protocol: every field of AppRequest in rustplus.proto with the AppResponse field it is
    answered with, and the broadcasts of AppBroadcast. The wrapper of the bot (src/structures/RustPlus.js) builds its
    requests from this list, so a new field of the proto is a one line change here - and test/rustplusApi.test.js
    compares the list against the proto file to make sure nothing is missing.

    AppRequest fields that are not listed (19) do not exist, the numbering has a gap.
*/

const REQUESTS = {
    getInfo: { response: 'info' },
    getTime: { response: 'time' },
    getMap: { response: 'map' },
    getTeamInfo: { response: 'teamInfo' },
    getTeamChat: { response: 'teamChat' },
    sendTeamMessage: { response: 'success' },
    getEntityInfo: { response: 'entityInfo' },
    setEntityValue: { response: 'success' },
    checkSubscription: { response: 'flag' },
    setSubscription: { response: 'success' },
    getMapMarkers: { response: 'mapMarkers' },
    promoteToLeader: { response: 'success' },
    getClanInfo: { response: 'clanInfo' },
    setClanMotd: { response: 'success' },
    getClanChat: { response: 'clanChat' },
    sendClanMessage: { response: 'success' },
    getNexusAuth: { response: 'nexusAuth' },
    cameraSubscribe: { response: 'cameraSubscribeInfo' },
    cameraUnsubscribe: { response: 'success' },
    cameraInput: { response: 'success' },
};

/* AppBroadcast fields of the proto. */
const BROADCASTS = ['teamChanged', 'teamMessage', 'entityChanged', 'clanChanged', 'clanMessage', 'cameraRays'];

/* Every request the protocol knows. */
function listRequests() {
    return Object.keys(REQUESTS);
}

/* Every broadcast the protocol knows. */
function listBroadcasts() {
    return BROADCASTS.slice();
}

function isKnownRequest(name) {
    return Object.prototype.hasOwnProperty.call(REQUESTS, name);
}

/*
    Build a request message: buildRequest('getClanChat') -> { getClanChat: {} },
    buildRequest('sendClanMessage', { message: 'hi' }) -> { sendClanMessage: { message: 'hi' } }.
    An unknown name throws instead of sending something the server cannot answer.
*/
function buildRequest(name, params = {}) {
    if (!isKnownRequest(name)) throw new Error(`Unknown Rust+ request "${name}".`);

    return { [name]: params };
}

/* The AppResponse field this request is answered with, null for an unknown request. */
function getResponseKey(name) {
    return isKnownRequest(name) ? REQUESTS[name].response : null;
}

module.exports = {
    REQUESTS: REQUESTS,
    BROADCASTS: BROADCASTS,
    listRequests: listRequests,
    listBroadcasts: listBroadcasts,
    isKnownRequest: isKnownRequest,
    buildRequest: buildRequest,
    getResponseKey: getResponseKey,
};
