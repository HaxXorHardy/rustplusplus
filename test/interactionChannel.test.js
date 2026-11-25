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

const Discord = require('discord.js');
const InteractionCreate = require('../src/discordEvents/interactionCreate.js');

Test.describe('interactions from outside the bot channels', () => {
    const instance = { channelId: { category: 'cat', switches: 'sw', settings: 'set' } };
    const component = (channelId, ephemeral = false) => ({
        channelId: channelId,
        isMessageComponent: () => true,
        message: { flags: new Discord.MessageFlagsBitField(ephemeral ? Discord.MessageFlags.Ephemeral : 0) },
    });

    Test.it('refuses a button on a message in another channel', () => {
        Assert.strictEqual(InteractionCreate.isFromForeignChannel(instance, component('general')), true);
    });

    Test.it('accepts a button in a bot channel', () => {
        Assert.strictEqual(InteractionCreate.isFromForeignChannel(instance, component('sw')), false);
    });

    Test.it('accepts an ephemeral reply to a slash command in any channel (the login chooser)', () => {
        Assert.strictEqual(InteractionCreate.isFromForeignChannel(instance, component('general', true)), false);
    });

    Test.it('leaves slash commands and modal submits to their own checks', () => {
        const command = { channelId: 'general', isMessageComponent: () => false };
        Assert.strictEqual(InteractionCreate.isFromForeignChannel(instance, command), false);
    });

    Test.it('ignores an interaction without a guild instead of throwing', async () => {
        const client = { getInstance: () => undefined };
        await Assert.doesNotReject(InteractionCreate.execute(client, { guildId: null }));
    });
});
