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

/*
    The name and the message of a smart alarm come from the push of the game (the text the Rust+ app shows), unless
    they were set in Discord.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const AlarmTexts = require('../src/util/alarmTexts.js');
const Client = require('../src/structures/clientRegistry.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const RustPlusPushNotifications = require('../src/util/rustplusPushNotifications.js');

const STEAM_ID = '76561198000000400';
const SERVER_ID = '06b8fbcf-3eed-45fc-9678-66a3b5b35973';

Test.describe('AlarmTexts', () => {
    Test.it('knows the default texts of the bot in every language', () => {
        Assert.strictEqual(AlarmTexts.isDefaultName('Smart Alarm'), true);
        Assert.strictEqual(AlarmTexts.isDefaultName('Intelligenter Alarm'), true);
        Assert.strictEqual(AlarmTexts.isDefaultName(''), true);
        Assert.strictEqual(AlarmTexts.isDefaultName('Base'), false);

        Assert.strictEqual(AlarmTexts.isDefaultMessage('Your base is under attack!'), true);
        Assert.strictEqual(AlarmTexts.isDefaultMessage('Deine Basis wird angegriffen!'), true);
        Assert.strictEqual(AlarmTexts.isDefaultMessage('TC Raum offen'), false);
    });

    Test.it('takes the texts of the game into an alarm that still has the defaults, and keeps following the game', () => {
        const alarm = { name: 'Smart Alarm', message: 'Deine Basis wird angegriffen!' };

        Assert.deepStrictEqual(AlarmTexts.applyFromPush(alarm, 'Haupttür', 'Raid an der Haupttür'), ['name', 'message']);
        Assert.strictEqual(alarm.name, 'Haupttür');
        Assert.strictEqual(alarm.message, 'Raid an der Haupttür');

        Assert.deepStrictEqual(AlarmTexts.applyFromPush(alarm, 'Haupttür', 'Raid an der Haupttür'), [], 'unchanged');
        Assert.deepStrictEqual(AlarmTexts.applyFromPush(alarm, 'Hintertür', 'Raid an der Hintertür'),
            ['name', 'message'], 'renamed in game');
        Assert.strictEqual(alarm.name, 'Hintertür');
    });

    Test.it('keeps a text that was set in Discord, field by field', () => {
        const alarm = { name: 'Smart Alarm', message: 'Your base is under attack!' };
        AlarmTexts.applyFromPush(alarm, 'Haupttür', 'Raid an der Haupttür');

        /* The edit form changes only the message. */
        AlarmTexts.markEditedInDiscord(alarm, 'Haupttür', 'Eigene Nachricht');
        alarm.message = 'Eigene Nachricht';

        Assert.deepStrictEqual(AlarmTexts.applyFromPush(alarm, 'Tür', 'Text aus dem Spiel'), ['name']);
        Assert.strictEqual(alarm.name, 'Tür');
        Assert.strictEqual(alarm.message, 'Eigene Nachricht');
    });

    Test.it('keeps a text set in Discord also when it equals a default of the bot, or the game renames later', () => {
        const alarm = { name: 'Raid', message: 'Die Base wird weggeballert!!!!', nameFromGame: true, messageFromGame: true };

        AlarmTexts.markEditedInDiscord(alarm, 'Smart Alarm', 'Deine Basis wird angegriffen!');
        alarm.name = 'Smart Alarm';
        alarm.message = 'Deine Basis wird angegriffen!';

        Assert.deepStrictEqual(AlarmTexts.applyFromPush(alarm, 'Neu im Spiel', 'Neue Nachricht im Spiel'), []);
        Assert.strictEqual(alarm.name, 'Smart Alarm');
        Assert.strictEqual(alarm.message, 'Deine Basis wird angegriffen!');
    });

    Test.it('a form saved without changes leaves the texts to the game', () => {
        const alarm = { name: 'Raid', message: 'Weg', nameFromGame: true, messageFromGame: true };

        AlarmTexts.markEditedInDiscord(alarm, 'Raid', 'Weg');

        Assert.deepStrictEqual(AlarmTexts.applyFromPush(alarm, 'Tür', 'Auf'), ['name', 'message']);
    });

    Test.it('ignores an empty title or message', () => {
        const alarm = { name: 'Smart Alarm', message: 'Your base is under attack!' };

        Assert.deepStrictEqual(AlarmTexts.applyFromPush(alarm, '  ', ''), []);
        Assert.strictEqual(alarm.name, 'Smart Alarm');
    });
});

Test.describe('alarm push: texts of the game', () => {
    /* The socket of the connected server reported the trigger just now. */
    function setup(t, alarm) {
        const instance = {
            activeServer: `relay-${SERVER_ID}`,
            channelId: { activity: 'activity-channel' },
            serverList: { [`relay-${SERVER_ID}`]: { title: 'Server', guid: SERVER_ID, steamId: STEAM_ID,
                alarms: { 123: Object.assign({ lastTrigger: Math.floor(Date.now() / 1000) }, alarm) } } },
        };
        const rustplus = { serverId: `relay-${SERVER_ID}`, isOperational: true };
        const client = {
            logs: [],
            saved: 0,
            instances: { guild: {} },
            rustplusInstances: { guild: rustplus },
            intlGet: (guildId, key) => key,
            log: (cap, text) => client.logs.push(text),
            getInstance: () => instance,
            setInstance: () => { client.saved += 1; },
        };
        const cards = t.mock.method(DiscordMessages, 'sendSmartAlarmMessage', async () => undefined);

        return { instance, client, cards };
    }

    /* As the game sends it (seen live): the body names the server, not the alarm. */
    function alarmPush(title, message) {
        return RustPlusPushNotifications.parse({
            persistentId: 'p-1',
            appData: [
                { key: 'channelId', value: 'alarm' },
                { key: 'title', value: title },
                { key: 'message', value: message },
                { key: 'body', value: JSON.stringify({ type: 'alarm', id: SERVER_ID }) },
            ],
        });
    }

    Test.it('names the alarm and its message as the game does and updates its message in Discord', async (t) => {
        const { instance, client, cards } = setup(t, { name: 'Smart Alarm', message: 'Deine Basis wird angegriffen!' });

        const scheduled = [];
        await RustPlusPushNotifications.handle(client, STEAM_ID, alarmPush('Haupttür', 'Raid an der Haupttür'),
            { schedule: (fn) => scheduled.push(fn) });

        /* Taken at once, before the grace time: the socket may post the trigger right after the push. */
        const alarm = instance.serverList[`relay-${SERVER_ID}`].alarms[123];
        Assert.strictEqual(alarm.name, 'Haupttür', 'before the grace time');

        await scheduled[0]();
        await new Promise((resolve) => setImmediate(resolve));
        Assert.strictEqual(alarm.name, 'Haupttür');
        Assert.strictEqual(alarm.message, 'Raid an der Haupttür');
        Assert.strictEqual(cards.mock.callCount(), 1);
        Assert.ok(client.logs.some((text) => text.includes('takes its name and message from the game')));
    });

    Test.it('leaves an alarm alone whose texts were set in Discord', async (t) => {
        const { instance, client, cards } = setup(t, { name: 'Base', message: 'raid' });

        await RustPlusPushNotifications.handle(client, STEAM_ID, alarmPush('Haupttür', 'Raid an der Haupttür'),
            { schedule: () => undefined });

        const alarm = instance.serverList[`relay-${SERVER_ID}`].alarms[123];
        Assert.strictEqual(alarm.name, 'Base');
        Assert.strictEqual(alarm.message, 'raid');
        Assert.strictEqual(cards.mock.callCount(), 0);
    });

    Test.it('leaves an alarm alone whose texts were set in Discord, also after the grace time', async (t) => {
        const { instance, client, cards } = setup(t, { name: 'Base', message: 'raid' });
        const scheduled = [];

        await RustPlusPushNotifications.handle(client, STEAM_ID, alarmPush('Haupttür', 'Raid an der Haupttür'),
            { schedule: (fn) => scheduled.push(fn) });
        await scheduled[0]();

        Assert.strictEqual(instance.serverList[`relay-${SERVER_ID}`].alarms[123].name, 'Base');
        Assert.strictEqual(cards.mock.callCount(), 0);
    });
});

Test.describe('alarm push: which alarm it is about', () => {
    const push = (title, entityId) => ({ title: title, message: 'x', body: entityId === undefined ? {} : { entityId } });
    const server = (alarms) => ({ alarms: alarms });

    Test.it('takes the entityId, else the only alarm of the server', () => {
        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server({ 1: {}, 2: {} }), push('a', 2)), '2');
        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server({ 7: { name: 'Smart Alarm' } }), push('Tür')), '7');
        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server({}), push('Tür')), null);
    });

    Test.it('tells several alarms apart by the name, else by the trigger the socket reported', () => {
        const alarms = { 1: { name: 'Haupttür', lastTrigger: 1000 }, 2: { name: 'Smart Alarm', lastTrigger: 5000 } };

        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server(alarms), push('Haupttür')), '1');
        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server(alarms), push('Hintertür')), null,
            'no name and no trigger time');
        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server(alarms), push('Hintertür'), 5010), '2');
        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server(alarms), push('Hintertür'), 9000), null);

        const both = { 1: { name: 'Smart Alarm', lastTrigger: 5000 }, 2: { name: 'Smart Alarm', lastTrigger: 5005 } };
        Assert.strictEqual(RustPlusPushNotifications.alarmOfPush(server(both), push('Hintertür'), 5002), null,
            'two alarms fired together');
    });
});

Test.describe('alarm trigger message: texts that arrive a moment later', () => {
    function setup(t) {
        const alarm = { name: 'Smart Alarm', message: 'Deine Basis wird angegriffen!', location: null, image: 'smart_alarm.png',
            server: 'Server', everyone: false };
        const instance = { channelId: { activity: 'activity' }, serverList: { server: { alarms: { 7: alarm } } } };
        const previous = Client.client;
        Client.client = { getInstance: () => instance, intlGet: (guildId, key) => key };
        t.after(() => { Client.client = previous; });

        const sent = [];
        const sendMessage = t.mock.method(DiscordMessages, 'sendMessage', async (guildId, content, messageId) => {
            sent.push({ messageId: messageId, title: content.embeds[0].data.title });
            return { id: messageId || `m${sent.length}` };
        });

        return { alarm, sent, sendMessage };
    }

    Test.it('edits the trigger message when the push brings the texts after it was posted', async (t) => {
        const { alarm, sent } = setup(t);

        await DiscordMessages.sendSmartAlarmTriggerMessage('guild', 'server', '7');
        alarm.name = 'roflrofl';
        Assert.strictEqual(await DiscordMessages.refreshSmartAlarmTriggerMessage('guild', 'server', '7'), true);

        Assert.deepStrictEqual(sent, [{ messageId: null, title: 'Smart Alarm' }, { messageId: 'm1', title: 'roflrofl' }]);
    });

    Test.it('edits it right away when the texts changed while it was posted', async (t) => {
        const { alarm, sent, sendMessage } = setup(t);
        sendMessage.mock.mockImplementationOnce(async (guildId, content) => {
            sent.push({ messageId: null, title: content.embeds[0].data.title });
            alarm.name = 'roflrofl';
            return { id: 'm1' };
        });

        await DiscordMessages.sendSmartAlarmTriggerMessage('guild', 'server', '7');

        Assert.deepStrictEqual(sent, [{ messageId: null, title: 'Smart Alarm' }, { messageId: 'm1', title: 'roflrofl' }]);
    });

    Test.it('does not edit the post of the trigger before when the post of this one is still on its way', async (t) => {
        const { alarm, sent } = setup(t);

        await DiscordMessages.sendSmartAlarmTriggerMessage('guild', 'server', '7');
        alarm.name = 'roflrofl';

        /* The push of a later trigger: its post is not there yet, the one above is from before it. */
        Assert.strictEqual(await DiscordMessages.refreshSmartAlarmTriggerMessage('guild', 'server', '7',
            { sinceMs: Date.now() + 1000 }), false);
        Assert.strictEqual(sent.length, 1);
    });

    Test.it('leaves an old trigger message alone', async (t) => {
        const { sent } = setup(t);

        await DiscordMessages.sendSmartAlarmTriggerMessage('guild', 'server', '7');
        Assert.strictEqual(await DiscordMessages.refreshSmartAlarmTriggerMessage('guild', 'server', '7', { maxAgeMs: -1 }), false);
        Assert.strictEqual(sent.length, 1);
    });
});
