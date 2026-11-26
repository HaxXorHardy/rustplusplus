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

/* The stranger alert of the camera watch: the embed stays within the Discord limit, a failed send is not suppressed. */

const Assert = require('node:assert');
const Test = require('node:test');

const Camera = require('../src/structures/Camera.js');
const CameraWatchHandler = require('../src/handlers/cameraWatchHandler.js');
const Client = require('../src/structures/clientRegistry.js');
const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');

function stubClient(t) {
    const previous = Client.client;
    Client.client = {
        intlGet: (guildId, key, args) => args && args.number !== undefined ? `${key} ${args.number}` : key,
        log: () => undefined,
        getInstance: () => ({ generalSettings: { cameraWatchReportTeam: false } }),
    };
    t.after(() => {
        Client.client = previous;
    });
    return Client.client;
}

Test.describe('DiscordEmbeds.getCameraAlertEmbed', () => {
    Test.it('caps the description below the 4096 character limit', (t) => {
        stubClient(t);
        const strangers = [];
        for (let i = 0; i < 500; i++) strangers.push({ name: `Stranger number ${i}`, entityId: i, distance: 12.5 });

        const embed = DiscordEmbeds.getCameraAlertEmbed('g', 'cam1', null, strangers, null);
        const description = embed.data.description;

        Assert.ok(description.length <= 4096, `${description.length} characters`);
        const lines = description.split('\n');
        const shown = lines.length - 1;
        Assert.strictEqual(lines[lines.length - 1], `andMorePlayers ${500 - shown}`);
        Assert.match(lines[0], /Stranger number 0/);
    });

    Test.it('lists a few strangers in full', (t) => {
        stubClient(t);
        const embed = DiscordEmbeds.getCameraAlertEmbed('g', 'cam1', null,
            [{ name: 'A', entityId: 1, distance: null }, { name: null, entityId: 2, distance: 3 }], null);

        Assert.strictEqual(embed.data.description, '- **A**\n- `#2` (3 m)');
    });
});

Test.describe('CameraWatchHandler.checkCamera', () => {
    function stubCamera(t) {
        const originalWait = Camera.prototype.waitForFrames;
        const originalCollect = Camera.prototype.collect;
        Camera.prototype.waitForFrames = async function () {
            this._frames.push({ sampleOffset: 0, rayData: Buffer.alloc(0),
                entities: [{ type: Camera.ENTITY_TYPE_PLAYER, entityId: 7, name: 'Raider' }] });
            return this._frames.length;
        };
        Camera.prototype.collect = async function () { return this._frames.length; };
        t.after(() => {
            Camera.prototype.waitForFrames = originalWait;
            Camera.prototype.collect = originalCollect;
        });
    }

    function rustplus() {
        return {
            guildId: 'g',
            team: { players: [] },
            cameraAlertState: {},
            log: () => undefined,
            on: () => undefined,
            removeListener: () => undefined,
            subscribeToCameraAsync: async () => ({
                error: null, cameraSubscribeInfo: { width: 16, height: 9, controlFlags: 0 },
            }),
            unsubscribeFromCameraAsync: async () => undefined,
        };
    }

    Test.it('starts the cooldown only after the alert was sent', async (t) => {
        const client = stubClient(t);
        stubCamera(t);
        const original = DiscordMessages.sendCameraAlertMessage;
        let attempts = 0;
        DiscordMessages.sendCameraAlertMessage = async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('Discord is down');
        };
        t.after(() => {
            DiscordMessages.sendCameraAlertMessage = original;
        });

        const rp = rustplus();
        await Assert.rejects(CameraWatchHandler.checkCamera(rp, client, 'cam1'), /Discord is down/);
        Assert.deepStrictEqual(rp.cameraAlertState, {});

        await CameraWatchHandler.checkCamera(rp, client, 'cam1');
        Assert.strictEqual(attempts, 2);
        Assert.deepStrictEqual(Object.keys(rp.cameraAlertState), ['cam1:Raider']);

        await CameraWatchHandler.checkCamera(rp, client, 'cam1');
        Assert.strictEqual(attempts, 2, 'the cooldown holds the third one back');
    });
});
