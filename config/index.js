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

const Path = require('path');

/* Load the .env file (if present) before any process.env value below is read. */
require('dotenv').config({
    path: Path.join(__dirname, '..', '.env'),
    quiet: true,
});

/* Parse a boolean environment variable. Accepts: 1/true/yes/on (case-insensitive). */
function envBool(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/* Parse an integer environment variable, falling back to the default if it is not a number. */
function envInt(name, fallback) {
    const value = Number.parseInt(process.env[name], 10);
    return Number.isNaN(value) ? fallback : value;
}

/* Global debug mode, enabled with RPP_DEBUG=true (in the .env file or real environment). */
const debug = envBool('RPP_DEBUG', false);

module.exports = {
    general: {
        language: process.env.RPP_LANGUAGE || 'en',
        pollingIntervalMs: envInt('RPP_POLLING_INTERVAL', 10000),
        reconnectIntervalMs: envInt('RPP_RECONNECT_INTERVAL', 15000),
        /* Debug mode enables verbose (debug level) logging and call stacks in the logs. */
        debug: debug,
        showCallStackError: debug || envBool('RPP_LOG_CALL_STACK', false),
    },
    discord: {
        username: process.env.RPP_DISCORD_USERNAME || 'rustplusplus',
        clientId: process.env.RPP_DISCORD_CLIENT_ID || '',
        token: process.env.RPP_DISCORD_TOKEN || '',
        needAdminPrivileges: envBool('RPP_NEED_ADMIN_PRIVILEGES', true), /* If true, only admins can delete (server, switch..), manage credentials and reset a channel */
    },
    battlemetrics: {
        token: process.env.RPP_BATTLEMETRICS_TOKEN || '',
        get enabled() {
            return typeof this.token === 'string' && this.token.trim().length > 0;
        },
    }
};
