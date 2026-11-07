/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

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

const RustPlusTransport = require('../util/rustplusTransport.js');

module.exports = {
    name: 'connecting',
    async execute(rustplus, client) {
        if (!rustplus.isServerAvailable()) return rustplus.deleteThisRustplusInstance();

        const failures = client.rustplusConnectFailures || new Object();
        const directFailures = failures[rustplus.guildId] || 0;
        const authenticated = rustplus.serverGuid !== null && rustplus.authToken !== null;

        /* The transport is part of the log, so a wrong endpoint or a blocked connection shows up here. */
        const details = [authenticated ?
            RustPlusTransport.describeSocketEndpoint(rustplus.serverGuid) :
            RustPlusTransport.describeEndpoint(rustplus.server, rustplus.port, rustplus.useFacepunchProxy)];

        if (!authenticated && rustplus.useFacepunchProxy && directFailures !== 0) {
            details.push(`${directFailures} direct attempt(s) failed`);
        }

        rustplus.log(client.intlGet(null, 'connectingCap'),
            `${client.intlGet(null, 'connectingToServer')} (${details.join(', ')})`);
    },
};