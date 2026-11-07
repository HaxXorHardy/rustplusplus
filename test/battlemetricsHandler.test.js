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

const Assert = require('node:assert');
const Test = require('node:test');

const BattlemetricsHandler = require('../src/handlers/battlemetricsHandler.js');
const Client = require('../src/structures/clientRegistry.js');
const Config = require('../config');

const GUILD_ID = '100000000000000003';
const SERVER_ID = '1.2.3.4-28015';

function fakeInstance(activeServer, serverList) {
    return {
        activeServer: activeServer,
        serverList: serverList,
        trackers: {},
        generalSettings: {
            displayInformationBattlemetricsAllOnlinePlayers: false,
        },
        informationMessageId: {
            battlemetricsPlayers: null,
        },
        channelId: {
            information: null,
        },
    };
}

function fakeClient(instance) {
    return {
        battlemetricsIntervalCounter: 1,
        battlemetricsInstances: {},
        rustplusInstances: {},
        guilds: {
            cache: new Map([[GUILD_ID, { id: GUILD_ID }]]),
        },
        getInstance: () => instance,
        setInstance: () => undefined,
        updateBattlemetricsInstances: async () => undefined,
    };
}

function runHandler(instance) {
    const client = fakeClient(instance);
    Client.client = client;

    return BattlemetricsHandler.handler(client, false);
}

Test.describe('BattlemetricsHandler.handler', () => {
    Test.beforeEach((t) => {
        const original = Config.battlemetrics.token;
        Config.battlemetrics.token = 'test-token';
        t.after(() => {
            Config.battlemetrics.token = original;
            Client.client = null;
        });
    });

    /*
        A server can be removed while the bot is not connected, which leaves activeServer pointing at nothing.
        The handler runs every minute and must not end in an unhandled rejection because of that.
    */
    Test.it('survives an active server that is not in the server list anymore', async () => {
        await Assert.doesNotReject(runHandler(fakeInstance(SERVER_ID, {})));
    });

    Test.it('survives an active server without a battlemetrics id', async () => {
        const serverList = {
            [SERVER_ID]: {
                title: 'Test Server',
                battlemetricsId: null,
            },
        };

        await Assert.doesNotReject(runHandler(fakeInstance(SERVER_ID, serverList)));
    });
});
