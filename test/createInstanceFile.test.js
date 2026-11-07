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
const Fs = require('node:fs');
const Path = require('node:path');
const Test = require('node:test');

const CreateInstanceFile = require('../src/util/createInstanceFile.js');
const InstanceUtils = require('../src/util/instanceUtils.js');

const GUILD_ID = '100000000000000005';
const SERVER_ID = '1.2.3.4-28015';

function instancePath() {
    return Path.join(__dirname, '..', 'instances', `${GUILD_ID}.json`);
}

function writeInstance(instance) {
    /* The helper creates the instances directory, a fresh checkout does not have one. */
    InstanceUtils.writeInstanceFile(GUILD_ID, instance);
}

function fakeServer() {
    return {
        title: 'Test Server',
        serverIp: '1.2.3.4',
        appPort: '28082',
        steamId: '76561198000000012',
        playerToken: 123456789,
        battlemetricsId: null,
        messageId: null,
        switches: {},
        switchGroups: {},
        alarms: {},
        storageMonitors: {},
        cameras: {},
        customCameraGroups: {},
        markers: {},
        notes: {},
    };
}

function fakeClient() {
    const client = {
        saved: null,
        warnings: [],
        log(title, text) {
            this.warnings.push(text);
        },
        intlGet: () => 'WARNING',
        readGeneralSettingsTemplate: () => new Object(),
        readNotificationSettingsTemplate: () => new Object(),
        setInstance(guildId, instance) {
            this.saved = instance;
        },
    };

    return client;
}

Test.describe('createInstanceFile', () => {
    Test.afterEach(() => {
        if (Fs.existsSync(instancePath())) Fs.unlinkSync(instancePath());
    });

    /*
        A server is removed from the server list while the bot is not connected, which leaves activeServer
        pointing at nothing. Startup repairs that, so the next pairing or login can activate a server again.
    */
    Test.it('resets an active server that is not in the server list anymore', () => {
        writeInstance({
            firstTime: false,
            activeServer: '5.6.7.8-28015',
            serverList: {},
            trackers: {},
        });

        const client = fakeClient();
        CreateInstanceFile(client, { id: GUILD_ID });

        Assert.strictEqual(client.saved.activeServer, null);
        Assert.strictEqual(client.warnings.length, 1);
        Assert.match(client.warnings[0], /5\.6\.7\.8-28015 is not in the server list anymore/);
    });

    Test.it('keeps an active server that is in the server list', () => {
        writeInstance({
            firstTime: false,
            activeServer: SERVER_ID,
            serverList: {
                [SERVER_ID]: fakeServer(),
            },
            trackers: {},
        });

        const client = fakeClient();
        CreateInstanceFile(client, { id: GUILD_ID });

        Assert.strictEqual(client.saved.activeServer, SERVER_ID);
        Assert.strictEqual(client.warnings.length, 0);
    });

    /*
        The lite mirror is read by the team message (Object.keys) - a server without one crashed the startup.
    */
    Test.it('creates the lite mirror of the servers of the instance', () => {
        writeInstance({
            firstTime: false,
            activeServer: SERVER_ID,
            serverList: {
                [SERVER_ID]: fakeServer(),
            },
            trackers: {},
        });

        const client = fakeClient();
        CreateInstanceFile(client, { id: GUILD_ID });

        Assert.deepStrictEqual(Object.keys(client.saved.serverListLite), [SERVER_ID]);
        Assert.ok(client.saved.serverListLite[SERVER_ID]['76561198000000012']);
        Assert.deepStrictEqual(client.saved.deletedServers, {});
    });
});
