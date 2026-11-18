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
    The forced wipe of Rust: the first Thursday of every month at 19:00 London time (Facepunch's update). Every
    official and most community servers wipe then, whatever their own schedule is.
*/

const WIPE_HOUR_LONDON = 19;

/* The hour in London at a UTC time. */
function londonHour(date) {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' })
        .format(date));
}

/* The forced wipe of the month (year, month 0-11) as a Date. */
function wipeOfMonth(year, month) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (4 - first.getUTCDay() + 7) % 7;     /* days to the first Thursday */
    const candidate = new Date(Date.UTC(year, month, 1 + offset, WIPE_HOUR_LONDON));

    /* Summer time: 19:00 in London is 18:00 UTC. */
    if (londonHour(candidate) !== WIPE_HOUR_LONDON) candidate.setUTCHours(WIPE_HOUR_LONDON - 1);

    return candidate;
}

/* The next forced wipe after now. */
function next(now = new Date()) {
    const thisMonth = wipeOfMonth(now.getUTCFullYear(), now.getUTCMonth());
    if (thisMonth > now) return thisMonth;

    const month = now.getUTCMonth() + 1;
    return wipeOfMonth(now.getUTCFullYear() + Math.floor(month / 12), month % 12);
}

module.exports = {
    wipeOfMonth: wipeOfMonth,
    next: next,
};
