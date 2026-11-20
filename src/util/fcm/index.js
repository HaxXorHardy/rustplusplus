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
    FCM receiver of an Android device: registration (AndroidFCM.register) and the MCS connection (Client). Replaces
    @liamcottle/push-receiver with the same interface, without the deprecated "request" package.
*/

const AndroidFcm = require('./androidFcm.js');
const McsClient = require('./mcsClient.js');

module.exports = {
    AndroidFCM: { register: AndroidFcm.register },
    Client: McsClient,
};
