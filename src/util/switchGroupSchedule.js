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
    Real-time schedules of switch groups, set in the edit form: "22:00-06:00 off, 18:00-23:00 on" with an optional
    time zone in front ("Europe/Berlin: 22:00-06:00 off"); without one RPP_TIMEZONE is used (default UTC).

    A window switches the group to its state when it begins and back when it ends - only on these transitions, a
    restart does not switch anything by itself.
*/

const Config = require('../../config');

const WINDOW = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(\S+)$/;

function isValidTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: timeZone });
        return true;
    }
    catch (e) {
        return false;
    }
}

/* The minute of the day (0-1439) in the time zone. */
function minuteOfDay(timeZone, date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour').value);
    const minute = Number(parts.find((p) => p.type === 'minute').value);

    return (hour % 24) * 60 + minute;
}

/*
    Parse the text of the edit form. onWords/offWords: the words for on and off (English and the guild language).
    Returns { schedule: { timeZone, windows: [{ from, to, value }] } | null, rejected: [text] }.
*/
function parse(text, onWords = ['on'], offWords = ['off']) {
    let rest = `${text || ''}`.trim();
    const rejected = [];
    if (rest === '') return { schedule: null, rejected: rejected };

    let timeZone = null;
    const zone = /^([A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+)*|UTC)\s*:\s+/.exec(rest);
    if (zone && isValidTimeZone(zone[1])) {
        timeZone = zone[1];
        rest = rest.slice(zone[0].length);
    }

    const on = onWords.map((w) => `${w}`.toLowerCase());
    const off = offWords.map((w) => `${w}`.toLowerCase());
    const windows = [];

    for (const part of rest.split(/[,;\n]+/)) {
        const trimmed = part.trim();
        if (trimmed === '') continue;

        const match = WINDOW.exec(trimmed);
        const word = match ? match[5].toLowerCase() : null;
        const value = word !== null && on.includes(word) ? true : (word !== null && off.includes(word) ? false : null);
        const numbers = match ? match.slice(1, 5).map(Number) : [];

        if (!match || value === null || numbers[0] > 23 || numbers[2] > 23 || numbers[1] > 59 || numbers[3] > 59) {
            rejected.push(trimmed);
            continue;
        }

        const from = numbers[0] * 60 + numbers[1];
        const to = numbers[2] * 60 + numbers[3];
        if (from === to) {
            rejected.push(trimmed);
            continue;
        }

        windows.push({ from: from, to: to, value: value });
    }

    return { schedule: windows.length === 0 ? null : { timeZone: timeZone, windows: windows }, rejected: rejected };
}

function pad(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/* The schedule as text for the edit form and the group message. */
function format(schedule, onWord = 'on', offWord = 'off') {
    if (!schedule || !Array.isArray(schedule.windows) || schedule.windows.length === 0) return '';

    const windows = schedule.windows.map((w) => `${pad(w.from)}-${pad(w.to)} ${w.value ? onWord : offWord}`).join(', ');
    return schedule.timeZone ? `${schedule.timeZone}: ${windows}` : windows;
}

/* Is the minute inside the window (a window may run over midnight)? */
function inside(window, minute) {
    return window.from < window.to ?
        minute >= window.from && minute < window.to :
        minute >= window.from || minute < window.to;
}

function timeZoneOf(schedule) {
    if (schedule && schedule.timeZone && isValidTimeZone(schedule.timeZone)) return schedule.timeZone;

    const configured = Config.general.scheduleTimeZone;
    return configured && isValidTimeZone(configured) ? configured : 'UTC';
}

/*
    The transitions since the last check: [{ index, value }] - the state the group switches to now. lastInside holds
    the state of each window between the checks (in memory); the first check of a window only records it.
*/
function transitions(schedule, lastInside, date = new Date()) {
    if (!schedule || !Array.isArray(schedule.windows)) return [];

    const minute = minuteOfDay(timeZoneOf(schedule), date);
    const result = [];

    schedule.windows.forEach((window, index) => {
        const now = inside(window, minute);
        const before = lastInside[index];
        lastInside[index] = now;

        if (before === undefined || before === now) return;
        result.push({ index: index, value: now ? window.value : !window.value });
    });

    return result;
}

module.exports = {
    parse: parse,
    format: format,
    inside: inside,
    minuteOfDay: minuteOfDay,
    timeZoneOf: timeZoneOf,
    transitions: transitions,
};
