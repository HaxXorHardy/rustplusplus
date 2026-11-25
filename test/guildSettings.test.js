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

const Client = require('../src/structures/clientRegistry.js');
const Config = require('../config');
const GuildSettings = require('../src/util/guildSettings.js');
const RaidHandler = require('../src/handlers/raidHandler.js');

function withGuild(t, generalSettings) {
    const en = require('../src/languages/en.json');
    const previous = Client.client;
    Client.client = {
        getInstance: () => ({ generalSettings: generalSettings }),
        intlGet: (guildId, key, variables) => {
            let text = en[key] || key;
            for (const [name, value] of Object.entries(variables || {})) text = text.replace(`{${name}}`, value);
            return text;
        },
    };
    t.after(() => { Client.client = previous; RaidHandler.reset(); });
}

Test.describe('settings per guild (Discord) before the environment', () => {
    Test.it('uses the environment while the guild chose nothing', (t) => {
        withGuild(t, {});

        Assert.strictEqual(GuildSettings.alarmCooldownSeconds('guild'), Config.general.alarmCooldownSeconds);
        Assert.strictEqual(GuildSettings.raidModeEnabled('guild'), Config.general.raidModeEnabled);
        Assert.strictEqual(GuildSettings.alarmEscalationEnabled('guild'), Config.general.alarmEscalationEnabled);
        Assert.strictEqual(GuildSettings.upkeepWarningHours('guild'), Config.general.upkeepWarningHours);
        Assert.strictEqual(GuildSettings.timeZone('guild'), 'UTC');
    });

    Test.it('uses what the guild chose in Discord, 0 included', (t) => {
        withGuild(t, { alarmCooldownSeconds: 0, raidModeEnabled: false, alarmEscalationEnabled: false,
            upkeepWarningHours: 12, timeZone: 'Europe/Berlin' });

        Assert.strictEqual(GuildSettings.alarmCooldownSeconds('guild'), 0);
        Assert.strictEqual(GuildSettings.raidModeEnabled('guild'), false);
        Assert.strictEqual(GuildSettings.alarmEscalationEnabled('guild'), false);
        Assert.strictEqual(GuildSettings.upkeepWarningHours('guild'), 12);
        Assert.strictEqual(GuildSettings.timeZone('guild'), 'Europe/Berlin');
    });

    Test.it('ignores an invalid time zone', (t) => {
        withGuild(t, { timeZone: 'Mars/Olympus' });
        Assert.strictEqual(GuildSettings.timeZone('guild'), 'UTC');
    });

    Test.it('the raid handler follows the guild setting', (t) => {
        withGuild(t, { alarmCooldownSeconds: 0, raidModeEnabled: false });
        const rustplus = { guildId: 'guild', serverId: 'server', team: { allOffline: true } };

        Assert.strictEqual(RaidHandler.onAlarm(rustplus, 7, 1000).post, true);
        const second = RaidHandler.onAlarm(rustplus, 7, 1001);
        Assert.strictEqual(second.post, true, 'cooldown 0: every trigger');
        Assert.strictEqual(second.raidStarted, false, 'raid mode off');
    });

    Test.it('the escalation follows the guild setting', (t) => {
        withGuild(t, { alarmCooldownSeconds: 0, alarmEscalationEnabled: false });
        const rustplus = { guildId: 'guild', serverId: 'server', team: { allOffline: false } };

        RaidHandler.onAlarm(rustplus, 7, 1000);
        Assert.strictEqual(RaidHandler.onAlarm(rustplus, 7, 2000).everyone, false, 'escalation off');
    });

    Test.it('the dropdowns and the button are valid Discord components', (t) => {
        withGuild(t, {});
        const DiscordSelectMenus = require('../src/discordTools/discordSelectMenus.js');
        const DiscordButtons = require('../src/discordTools/discordButtons.js');

        const rows = [
            DiscordSelectMenus.getAlarmCooldownSelectMenu('guild', 60),
            DiscordSelectMenus.getUpkeepWarningSelectMenu('guild', 6),
            DiscordSelectMenus.getTimeZoneSelectMenu('guild', 'Europe/Berlin'),
            DiscordButtons.getRaidModeButton('guild', true),
        ].map((row) => row.toJSON());

        Assert.strictEqual(rows[0].components[0].custom_id, 'AlarmCooldown');
        Assert.ok(rows[2].components[0].options.length <= 25);
        Assert.ok(rows[2].components[0].placeholder.includes('Europe/Berlin'));
        Assert.strictEqual(rows[3].components[0].custom_id, 'RaidMode');
    });
});
