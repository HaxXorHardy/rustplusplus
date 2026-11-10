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
    Helpers to interpret responses of rustplus requests (AppResponse/AppError/Timeout). They are shared
    between the handlers that need to tell apart "the request failed" from "the request was answered".
*/

/* A request failed if no response was received, an Error/Timeout was thrown or an AppError was returned. */
function isResponseFailure(response) {
    if (response === undefined || response === null || response instanceof Error) return true;
    return (typeof response === 'object') && response.hasOwnProperty('error');
}

/* The AppResponse fields that carry an answer (see AppResponse in rustplus.proto). */
const RESPONSE_KEYS = [
    'success', 'error', 'info', 'time', 'map', 'teamInfo', 'teamChat', 'entityInfo', 'flag', 'mapMarkers',
    'clanInfo', 'clanChat', 'nexusAuth', 'cameraSubscribeInfo',
];

/*
    An unsupported or invalid request is answered with an empty AppResponse - not with an AppError. A live server was
    asked for getEntityInfo without an id, for checkSubscription without an id, for an unknown field and for a camera
    subscription with an invalid id: every one of them came back as `{}`. isResponseFailure() still treats only a real
    error as a failure, the classifier below tells the cases apart.
*/
function isResponseEmpty(response) {
    if (response === undefined || response === null || response instanceof Error) return false;
    if (typeof response !== 'object') return false;

    return !RESPONSE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(response, key));
}

/*
    'success' | 'error' | 'empty' | 'timeout' | 'invalid'
    - success: the response carries one of the AppResponse fields
    - error: an AppError came back (or the request threw)
    - empty: the server answered, but the request is not supported (or invalid)
    - timeout: no response at all
*/
function classifyResponse(response) {
    if (response === undefined || response === null) return 'timeout';
    if (response instanceof Error) return 'error';
    if (typeof response !== 'object') return 'invalid';
    if (Object.prototype.hasOwnProperty.call(response, 'error')) return 'error';

    return isResponseEmpty(response) ? 'empty' : 'success';
}

function describeResponse(response) {
    if (response instanceof Error) return response.message;
    if (response === undefined) return 'undefined';
    if (response === null) return 'null';
    try {
        return JSON.stringify(response);
    }
    catch (e) {
        return String(response);
    }
}

module.exports = {
    RESPONSE_KEYS: RESPONSE_KEYS,
    isResponseFailure: isResponseFailure,
    isResponseEmpty: isResponseEmpty,
    classifyResponse: classifyResponse,
    describeResponse: describeResponse,
};
