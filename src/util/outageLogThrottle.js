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
    Keeps a network outage from flooding the log. On 2026-11-22 the host lost DNS and Discord for an hour and wrote
    about 600 lines: the same pairing history, BattleMetrics, Discord delete and relay failures again and again.

    - WARNING or ERROR lines that name a network failure (DNS, connect timeout, refused, reset, ...) start an outage
      when three of them come within a minute (one failed request is no outage), every further one extends it.
    - During an outage each kind of WARNING or ERROR line is written once; its repeats are counted instead. The kind is
      the line with numbers and ids taken out, so "Could not delete message: 123" and "...: 456" are the same kind.
      This also catches the lines that follow a failure without naming it ("Battlemetrics Server 42 failed to update").
    - QUIET_MS without a network failure ends the outage: one line says how long it lasted and what was left out. An
      outage that goes on writes that line every REPORT_EVERY_MS as well, then the kinds are written once again.

    Outside an outage nothing is held back, and debug and info lines are never held back.
*/

const QUIET_MS = 5 * 60 * 1000;
const REPORT_EVERY_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const MAX_KINDS_IN_SUMMARY = 5;
const FAILURES_TO_START = 3;
const START_WINDOW_MS = 60 * 1000;

const NETWORK_FAILURE = new RegExp([
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH',
    'EHOSTUNREACH', 'ENETDOWN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
    'socket hang up', 'timeout of \\d+ms exceeded', 'Connect Timeout Error', 'network socket disconnected',
].join('|'));

let state = null;           /* { startMs, lastFailureMs, lastReportMs, kinds: Map(kind -> { text, suppressed }) } */
let recentFailures = [];    /* times of the network failures before an outage started */
let writer = null;          /* (text) => void, writes the summary line */
let timer = null;
let now = () => Date.now();

function isNetworkFailure(text) {
    return NETWORK_FAILURE.test(text);
}

/* Stack lines and numbers out, ids and addresses become N: one kind per message, not per message id. */
function kindOf(scope, title, text) {
    const lines = `${text}`.split(/\r?\n/).filter((line) => !/^\s*'?\s*at /.test(line));
    const body = lines.join(' ').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, 'N').replace(/\d+/g, 'N')
        .replace(/\s+/g, ' ').trim();

    return `${scope}|${title}|${body.slice(0, 300)}`;
}

function short(text) {
    const first = `${text}`.split(/\r?\n/).find((line) => line.trim() !== '' && line.trim() !== '[') || `${text}`;
    const line = first.trim().replace(/^'|',?$/g, '');

    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function minutes(ms) {
    return Math.max(1, Math.round(ms / 60000));
}

function summary(ended) {
    const kinds = [...state.kinds.values()].filter((kind) => kind.suppressed > 0)
        .sort((a, b) => b.suppressed - a.suppressed);
    const total = kinds.reduce((sum, kind) => sum + kind.suppressed, 0);
    const duration = minutes(state.lastFailureMs - state.startMs);

    let text = ended ?
        `The network problems are over (about ${duration} min). ` :
        `The network problems go on (${minutes(now() - state.startMs)} min so far). `;

    if (total === 0) return `${text}No repeated lines were left out.`;

    text += `${total} repeated line(s) were left out of the log: ` +
        kinds.slice(0, MAX_KINDS_IN_SUMMARY).map((kind) => `${kind.suppressed}x "${kind.text}"`).join(', ');

    if (kinds.length > MAX_KINDS_IN_SUMMARY) text += `, and ${kinds.length - MAX_KINDS_IN_SUMMARY} more kind(s)`;

    return `${text}.`;
}

function report(text) {
    if (typeof writer !== 'function') return;

    try {
        writer(text);
    }
    catch (e) {
        /* The summary is a courtesy, logging must not throw. */
    }
}

/* Ends a quiet outage and reports a long one. Called by the timer and before each line. */
function check() {
    if (state === null) return;

    const time = now();

    if (time - state.lastFailureMs >= QUIET_MS) {
        const text = summary(true);
        state = null;
        stopTimer();
        report(text);
        return;
    }

    if (time - state.lastReportMs >= REPORT_EVERY_MS) {
        report(summary(false));
        state.lastReportMs = time;
        state.kinds.clear();
    }
}

function startTimer() {
    if (timer !== null) return;

    timer = setInterval(check, CHECK_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
}

function stopTimer() {
    if (timer === null) return;

    clearInterval(timer);
    timer = null;
}

/*
    True when the line is written, false when it is a repeat during an outage. scope tells loggers apart (the bot log
    and each guild log), text is the formatted line with all its lines.
*/
function shouldWrite(scope, title, text, level) {
    if (level !== 'warn' && level !== 'error') return true;

    check();

    const failure = isNetworkFailure(`${title} ${text}`);

    if (failure) {
        const time = now();

        if (state === null) {
            /* One failed request is no outage: it takes FAILURES_TO_START within START_WINDOW_MS. */
            recentFailures = recentFailures.filter((ms) => time - ms < START_WINDOW_MS);
            recentFailures.push(time);

            if (recentFailures.length >= FAILURES_TO_START) {
                state = { startMs: recentFailures[0], lastFailureMs: time, lastReportMs: time, kinds: new Map() };
                recentFailures = [];
                startTimer();
            }
        }
        else {
            state.lastFailureMs = time;
        }
    }

    if (state === null) return true;

    const kind = kindOf(scope, title, text);
    const entry = state.kinds.get(kind);

    if (!entry) {
        state.kinds.set(kind, { text: short(`${title}: ${text}`), suppressed: 0 });
        return true;
    }

    entry.suppressed += 1;
    return false;
}

/* The summary goes to the bot log (set by the Logger of type 'default'). */
function setWriter(fn) {
    writer = fn;
}

function isActive() {
    return state !== null;
}

/* Tests: a fake clock and a clean state. */
function reset(options = {}) {
    stopTimer();
    state = null;
    recentFailures = [];
    writer = null;
    now = options.now || (() => Date.now());
}

module.exports = {
    QUIET_MS: QUIET_MS,
    REPORT_EVERY_MS: REPORT_EVERY_MS,
    FAILURES_TO_START: FAILURES_TO_START,
    isNetworkFailure: isNetworkFailure,
    kindOf: kindOf,
    shouldWrite: shouldWrite,
    check: check,
    setWriter: setWriter,
    isActive: isActive,
    reset: reset,
};
