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

const Client = require('../structures/clientRegistry.js');
const DiscordTools = require('../discordTools/discordTools.js');
const LogLevels = require('./logLevels.js');

/*
    Mirrors the log lines of a guild into its server-log Discord channel.

    The channel is resolved on every flush from the instance (no caching of channel ids or channel objects):
    /reset discord deletes the channel and SetupGuildChannels writes the id of the new one into the instance,
    so the next batch automatically goes into the recreated channel.

    Sending is batched and rate limited: Discord accepts a handful of messages per channel per few seconds and a
    reconnect loop can produce many lines in a short time. Once the queue is full the oldest lines are dropped
    and the channel is told how many lines were lost instead of growing without a bound.
*/

/* Discord allows 2000 characters, the rest is room for the fence and the dropped-lines note. */
const MAX_MESSAGE_CHARACTERS = 1800;
const MAX_LINES_PER_MESSAGE = 10;
const MAX_QUEUED_LINES = 500;

/* Defaults, see configure() - the tests shorten them to keep the suite fast. */
const timing = {
    flushDelayMs: 500,
    minSendIntervalMs: 1000,
    /* Upper limit of the retry delay after failed sends, it doubles with every failure in a row. */
    maxRetryDelayMs: 5 * 60 * 1000,
};

/*
    Discord answers that the bot cannot post into the channel (missing access/permissions) or that the channel does not
    exist. Retrying cannot help and every rejected request counts against the invalid request limit of Cloudflare.
*/
const ACCESS_ERROR_STATUSES = new Set([403, 404]);
const ACCESS_ERROR_CODES = new Set([10003 /* Unknown Channel */, 50001 /* Missing Access */,
    50013 /* Missing Permissions */]);

/**
 * One queue per guild.
 * @typedef {Object} GuildQueue
 * @property {string[]} lines Lines waiting for the channel.
 * @property {number} dropped Number of lines dropped since the last send.
 * @property {number} generation Bumped by reset(), stale flushes exit on it.
 * @property {boolean} sending True while a flush is sending.
 * @property {number} lastSendAt Timestamp of the last message, used for the rate limit.
 * @property {*} timer Pending flush timer.
 * @property {number} failures Failed sends in a row, the retry delay grows with it.
 * @property {number} retryAt No flush before this timestamp (backoff after a failed send).
 * @property {(string|null)} blockedChannelId Channel that rejected the bot, nothing is queued for it until the
 *   channel changes or the guild is set up again (resume()).
 */

/** @type {Map<string, GuildQueue>} */
const queues = new Map();

/**
 * @param {string} guildId
 * @returns {GuildQueue}
 */
function getQueue(guildId) {
    let queue = queues.get(guildId);

    if (!queue) {
        queue = {
            lines: [],
            dropped: 0,
            generation: 0,
            sending: false,
            lastSendAt: 0,
            timer: null,
            failures: 0,
            retryAt: 0,
            blockedChannelId: null,
        };
        queues.set(guildId, queue);
    }

    return queue;
}

/**
 * Add a log line to the queue of a guild.
 * @param {string} guildId
 * @param {string} line Complete line, the caller formats it (the Logger passes its own timestamp).
 * @param {string} level Level the line was logged with.
 * @returns {void}
 */
function push(guildId, line, level = 'info') {
    if (!guildId || typeof line !== 'string') return;

    if (!LogLevels.allowsLevel(getLogLevel(guildId), level)) return;

    enqueue(guildId, line);
}

/**
 * Add a lifecycle marker (bot started, channels recreated). It is not a log line, so it ignores the filter of
 * the error and info levels, but an explicitly switched off channel stays silent.
 * @param {string} guildId
 * @param {string} text Message without timestamp.
 * @returns {void}
 */
function pushStartLine(guildId, text) {
    if (!guildId || typeof text !== 'string') return;

    if (LogLevels.isOff(getLogLevel(guildId))) return;

    enqueue(guildId, `${formatTime()} | ${text}`);
}

/**
 * @param {string} guildId
 * @param {string} line
 * @returns {void}
 */
function enqueue(guildId, line) {
    const queue = getQueue(guildId);

    if (queue.blockedChannelId !== null) {
        /* A new channel id in the instance (setup, /reset discord) is a new configuration, try it again. */
        if (getChannelId(guildId) === queue.blockedChannelId) return;
        queue.blockedChannelId = null;
        queue.failures = 0;
        queue.retryAt = 0;
    }

    queue.lines.push(prepareLine(line));

    /* Drop the oldest lines, the newest ones describe the current state of the bot. */
    while (queue.lines.length > MAX_QUEUED_LINES) {
        queue.lines.shift();
        queue.dropped++;
    }

    schedule(guildId);
}

/**
 * Forget everything that is still queued for a guild, for example because /reset discord is about to delete the
 * channel. A flush that is already sending notices the new generation and stops.
 * @param {string} guildId
 * @returns {void}
 */
function reset(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return;

    queue.generation++;
    queue.lines = [];
    queue.dropped = 0;
    queue.lastSendAt = 0;
    queue.failures = 0;
    queue.retryAt = 0;
    queue.blockedChannelId = null;

    if (queue.timer !== null) {
        clearTimeout(queue.timer);
        queue.timer = null;
    }
}

/**
 * The guild was set up again (setupGuild): a channel that rejected the bot may have its permissions back, post into
 * it again. What is queued stays queued.
 * @param {string} guildId
 * @returns {void}
 */
function resume(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return;

    queue.blockedChannelId = null;
    queue.failures = 0;
    queue.retryAt = 0;
}

/**
 * Send what is queued for every guild, used on shutdown. A guild that is waiting for its retry is skipped.
 * @returns {Promise<void>}
 */
async function flushAll() {
    const flushes = [];

    for (const [guildId, queue] of queues) {
        if (queue.lines.length === 0 || queue.retryAt > Date.now()) continue;

        if (queue.timer !== null) {
            clearTimeout(queue.timer);
            queue.timer = null;
        }

        flushes.push(flush(guildId, queue));
    }

    await Promise.all(flushes);
}

/**
 * Send what is queued right now, used by the tests. The normal path is the timer scheduled by enqueue().
 * @param {string} guildId
 * @returns {Promise<void>}
 */
async function flushNow(guildId) {
    const queue = queues.get(guildId);
    if (!queue) return;

    await flush(guildId, queue);
}

/**
 * @param {string} guildId
 * @param {number} delay Delay until the flush, defaults to the debounce delay.
 * @returns {void}
 */
function schedule(guildId, delay = timing.flushDelayMs) {
    const queue = getQueue(guildId);
    if (queue.timer !== null || queue.sending) return;

    /* After a failed send no new line brings the retry forward. */
    delay = Math.max(delay, queue.retryAt - Date.now());

    queue.timer = setTimeout(() => {
        queue.timer = null;
        flush(guildId, queue);
    }, delay);

    /* A timer must never keep the process (or the test runner) alive. */
    if (typeof queue.timer.unref === 'function') queue.timer.unref();
}

/**
 * @param {string} guildId
 * @param {GuildQueue} queue
 * @returns {Promise<void>}
 */
async function flush(guildId, queue) {
    if (queue.sending) return;

    const generation = queue.generation;
    queue.sending = true;
    let retry = false;

    try {
        while (queue.lines.length > 0 && queue.generation === generation) {
            const channel = getChannel(guildId);
            if (!channel) {
                /*
                    The channel is gone (deleted by hand or by /reset discord). Drop the lines instead of
                    queueing them forever; the id in the instance is fixed by the next setup or reset and the
                    following lines are posted again.
                */
                queue.lines = [];
                return;
            }

            await waitForRateLimit(queue);
            if (queue.generation !== generation) return;

            const batch = buildMessage(guildId, queue);
            let sendError = null;
            const message = await Client.client.messageSend(channel, { content: batch.content },
                { onError: (e) => { sendError = e; } });

            /*
                messageSend() reports the failure and returns undefined. The lines of the batch are only removed
                after a successful send, so a failed send loses nothing and is retried - later with every failure
                in a row. A channel the bot cannot post into is not asked again: the lines are dropped and nothing
                is queued for it until the configuration changes.
            */
            if (!message) {
                if (queue.generation !== generation) return;

                if (isAccessError(sendError)) {
                    queue.lines = [];
                    queue.dropped = 0;
                    queue.blockedChannelId = `${channel.id}`;
                    logWarning(`The server-log channel of guild ${guildId} rejected the bot ` +
                        `(${sendError.status ?? ''} ${sendError.code ?? ''}), no log lines are posted until the ` +
                        'channel or its permissions are set up again.');
                    return;
                }

                queue.failures++;
                queue.retryAt = Date.now() + getRetryDelay(queue.failures);
                retry = true;
                return;
            }

            queue.failures = 0;
            queue.retryAt = 0;

            /*
                A reset() (for example /reset discord) during the send cleared the queue already, its lines and
                the drop counter belong to the deleted channel.
            */
            if (queue.generation === generation) {
                queue.lines.splice(0, batch.count);
                queue.dropped -= batch.dropped;
            }

            queue.lastSendAt = Date.now();
        }
    }
    catch (e) {
        /* Posting log lines is an optional side effect: report the failure instead of taking the bot down. */
        logWarning(`The server-log relay failed: ${e}`);
    }
    finally {
        queue.sending = false;

        /* Scheduled after `sending` is cleared, schedule() ignores a queue that is still sending. */
        if (retry && queue.lines.length > 0) {
            if (queue.timer !== null) {
                clearTimeout(queue.timer);
                queue.timer = null;
            }
            schedule(guildId, 0);
        }
    }
}

/**
 * @param {number} failures Failed sends in a row (1 or more).
 * @returns {number} Delay until the next attempt: doubles with every failure, capped at maxRetryDelayMs.
 */
function getRetryDelay(failures) {
    const delay = timing.minSendIntervalMs * Math.pow(2, Math.min(failures, 20));

    return Math.min(delay, timing.maxRetryDelayMs);
}

/**
 * @param {*} error The error messageSend() reported, null when it reported none.
 * @returns {boolean} True when Discord said the bot cannot post into the channel or the channel is unknown.
 */
function isAccessError(error) {
    if (!error) return false;

    return ACCESS_ERROR_STATUSES.has(error.status) || ACCESS_ERROR_CODES.has(error.code);
}

/**
 * Report into the bot log (not a guild log, which would feed this relay again).
 * @param {string} text
 * @returns {void}
 */
function logWarning(text) {
    const client = Client.client;
    if (client && typeof client.log === 'function') {
        client.log(client.intlGet(null, 'warningCap'), text, 'warn');
    }
}

/**
 * @param {GuildQueue} queue
 * @returns {Promise<void>}
 */
async function waitForRateLimit(queue) {
    if (queue.lastSendAt === 0) return;

    const wait = timing.minSendIntervalMs - (Date.now() - queue.lastSendAt);
    if (wait <= 0) return;

    await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Build one message out of the queued lines without removing them: they are only dropped from the queue after
 * the message was sent successfully.
 * @param {string} guildId
 * @param {GuildQueue} queue
 * @returns {{content: string, count: number, dropped: number}} The message, the number of lines it contains and
 *   the number of dropped lines that were reported in it.
 */
function buildMessage(guildId, queue) {
    const lines = [];
    let characters = 0;

    while (lines.length < queue.lines.length && lines.length < MAX_LINES_PER_MESSAGE) {
        const line = queue.lines[lines.length];
        const length = line.length + 1;

        /* Always take one line, even when it is longer than the limit (it is cut in prepareLine()). */
        if (lines.length > 0 && (characters + length) > MAX_MESSAGE_CHARACTERS) break;

        lines.push(line);
        characters += length;
    }

    const dropped = (queue.dropped > 0) ? queue.dropped : 0;
    if (dropped > 0) {
        lines.push(getIntlText(guildId, 'serverLogLinesDropped', { count: dropped }));
    }

    return {
        content: '```\n' + lines.join('\n') + '\n```',
        count: lines.length - ((dropped > 0) ? 1 : 0),
        dropped: dropped,
    };
}

/**
 * Keep a line inside the message limit and neutralise backticks so a log line cannot close the code block.
 * @param {string} line
 * @returns {string}
 */
function prepareLine(line) {
    const cleaned = line.replace(/`/g, "'").replace(/\r?\n/g, ' ');

    if (cleaned.length <= MAX_MESSAGE_CHARACTERS) return cleaned;

    return `${cleaned.substring(0, MAX_MESSAGE_CHARACTERS - 3)}...`;
}

/**
 * @param {string} guildId
 * @returns {*|null} The server-log channel of the guild, or null when it does not exist (yet).
 */
function getChannel(guildId) {
    const channelId = getChannelId(guildId);
    if (channelId === null) return null;

    return DiscordTools.getTextChannelById(guildId, channelId);
}

/**
 * @param {string} guildId
 * @returns {(string|null)} The id of the server-log channel in the instance, null when there is none.
 */
function getChannelId(guildId) {
    const client = Client.client;
    if (!client || typeof client.getInstance !== 'function') return null;

    const instance = client.getInstance(guildId);
    if (!instance || !instance.channelId) return null;

    /* Old instances have no log id until createInstanceFile() migrated them. */
    const channelId = instance.channelId.log ?? null;

    return channelId === null ? null : `${channelId}`;
}

/**
 * @param {string} guildId
 * @returns {string} The configured level, DEFAULT_LOG_LEVEL when the instance has none.
 */
function getLogLevel(guildId) {
    const client = Client.client;
    if (!client || typeof client.getInstance !== 'function') return LogLevels.DEFAULT_LOG_LEVEL;

    const instance = client.getInstance(guildId);
    if (!instance || !instance.generalSettings) return LogLevels.DEFAULT_LOG_LEVEL;

    return LogLevels.normalizeLogLevel(instance.generalSettings.serverLogLevel);
}

/**
 * @param {string} guildId
 * @param {string} id Translation id.
 * @param {Object} [variables]
 * @returns {string} The translated text, or the id when there is no client (tests).
 */
function getIntlText(guildId, id, variables = {}) {
    const client = Client.client;
    if (!client || typeof client.intlGet !== 'function') return id;

    return client.intlGet(null, id, variables);
}

/**
 * @param {Date} [date]
 * @returns {string} Timestamp in the format the Logger uses.
 */
function formatTime(date = new Date()) {
    const pad = (value) => `${value}`.padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Timing knobs. The defaults fit the Discord rate limit, the tests shorten them so the suite stays fast.
 * @param {{flushDelayMs: (number|undefined), minSendIntervalMs: (number|undefined),
 *   maxRetryDelayMs: (number|undefined)}} options
 * @returns {void}
 */
function configure(options = {}) {
    if (typeof options.flushDelayMs === 'number') timing.flushDelayMs = options.flushDelayMs;
    if (typeof options.minSendIntervalMs === 'number') timing.minSendIntervalMs = options.minSendIntervalMs;
    if (typeof options.maxRetryDelayMs === 'number') timing.maxRetryDelayMs = options.maxRetryDelayMs;
}

/**
 * Drop every queue and timer, used by the tests to start from a clean state.
 * @returns {void}
 */
function stopAll() {
    for (const guildId of queues.keys()) {
        reset(guildId);
    }
    queues.clear();
}

/**
 * @param {string} guildId
 * @returns {number} Number of lines waiting for the channel.
 */
function getPendingLineCount(guildId) {
    const queue = queues.get(guildId);

    return queue ? queue.lines.length : 0;
}

module.exports = {
    push,
    pushStartLine,
    reset,
    resume,
    flushNow,
    flushAll,
    configure,
    stopAll,
    getPendingLineCount,
    getRetryDelay,
    formatTime,
};
