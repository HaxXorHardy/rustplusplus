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

const RustPlusLib = require('@liamcottle/rustplus.js');

const Client = require('./clientRegistry.js');
const Config = require('../../config');
const RustPlusAuth = require('../util/rustplusAuth.js');
const RustPlusSocket = require('../util/rustplusSocket.js');
const RustPlusTransport = require('../util/rustplusTransport.js');

class RustPlusLite extends RustPlusLib {
    constructor(guildId, logger, rustplus, serverIp, appPort, steamId, playerToken, useFacepunchProxy = false,
        serverGuid = null) {
        super(serverIp, appPort, steamId, playerToken, useFacepunchProxy);

        this.serverId = `${this.server}-${this.port}`;
        this.guildId = guildId;
        this.useFacepunchProxy = useFacepunchProxy;   /* Websocket transport, see util/rustplusTransport.js */
        this.serverGuid = serverGuid;                 /* Pairing id (uuid) of the server. */
        this.authToken = null;                        /* Account token of the Rust+ web login. */
        this.logger = logger;
        this.rustplus = rustplus;

        this.isActive = true;

        this.loadRustPlusLiteEvents();
    }

    loadRustPlusLiteEvents() {
        this.on('connected', (...args) => rustPlusLiteConnectedEvent(this, ...args));
        this.on('connecting', (...args) => rustPlusLiteConnectingEvent(this, ...args));
        this.on('disconnected', (...args) => rustPlusLiteDisconnectedEvent(this, ...args));
        this.on('error', (...args) => rustPlusLiteErrorEvent(this, ...args));
    }

    /* The leader account needs its own Rust+ login token, and the same server id as the main instance. */
    resolveAuthenticatedTransport() {
        const auth = RustPlusAuth.readAuth(this.playerId);
        this.authToken = auth ? auth.token : null;
        return this.serverGuid !== null && this.authToken !== null;
    }

    connect() {
        if (!this.resolveAuthenticatedTransport()) {
            /*
                The leader has no Rust+ login of their own, so the relay socket cannot be authenticated. An entry that
                is keyed by its pairing id (`relay-<uuid>`) has no address either, and the library transport would
                throw on `ws://relay:<uuid>` (see util/rustplusTransport.js). Refuse the connection instead of
                ending the process with an unhandled rejection.
            */
            if (RustPlusTransport.isRelayAddress(this.server) || !this.server || !this.port) {
                this.log(Client.client.intlGet(null, 'warningCap'),
                    `There is no Rust+ login stored for the leader ${this.playerId}, the connection of the team ` +
                    'leader is not tracked. Use "/credentials login" in Discord with that Steam account.', 'warn');

                return undefined;
            }

            return super.connect();
        }

        return RustPlusSocket.connectAuthenticatedSocket(this, this.serverGuid, this.authToken);
    }

    log(title, text, level = 'info') {
        this.logger.log(`${title} LITE`, text, level);
    }

    async getInfoAsync(timeout = 10000) {
        try {
            return await this.sendRequestAsync({
                getInfo: {}
            }, timeout).catch((e) => {
                return e;
            });
        }
        catch (e) {
            return e;
        }
    }

    async promoteToLeaderAsync(steamId, timeout = 10000) {
        try {
            return await this.sendRequestAsync({
                promoteToLeader: {
                    steamId: steamId
                }
            }, timeout).catch((e) => {
                return e;
            });
        }
        catch (e) {
            return e;
        }
    }

    isResponseValid(response) {
        if (response === undefined) {
            this.log(Client.client.intlGet(null, 'errorCap'),
                Client.client.intlGet(null, 'responseIsUndefined'), 'error');
            return false;
        }
        else if (response instanceof Error) {
            const message = `${response.message}`;

            this.log(Client.client.intlGet(null, 'errorCap'),
                (message.includes('Timeout reached while waiting for response')) ?
                    Client.client.intlGet(null, 'responseTimeout') :
                    message, 'error');
            return false;
        }
        else if (response.hasOwnProperty('error')) {
            this.log(Client.client.intlGet(null, 'errorCap'), Client.client.intlGet(null, 'responseContainError', {
                error: response.error
            }), 'error');
            return false;
        }
        else if (Object.keys(response).length === 0) {
            this.log(Client.client.intlGet(null, 'errorCap'),
                Client.client.intlGet(null, 'responseIsEmpty'), 'error');
            return false;
        }
        return true;
    }
}

async function rustPlusLiteConnectedEvent(rustplusLite) {
    rustplusLite.log(Client.client.intlGet(null, 'connectedCap'),
        Client.client.intlGet(null, 'connectedToServer'));

    const info = await rustplusLite.getInfoAsync();
    if (!rustplusLite.isResponseValid(info)) {
        rustplusLite.log(Client.client.intlGet(null, 'errorCap'),
            Client.client.intlGet(null, 'somethingWrongWithConnection'), 'error');
        rustplusLite.disconnect();
        return;
    }
    rustplusLite.log(Client.client.intlGet(null, 'connectedCap'),
        Client.client.intlGet(null, 'rustplusOperational'));

    if (Client.client.rustplusReconnectTimers[rustplusLite.guildId]) {
        clearTimeout(Client.client.rustplusReconnectTimers[rustplusLite.guildId]);
        Client.client.rustplusReconnectTimers[rustplusLite.guildId] = null;
    }
}

async function rustPlusLiteConnectingEvent(rustplusLite) {
    rustplusLite.log(Client.client.intlGet(null, 'connectingCap'),
        Client.client.intlGet(null, 'connectingToServer'));
}

async function rustPlusLiteDisconnectedEvent(rustplusLite) {
    rustplusLite.log(Client.client.intlGet(null, 'disconnectedCap'),
        Client.client.intlGet(null, 'disconnectedFromServer'));

    /* Was the disconnection unexpected? */
    if (rustplusLite.isActive && Client.client.activeRustplusInstances[rustplusLite.guildId]) {
        rustplusLite.log(Client.client.intlGet(null, 'reconnectingCap'),
            Client.client.intlGet(null, 'reconnectingToServer'));

        if (Client.client.rustplusLiteReconnectTimers[rustplusLite.guildId]) {
            clearTimeout(Client.client.rustplusLiteReconnectTimers[rustplusLite.guildId]);
            Client.client.rustplusLiteReconnectTimers[rustplusLite.guildId] = null;
        }

        Client.client.rustplusLiteReconnectTimers[rustplusLite.guildId] = setTimeout(
            rustplusLite.rustplus.updateLeaderRustPlusLiteInstance.bind(rustplusLite.rustplus),
            Config.general.reconnectIntervalMs);
    }
}

async function rustPlusLiteErrorEvent(rustplusLite, error) {
    rustplusLite.log(Client.client.intlGet(null, 'errorCap'), error, 'error');
}

module.exports = RustPlusLite;
