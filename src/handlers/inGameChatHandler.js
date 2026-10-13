/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

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

const Config = require("../../config");
const Constants = require("../util/constants");
const Timer = require("../util/timer.js");
const { CHANNELS, resolveChannel } = require("../util/inGameChat.js");
const { isResponseFailure, describeResponse } = require("../util/responseUtils.js");

module.exports = {
    inGameChatHandler: async function (rustplus, client, message = null, chatChannel = null) {
        const guildId = rustplus.guildId;
        const generalSettings = rustplus.generalSettings;
        const commandDelayMs = parseInt(generalSettings.commandDelay) * 1000;
        const trademark = generalSettings.trademark;
        const trademarkString = (trademark === 'NOT SHOWING') ? '' : `${trademark} | `;
        const messageMaxLength = Constants.MAX_LENGTH_TEAM_MESSAGE - trademarkString.length;

        /* Time to write a message from the queue. If message === null, that means that its a timer call. */
        if (message === null) {
            if (rustplus.inGameChatQueue.length !== 0) {
                clearTimeout(rustplus.inGameChatTimeout);
                rustplus.inGameChatTimeout = null;

                const item = rustplus.inGameChatQueue[0];
                rustplus.inGameChatQueue = rustplus.inGameChatQueue.slice(1);

                rustplus.updateBotMessages(item.text);

                await module.exports.sendQueuedInGameMessage(rustplus, client, item);
            }
            else {
                clearTimeout(rustplus.inGameChatTimeout);
                rustplus.inGameChatTimeout = null;
            }
        }

        /* if there is a new message, add message to queue. */
        if (message !== null) {
            const channel = resolveChannel(generalSettings, chatChannel);

            if (!canSendInGameMessage(rustplus, client, channel, message)) {
                return;
            }

            if (Array.isArray(message)) {
                for (const msg of message) {
                    handleMessage(rustplus, msg, trademarkString, messageMaxLength, channel)
                }
            }
            else if (typeof message === 'string') {
                handleMessage(rustplus, message, trademarkString, messageMaxLength, channel)
            }
        }

        /* Start new timer? */
        if (rustplus.inGameChatQueue.length !== 0 && rustplus.inGameChatTimeout === null) {
            rustplus.inGameChatTimeout = setTimeout(module.exports.inGameChatHandler, commandDelayMs, rustplus, client);
        }
    },

    /* Sends a single queued in-game message and logs how the game server answered. */
    sendQueuedInGameMessage: async function (rustplus, client, item) {
        const guildId = rustplus.guildId;

        const response = (item.chatChannel === CHANNELS.CLAN) ?
            await rustplus.sendClanMessageAsync(item.text) :
            await rustplus.sendTeamMessageAsync(item.text);

        if (!isResponseFailure(response)) {
            rustplus.log(client.intlGet(guildId, 'messageCap'), item.text);
        }
        else if (isSpuriousSendError(response)) {
            /*
                Some servers answer with a spurious AppError (e.g. 'message_not_sent') even though the message
                is delivered successfully (see liamcottle/rustplus.js#31), therefore only visible in debug mode.
            */
            rustplus.log(client.intlGet(guildId, 'infoCap'),
                `Game server answered with the spurious error ${describeResponse(response)} ` +
                `for: "${item.text}"`, 'debug');
        }
        else {
            rustplus.log(client.intlGet(guildId, 'errorCap'),
                `Could not send the in-game message "${item.text}" - ${describeResponse(response)}`, 'warn');
        }

        /* Only in debug mode (RPP_DEBUG=true): prove the server side delivery of team chat messages. */
        if (Config.general.debug) {
            module.exports.verifyInGameMessageDelivery(rustplus, client, item).catch(() => undefined);
        }
    },

    /*
        Diagnostic helper, only used when RPP_DEBUG=true. It asks the game server for the recent team chat
        history (getTeamChat) and checks whether the message rustplusplus just sent is part of it. This proves
        server side delivery independently of what the in-game client renders, which allows to tell apart
        "the Rust+ API did not deliver the message" from "the client did not render it".
        The clan chat provides neither a history nor an echo broadcast, clan messages can therefore only be
        verified in-game.
    */
    verifyInGameMessageDelivery: async function (rustplus, client, item, retryDelaysMs = [1500, 3000]) {
        if (item.chatChannel === CHANNELS.CLAN) return;

        const guildId = rustplus.guildId;
        const debug = (text) => rustplus.log(client.intlGet(guildId, 'infoCap'), text, 'debug');

        let history = [];

        for (const retryDelayMs of retryDelaysMs) {
            await Timer.sleep(retryDelayMs);

            const response = await rustplus.getTeamChatAsync();
            if (isResponseFailure(response)) {
                debug(`getTeamChat request failed: ${describeResponse(response)}.`);
                return;
            }

            history = getChatMessages(response.teamChat);
            const found = history.some((e) => e.message === item.text);

            debug(`getTeamChat: ${history.length} message(s) in team chat history, ` +
                `last="${getLastMessageText(history)}", sentMessageFound=${found}.`);

            if (found) return;
        }

        debug(`In-game message "${item.text}" was NOT part of the server team chat history ` +
            `-> the Rust+ API did not deliver it.`);

        /* Show what the server actually has, so a modified/mangled message text cannot be overlooked. */
        const newest = history.slice(-5).map((e) => `"${e.message}"`).join(', ');
        debug(`Team chat history (newest ${Math.min(history.length, 5)} of ${history.length}): ${newest}`);
    },
};

/* Splits a message into parts that fit into the in-game chat and adds them to the send queue. */
function handleMessage(rustplus, message, trademarkString, maxLength, chatChannel) {
    if (typeof message !== 'string') return;

    for (const part of splitMessage(message, maxLength)) {
        rustplus.inGameChatQueue.push({
            text: `${trademarkString}${part}`,
            chatChannel: chatChannel
        });
    }
}

/* Splits a message into parts of at most maxLength characters, preferring a whitespace as the cut position. */
function splitMessage(message, maxLength) {
    const parts = [];
    let remaining = message.trim();

    while (remaining.length > maxLength) {
        let cut = remaining.lastIndexOf(' ', maxLength);
        if (cut <= 0) cut = maxLength;

        parts.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).trimStart();
    }

    if (remaining.length !== 0) parts.push(remaining);

    return parts;
}

/* The bot only writes in-game messages when it is not muted and when the target chat channel is available. */
function canSendInGameMessage(rustplus, client, channel, message) {
    const dropped = (typeof message === 'string') ? `"${message}"` : 'message(s)';

    if (rustplus.generalSettings.muteInGameBotMessages) {
        debugLog(rustplus, client, `In-game ${dropped} dropped (in-game bot messages are muted).`);
        return false;
    }

    if (channel === CHANNELS.CLAN) {
        if (!rustplus.isInClan()) {
            debugLog(rustplus, client, `In-game ${dropped} dropped (the paired account is not in a clan).`);
            return false;
        }
        return true;
    }

    if (rustplus.team === null || rustplus.team.allOffline) {
        debugLog(rustplus, client, `In-game ${dropped} dropped (no team member is online).`);
        return false;
    }

    return true;
}

/* Dropped messages are only logged in debug mode to keep the log of a normal run clean. */
function debugLog(rustplus, client, text) {
    if (Config.general.debug) {
        rustplus.log(client.intlGet(rustplus.guildId, 'infoCap'), text, 'debug');
    }
}

/* Errors that some servers return although the message was delivered anyway (see liamcottle/rustplus.js#31). */
function isSpuriousSendError(response) {
    return (typeof response === 'object') && response !== null && `${response.error}` === 'message_not_sent';
}

function getChatMessages(chat) {
    if (!chat || !Array.isArray(chat.messages)) return [];
    return chat.messages;
}

function getLastMessageText(messages) {
    return (messages.length !== 0) ? messages[messages.length - 1].message : '';
}
