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

const Config = require('../config');
const RaidHandler = require('../src/handlers/raidHandler.js');

function rustplus(allOffline) {
    return { guildId: 'guild', serverId: 'server', team: { allOffline: allOffline } };
}

Test.describe('raid handler', () => {
    Test.beforeEach((t) => {
        RaidHandler.reset();
        const cooldown = Config.general.alarmCooldownSeconds;
        const raidMode = Config.general.raidModeEnabled;
        Config.general.alarmCooldownSeconds = 60;
        Config.general.raidModeEnabled = true;
        t.after(() => {
            Config.general.alarmCooldownSeconds = cooldown;
            Config.general.raidModeEnabled = raidMode;
        });
    });

    Test.it('posts the first trigger, leaves out the next within the cooldown and counts them', () => {
        const rp = rustplus(false);
        const t0 = 1000000;

        Assert.strictEqual(RaidHandler.onAlarm(rp, 7, t0).post, true);
        Assert.strictEqual(RaidHandler.onAlarm(rp, 7, t0 + 10000).post, false);
        Assert.strictEqual(RaidHandler.onAlarm(rp, 7, t0 + 20000).post, false);

        const after = RaidHandler.onAlarm(rp, 7, t0 + 61000);
        Assert.strictEqual(after.post, true);
        Assert.strictEqual(after.suppressed, 2, 'the message says how many were left out');
    });

    Test.it('keeps the cooldown per alarm', () => {
        const rp = rustplus(false);
        RaidHandler.onAlarm(rp, 7, 1000);

        Assert.strictEqual(RaidHandler.onAlarm(rp, 8, 2000).post, true);
    });

    Test.it('mentions everyone when an alarm fires again within the escalation window', () => {
        const rp = rustplus(false);
        const t0 = 1000000;

        Assert.strictEqual(RaidHandler.onAlarm(rp, 7, t0).everyone, false);
        const second = RaidHandler.onAlarm(rp, 7, t0 + 2 * 60 * 1000);
        Assert.strictEqual(second.post, true);
        Assert.strictEqual(second.everyone, true);

        Assert.strictEqual(RaidHandler.onAlarm(rp, 7, t0 + 20 * 60 * 1000).everyone, false, 'a single one much later');
    });

    Test.it('does not mention everyone when the escalation is turned off', (t) => {
        const previous = Config.general.alarmEscalationEnabled;
        Config.general.alarmEscalationEnabled = false;
        t.after(() => { Config.general.alarmEscalationEnabled = previous; });

        const rp = rustplus(false);
        const t0 = 1000000;

        RaidHandler.onAlarm(rp, 7, t0);
        const second = RaidHandler.onAlarm(rp, 7, t0 + 2 * 60 * 1000);
        Assert.strictEqual(second.post, true);
        Assert.strictEqual(second.everyone, false);
    });

    Test.it('starts a raid when nobody is online: one direct message, a report after the quiet time', () => {
        const rp = rustplus(true);
        const t0 = 1000000;

        const first = RaidHandler.onAlarm(rp, 7, t0);
        Assert.strictEqual(first.raidStarted, true);
        Assert.strictEqual(first.directMessage, true);
        Assert.strictEqual(RaidHandler.onAlarm(rp, 8, t0 + 1000).directMessage, false, 'once per raid');

        RaidHandler.onTeamOnline(rp, 'ELMALO', t0 + 5000);
        rp.team.allOffline = false;
        RaidHandler.onAlarm(rp, 7, t0 + 120000);

        Assert.strictEqual(RaidHandler.takeFinishedRaid(rp, t0 + 120000 + RaidHandler.RAID_QUIET_MS - 1), null);
        const raid = RaidHandler.takeFinishedRaid(rp, t0 + 120000 + RaidHandler.RAID_QUIET_MS);
        Assert.deepStrictEqual(raid.alarms, { 7: 2, 8: 1 });
        Assert.deepStrictEqual(raid.cameOnline.map((e) => e.name), ['ELMALO']);
        Assert.strictEqual(RaidHandler.currentRaid(rp), null);
    });

    Test.it('no raid while someone is online, and none when raid mode is off', () => {
        Assert.strictEqual(RaidHandler.onAlarm(rustplus(false), 7, 1000).raidStarted, false);

        RaidHandler.reset();
        Config.general.raidModeEnabled = false;
        const decision = RaidHandler.onAlarm(rustplus(true), 7, 1000);
        Assert.strictEqual(decision.raidStarted, false);
        Assert.strictEqual(decision.directMessage, false);
    });

    Test.it('posts every trigger with the cooldown at 0', () => {
        Config.general.alarmCooldownSeconds = 0;
        const rp = rustplus(false);

        Assert.strictEqual(RaidHandler.onAlarm(rp, 7, 1000).post, true);
        Assert.strictEqual(RaidHandler.onAlarm(rp, 7, 1001).post, true);
    });
});
