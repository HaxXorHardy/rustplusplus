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

/* Device images are linked, not uploaded: Discord handled edits with an upload one after another (17 s each). */

const Assert = require('node:assert');
const Test = require('node:test');

const Config = require('../config');
const DeviceImages = require('../src/util/deviceImages.js');

Test.describe('device images', () => {
    Test.it('link the image in this repository, or under RPP_IMAGE_BASE_URL', (t) => {
        Assert.strictEqual(DeviceImages.url('smart_switch.png'),
            `${DeviceImages.DEFAULT_BASE_URL}/src/resources/images/electrics/smart_switch.png`);
        Assert.strictEqual(DeviceImages.resource('team_info_logo.png'),
            `${DeviceImages.DEFAULT_BASE_URL}/src/resources/images/team_info_logo.png`);

        const original = Config.general.imageBaseUrl;
        Config.general.imageBaseUrl = 'https://example.org/copy/';
        t.after(() => { Config.general.imageBaseUrl = original; });
        Assert.strictEqual(DeviceImages.url('a b.png'), 'https://example.org/copy/src/resources/images/electrics/a%20b.png');
    });

    Test.it('the timer form offers on and off as a choice', () => {
        const Registry = require('../src/structures/clientRegistry.js');
        const de = require('../src/languages/de.json');
        const original = Registry.client;
        Registry.client = {
            getInstance: () => ({ serverList: { s: {
                switches: { a: { active: true, reachable: true } },
                switchGroups: { g: { name: 'Group', switches: ['a'] } } } } }),
            intlGet: (guildId, key) => de[key] || key,
        };
        try {
            const DiscordModals = require('../src/discordTools/discordModals.js');
            const json = DiscordModals.getGroupTimerModal('guild', 's', 'g').toJSON();
            const select = json.components[0].component;

            Assert.strictEqual(select.custom_id, 'GroupTimerState');
            Assert.deepStrictEqual(select.options.map((o) => [o.value, o.default]), [['on', false], ['off', true]],
                'the group is on: off is preselected');
            Assert.strictEqual(json.components[1].component.custom_id, 'GroupTimerDuration');
        }
        finally {
            Registry.client = original;
        }
    });
});
