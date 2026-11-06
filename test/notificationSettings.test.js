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
const NotificationSettingsTemplate = require('../src/templates/notificationSettingsTemplate.json');

const languagesPath = Path.join(__dirname, '..', 'src', 'languages');
const instancesPath = Path.join(__dirname, '..', 'instances');

function readLanguage(name) {
    return JSON.parse(Fs.readFileSync(Path.join(languagesPath, name), 'utf8'));
}

function languageFiles() {
    return Fs.readdirSync(languagesPath).filter((file) => file.endsWith('.json'));
}

/*
    A missing translation is logged as an error by @formatjs/intl and the settings channel then shows the
    raw id, so every language has to contain every message.
*/
Test.describe('Language files', () => {
    Test.it('every language defines all messages of en.json', () => {
        const english = readLanguage('en.json');

        for (const file of languageFiles()) {
            const messages = readLanguage(file);
            const missing = Object.keys(english).filter((key) => !(key in messages));

            Assert.deepStrictEqual(missing, [], `${file} is missing translations`);
        }
    });

    Test.it('every notification setting has a title in every language', () => {
        for (const file of languageFiles()) {
            const messages = readLanguage(file);
            const missing = Object.keys(NotificationSettingsTemplate).filter((key) => !(key in messages));

            Assert.deepStrictEqual(missing, [], `${file} is missing notification setting titles`);
        }
    });
});

/* The setting name is used as translation id, settings of removed events would show up untranslated. */
Test.describe('createInstanceFile notification settings migration', () => {
    const guildId = '900000000000000001';
    const instancePath = Path.join(instancesPath, `${guildId}.json`);

    function fakeClient(onSetInstance) {
        return {
            readGeneralSettingsTemplate: () => ({}),
            readNotificationSettingsTemplate: () => JSON.parse(JSON.stringify(NotificationSettingsTemplate)),
            setInstance: (id, instance) => onSetInstance(instance),
        };
    }

    Test.afterEach(() => {
        if (Fs.existsSync(instancePath)) Fs.unlinkSync(instancePath);
    });

    Test.it('drops settings that are not part of the template anymore', () => {
        Fs.mkdirSync(instancesPath, { recursive: true });
        Fs.writeFileSync(instancePath, JSON.stringify({
            notificationSettings: {
                cargoShipDetectedSetting: {
                    image: 'cargoship_logo.png', discord: false, inGame: false, voice: false
                },
                cargoShipDockedSetting: {
                    image: 'cargoship_logo.png', discord: true, inGame: false, voice: true
                },
            },
        }));

        let saved = null;
        CreateInstanceFile(fakeClient((instance) => saved = instance), { id: guildId });

        Assert.ok(saved, 'the instance should be written');
        Assert.strictEqual('cargoShipDockedSetting' in saved.notificationSettings, false);
        Assert.deepStrictEqual(
            Object.keys(saved.notificationSettings).sort(),
            Object.keys(NotificationSettingsTemplate).sort());

        /* The values of the user are kept for the settings that still exist. */
        Assert.strictEqual(saved.notificationSettings.cargoShipDetectedSetting.discord, false);
    });
});
