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
    isResponseFailure: isResponseFailure,
    describeResponse: describeResponse,
};
