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
const Fs = require('fs');
const Os = require('os');
const Path = require('path');
const Test = require('node:test');

const DeathLog = require('../src/util/deathLog.js');
const DeathMap = require('../src/util/deathMap.js');
const ForcedWipe = require('../src/util/forcedWipe.js');
const SwitchTimeouts = require('../src/util/switchTimeouts.js');
const TeamStats = require('../src/util/teamStats.js');
const WipeHelper = require('../src/handlers/wipeHelper.js');

function fakeClient(server = {}) {
    const instance = { serverList: { server: Object.assign({ title: 'CQ' }, server) } };
    let writes = 0;
    return {
        instance: instance,
        writes: () => writes,
        getInstance: () => instance,
        setInstance: () => { writes += 1; },
        intlGet: (guildId, key) => key,
        log: () => undefined,
    };
}

Test.describe('team stats', () => {
    Test.afterEach(() => TeamStats.reset());

    Test.it('knows the ISO week', () => {
        Assert.strictEqual(TeamStats.weekKey(new Date('2026-11-18T12:00:00Z'), 'UTC'), '2026-W47');
        Assert.strictEqual(TeamStats.weekKey(new Date('2027-01-01T12:00:00Z'), 'UTC'), '2026-W53');
        Assert.strictEqual(TeamStats.weekKey(new Date('2026-01-01T12:00:00Z'), 'UTC'), '2026-W01');
        /* Sunday 23:30 UTC is already Monday in Berlin. */
        Assert.strictEqual(TeamStats.weekKey(new Date('2026-11-22T23:30:00Z'), 'Europe/Berlin'), '2026-W48');
    });

    Test.it('adds online time between polls, at most a minute per poll, and counts sessions and deaths', () => {
        const client = fakeClient();
        const members = [{ steamId: '1', name: 'Hardy', isOnline: true }, { steamId: '2', name: 'ELMALO', isOnline: false }];
        const t0 = new Date('2026-11-18T12:00:00Z').getTime();

        TeamStats.tick(client, 'guild', 'server', members, t0);
        TeamStats.tick(client, 'guild', 'server', members, t0 + 10000);
        TeamStats.tick(client, 'guild', 'server', members, t0 + 10000 + 10 * 60000);
        TeamStats.noteSession(client, 'guild', 'server', '2', 'ELMALO', new Date(t0));
        TeamStats.noteDeath(client, 'guild', 'server', '1', 'Hardy', new Date(t0));

        const stats = client.instance.serverList.server.teamStats;
        Assert.strictEqual(stats.players['1'].onlineMs, 10000 + TeamStats.MAX_TICK_MS, 'a pause is no online time');
        Assert.strictEqual(stats.players['2'].onlineMs, 0);
        Assert.strictEqual(stats.players['2'].sessions, 1);
        Assert.strictEqual(stats.players['1'].deaths, 1);
        Assert.deepStrictEqual(TeamStats.ranking(stats).map((p) => p.name), ['Hardy', 'ELMALO']);
    });

    Test.it('returns the finished week once when the week changes', () => {
        const client = fakeClient();
        const members = [{ steamId: '1', name: 'Hardy', isOnline: true }];
        const monday = new Date('2026-11-23T00:00:30Z').getTime();

        Assert.strictEqual(TeamStats.tick(client, 'guild', 'server', members, monday - 60000), null);
        const finished = TeamStats.tick(client, 'guild', 'server', members, monday);

        Assert.strictEqual(finished.week, '2026-W47');
        Assert.strictEqual(client.instance.serverList.server.teamStats.week, '2026-W48');
        Assert.strictEqual(TeamStats.tick(client, 'guild', 'server', members, monday + 10000), null, 'only once');
    });

    Test.it('starts the new week on a session or death too and still reports the finished one', () => {
        const client = fakeClient();
        const members = [{ steamId: '1', name: 'Hardy', isOnline: true }];
        const monday = new Date('2026-11-23T00:00:30Z').getTime();
        TeamStats.tick(client, 'guild', 'server', members, monday - 60000);

        TeamStats.noteDeath(client, 'guild', 'server', '1', 'Hardy', new Date(monday));
        TeamStats.noteSession(client, 'guild', 'server', '2', 'ELMALO', new Date(monday + 1000));

        const server = client.instance.serverList.server;
        Assert.strictEqual(server.teamStats.week, '2026-W48');
        Assert.strictEqual(server.teamStats.players['1'].deaths, 1, 'the death counts into the new week');
        Assert.strictEqual(server.teamStats.players['2'].sessions, 1);

        const finished = TeamStats.tick(client, 'guild', 'server', members, monday + 10000);
        Assert.strictEqual(finished.week, '2026-W47');
        Assert.strictEqual(finished.players['1'].deaths, 0);
        Assert.strictEqual(server.teamStats.players['1'].deaths, 1, 'the poll keeps the new week');
        Assert.strictEqual(TeamStats.tick(client, 'guild', 'server', members, monday + 20000), null, 'only once');
    });
});

Test.describe('death log and death map', () => {
    Test.it('keeps the deaths with a position and filters them by player and age', () => {
        const client = fakeClient();
        DeathLog.add(client, 'guild', 'server', { steamId: '1', name: 'Hardy', x: 100, y: 200, grid: 'G7', atMs: 1000 });
        DeathLog.add(client, 'guild', 'server', { steamId: '2', name: 'ELMALO', x: 300, y: 400, atMs: 5000 });
        DeathLog.add(client, 'guild', 'server', { steamId: '2', name: 'ELMALO', x: NaN, y: 1 });

        const server = client.instance.serverList.server;
        Assert.strictEqual(DeathLog.list(server).length, 2, 'no position, no entry');
        Assert.strictEqual(DeathLog.list(server, { player: 'elm' }).length, 1);
        Assert.strictEqual(DeathLog.list(server, { sinceMs: 2000 }).length, 1);
    });

    Test.it('converts world positions to pixels like the map markers', () => {
        /* 4000 m map on a 2000 px image with a 500 px ocean margin: the centre stays the centre. */
        Assert.deepStrictEqual(DeathMap.toImage(2000, 2000, 2000, 2000, 500, 4000), { x: 1000, y: 1000 });
        Assert.deepStrictEqual(DeathMap.toImage(0, 0, 2000, 2000, 500, 4000), { x: 500, y: 1500 });
    });

    Test.it('renders red marks onto the clean map', async () => {
        const { Jimp, intToRGBA } = require('jimp');
        const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'deathmap-'));
        const source = Path.join(dir, 'clean.png');
        const target = Path.join(dir, 'death.jpg');
        await new Jimp({ width: 200, height: 200, color: 0x204020ff }).write(source);

        const rustplus = { guildId: 'guild', info: { mapSize: 1000 }, map: { width: 200, height: 200, oceanMargin: 0 } };
        const path = await DeathMap.render(rustplus, [{ x: 500, y: 500 }], { source: source, target: target });

        const image = await Jimp.read(path);
        const centre = intToRGBA(image.getPixelColor(100, 100));
        Assert.ok(centre.r > 150 && centre.g < 90, `the centre is red: ${JSON.stringify(centre)}`);
        Fs.rmSync(dir, { recursive: true, force: true });
    });
});

Test.describe('forced wipe', () => {
    Test.it('is the first Thursday of the month at 19:00 London time', () => {
        /* December 2026: Thursday the 3rd, winter time -> 19:00 UTC. */
        Assert.strictEqual(ForcedWipe.wipeOfMonth(2026, 11).toISOString(), '2026-12-03T19:00:00.000Z');
        /* July 2026: Thursday the 2nd, summer time -> 18:00 UTC. */
        Assert.strictEqual(ForcedWipe.wipeOfMonth(2026, 6).toISOString(), '2026-07-02T18:00:00.000Z');
    });

    Test.it('gives the next one after now, across the year end', () => {
        Assert.strictEqual(ForcedWipe.next(new Date('2026-11-18T12:00:00Z')).toISOString(), '2026-12-03T19:00:00.000Z');
        Assert.strictEqual(ForcedWipe.next(new Date('2026-12-03T19:00:01Z')).toISOString(), '2027-01-07T19:00:00.000Z');
    });
});

Test.describe('wipe helper', () => {
    Test.afterEach(() => SwitchTimeouts.reset());

    Test.it('clears what belonged to the old map and counts the devices', (t) => {
        const Client = require('../src/structures/clientRegistry.js');
        const client = fakeClient({
            switches: { 1: {}, 2: {} }, alarms: { 3: {} },
            storageMonitors: { 4: { upkeepWarned: true, alerts: [{ triggered: true }] } },
            switchGroups: { 5: {} },
            deathLog: [{ steamId: '1', name: 'x', x: 1, y: 1, atMs: 1 }],
        });
        const previous = Client.client;
        Client.client = client;
        t.after(() => { Client.client = previous; });

        SwitchTimeouts.schedule('guild', 'server', 'group-5', 60000, { kind: 'group', id: '5', value: false },
            async () => undefined);

        const counts = WipeHelper.clearOldMap(client, 'guild', 'server');
        const server = client.instance.serverList.server;

        Assert.deepStrictEqual(counts, { switches: 2, alarms: 1, storageMonitors: 1, groups: 1 });
        Assert.deepStrictEqual(server.deathLog, []);
        Assert.deepStrictEqual(server.pendingTimers, {});
        Assert.strictEqual(SwitchTimeouts.getEnd('guild', 'server', 'group-5'), null);
        Assert.strictEqual(server.storageMonitors[4].upkeepWarned, false);
        Assert.strictEqual(server.storageMonitors[4].alerts[0].triggered, false);
    });
});

Test.describe('new slash commands', () => {
    const en = require('../src/languages/en.json');
    const client = { intlGet: (guildId, key) => en[key] || key };

    for (const name of ['status', 'teamstats', 'deathmap']) {
        Test.it(`/${name} is a valid command definition`, () => {
            const json = require(`../src/commands/${name}.js`).getSlashCommandDefinition(client, 'guild').toJSON();
            Assert.strictEqual(json.name, name);
            Assert.ok(json.description.length > 0 && json.description.length <= 100);
        });
    }
});
