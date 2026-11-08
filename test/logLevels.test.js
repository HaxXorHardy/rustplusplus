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

const LogLevels = require('../src/util/logLevels.js');

Test.describe('normalizeLogLevel', () => {
    Test.it('keeps the supported levels', () => {
        for (const level of LogLevels.LOG_LEVELS) {
            Assert.strictEqual(LogLevels.normalizeLogLevel(level), level);
        }
    });

    Test.it('accepts upper case and surrounding whitespace', () => {
        Assert.strictEqual(LogLevels.normalizeLogLevel(' FULL '), 'full');
        Assert.strictEqual(LogLevels.normalizeLogLevel('Off'), 'off');
    });

    Test.it('falls back to the default for unknown values', () => {
        Assert.strictEqual(LogLevels.normalizeLogLevel('verbose'), LogLevels.DEFAULT_LOG_LEVEL);
        Assert.strictEqual(LogLevels.normalizeLogLevel(undefined), LogLevels.DEFAULT_LOG_LEVEL);
        Assert.strictEqual(LogLevels.normalizeLogLevel(null), LogLevels.DEFAULT_LOG_LEVEL);
        Assert.strictEqual(LogLevels.normalizeLogLevel(42), LogLevels.DEFAULT_LOG_LEVEL);
    });

    Test.it('defaults to error, the level the template ships with', () => {
        const template = JSON.parse(Fs.readFileSync(
            Path.join(__dirname, '..', 'src', 'templates', 'generalSettingsTemplate.json'), 'utf8'));

        Assert.strictEqual(LogLevels.DEFAULT_LOG_LEVEL, 'error');
        Assert.strictEqual(template.serverLogLevel, 'error');
    });
});

Test.describe('allowsLevel', () => {
    Test.it('off posts nothing', () => {
        for (const lineLevel of ['error', 'warn', 'info', 'debug']) {
            Assert.strictEqual(LogLevels.allowsLevel('off', lineLevel), false);
        }
    });

    Test.it('error only posts errors', () => {
        Assert.strictEqual(LogLevels.allowsLevel('error', 'error'), true);
        Assert.strictEqual(LogLevels.allowsLevel('error', 'warning'), false);
        Assert.strictEqual(LogLevels.allowsLevel('error', 'info'), false);
        Assert.strictEqual(LogLevels.allowsLevel('error', 'debug'), false);
    });

    Test.it('info posts everything except debug lines', () => {
        Assert.strictEqual(LogLevels.allowsLevel('info', 'error'), true);
        Assert.strictEqual(LogLevels.allowsLevel('info', 'warn'), true);
        Assert.strictEqual(LogLevels.allowsLevel('info', 'warning'), true);
        Assert.strictEqual(LogLevels.allowsLevel('info', 'info'), true);
        Assert.strictEqual(LogLevels.allowsLevel('info', 'debug'), false);
    });

    Test.it('full posts everything', () => {
        for (const lineLevel of ['error', 'warn', 'warning', 'info', 'debug']) {
            Assert.strictEqual(LogLevels.allowsLevel('full', lineLevel), true);
        }
    });

    Test.it('an unknown line level counts as information', () => {
        Assert.strictEqual(LogLevels.allowsLevel('info', 'something'), true);
        Assert.strictEqual(LogLevels.allowsLevel('error', 'something'), false);
    });
});

Test.describe('isOff', () => {
    Test.it('is only true for the off level', () => {
        Assert.strictEqual(LogLevels.isOff('off'), true);
        Assert.strictEqual(LogLevels.isOff(' OFF '), true);
        Assert.strictEqual(LogLevels.isOff('error'), false);
        Assert.strictEqual(LogLevels.isOff(undefined), false);
    });
});

Test.describe('server log translations', () => {
    Test.it('every language knows the channel name and the setting', () => {
        const languagesPath = Path.join(__dirname, '..', 'src', 'languages');
        const keys = [
            'channelNameServerlog',
            'serverLogChannelsRecreated',
            'serverLogLevelCurrent',
            'serverLogLevelError',
            'serverLogLevelErrorDesc',
            'serverLogLevelFull',
            'serverLogLevelFullDesc',
            'serverLogLevelInfo',
            'serverLogLevelInfoDesc',
            'serverLogLevelNote',
            'serverLogLevelOff',
            'serverLogLevelOffDesc',
            'serverLogLevelSetting',
            'serverLogLinesDropped'
        ];

        for (const file of Fs.readdirSync(languagesPath).filter((name) => name.endsWith('.json'))) {
            const messages = JSON.parse(Fs.readFileSync(Path.join(languagesPath, file), 'utf8'));
            const missing = keys.filter((key) => !(key in messages));

            Assert.deepStrictEqual(missing, [], `${file} is missing server log translations`);
        }
    });
});
