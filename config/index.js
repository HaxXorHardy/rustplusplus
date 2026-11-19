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
        /* Upper limit of the reconnect backoff, a server that stays offline is not asked every 15 seconds. */
        reconnectIntervalMaxMs: envInt('RPP_RECONNECT_INTERVAL_MAX', 5 * 60 * 1000),
        /* Debug mode enables verbose (debug level) logging and call stacks in the logs. */
        debug: debug,
        showCallStackError: debug || envBool('RPP_LOG_CALL_STACK', false),
        /* Warn users when their stored Rust+ credentials are about to expire or have expired. */
        credentialsExpiryCheckIntervalMs: envInt('RPP_CREDENTIALS_EXPIRY_CHECK_INTERVAL', 3600000), /* 1 hour */
        credentialsExpiryWarningSeconds: envInt('RPP_CREDENTIALS_EXPIRY_WARNING', 3 * 24 * 3600), /* 3 days */
        /*
            How the Rust+ websocket is reached: 'auto' uses the authenticated socket of the Rust+ app and falls back
            to the direct/proxy transports Facepunch removed, 'direct' and 'proxy' force one of them.
        */
        rustplusTransport: process.env.RPP_RUSTPLUS_TRANSPORT || 'auto',
        /* Build timestamp the Rust+ socket handshake sends (?v=...). Empty = the value of util/rustplusTransport.js. */
        rustplusBuildVersion: process.env.RPP_RUSTPLUS_BUILD_VERSION || '',
        /* Renew the Rust+ account token this many seconds before it expires (default 3 days). */
        rustplusTokenRenewBeforeSeconds: envInt('RPP_RUSTPLUS_TOKEN_RENEW_BEFORE', 3 * 24 * 3600),
        /* How often the notification history is read to adopt servers/devices that were paired in-game. */
        rustplusHistoryIntervalMs: envInt('RPP_RUSTPLUS_HISTORY_INTERVAL', 5 * 60 * 1000), /* 5 min */
        /*
            How often the account state (the server list of the app) is read. The history is the source of truth for
            new pairings and is read on every refresh, so a short history interval (a few seconds) stays cheap: this
            slower snapshot is cached in between (see util/rustplusHistory.js).
        */
        rustplusSyncDataIntervalMs: envInt('RPP_RUSTPLUS_SYNCDATA_INTERVAL', 5 * 60 * 1000), /* 5 min */
        /*
            Push notifications (FCM) of the Rust+ app: raid alarms, team logins, smart alarms of other servers and new
            pairings in real time. The bot registers itself as a device of the account (util/rustplusPush.js). The
            history keeps working without it.
        */
        pushEnabled: envBool('RPP_PUSH_ENABLED', true),
        /* Report a smart alarm of a server the bot is not connected to (the connected server reports its own). */
        pushAlarmsOtherServers: envBool('RPP_PUSH_ALARMS_OTHER_SERVERS', true),
        /*
            A smart alarm that fires again within this many seconds posts no new message (the next one after the
            pause says how many were left out). 0 = every trigger is posted.
        */
        alarmCooldownSeconds: envInt('RPP_ALARM_COOLDOWN', 60),
        /*
            Raid mode: an alarm while nobody of the team is online sends a direct message to the registered users,
            and when no alarm came for a while a raid report is posted.
        */
        raidModeEnabled: envBool('RPP_RAID_MODE', true),
        /*
            Map events (cargo ship, patrol helicopter, chinook, oil rigs, vending machines, deep sea, traveling vendor).
            Facepunch's Rust+ API stopped sending these markers (2026-11-18), so the code that uses them does not run
            unless this is true - for the day they come back.
        */
        mapEventsEnabled: envBool('RPP_MAP_EVENTS_ENABLED', false),
        /* Where the device images are linked from (util/deviceImages.js); empty = this repository on GitHub. */
        imageBaseUrl: process.env.RPP_IMAGE_BASE_URL || '',
        /* Warn this many hours before a tool cupboard (with a storage monitor) runs out of upkeep. 0 = off. */
        upkeepWarningHours: envInt('RPP_UPKEEP_WARNING_HOURS', 6),
        /*
            A storage monitor that pushes changes non-stop (a tool cupboard) edits its Discord message at most once in
            this many seconds, the edit after the pause shows the latest state. A tool cupboard is also read from the
            server at most once in this time. Buttons still update at once. 0 = no pause.
        */
        storageMonitorEditIntervalSeconds: envInt('RPP_STORAGE_MONITOR_EDIT_INTERVAL', 30),
        /* The time zone of switch group schedules without their own (e.g. Europe/Berlin). */
        scheduleTimeZone: process.env.RPP_TIMEZONE || 'UTC',
    },
    discord: {
        username: process.env.RPP_DISCORD_USERNAME || 'rustplusplus',
        clientId: process.env.RPP_DISCORD_CLIENT_ID || '',
        token: process.env.RPP_DISCORD_TOKEN || '',
        needAdminPrivileges: envBool('RPP_NEED_ADMIN_PRIVILEGES', true), /* If true, only admins can delete (server, switch..), manage credentials and reset a channel */
    },
    steam: {
        /* Optional: Steam Web API key, read by util/steamTimePlayed.js (Rust playtime as Steam reports it). */
        apiKey: process.env.RPP_STEAM_API_KEY || '',
    },
    battlemetrics: {
        token: process.env.RPP_BATTLEMETRICS_TOKEN || '',
        get enabled() {
            return typeof this.token === 'string' && this.token.trim().length > 0;
        },
    }
};
