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
    Early warning before a tool cupboard runs out of upkeep. The bot only reported a TC that already decays
    (protectionExpiry 0); with RPP_UPKEEP_WARNING_HOURS (default 6, 0 = off) it warns once when the upkeep left drops
    below that, and again only after the TC was filled up to more than the threshold plus REARM_MARGIN_SECONDS.
*/

const REARM_MARGIN_SECONDS = 60 * 60;

/*
    entity: the storage monitor (its upkeepWarned flag is read), expiry: protectionExpiry in unix seconds (0 = decays).
    Returns 'warn' (send the warning now), 'rearm' (filled up, warn again next time) or null.
*/
function check(entity, expiry, nowSeconds, thresholdHours) {
    const threshold = Number(thresholdHours) * 60 * 60;
    if (!Number.isFinite(threshold) || threshold <= 0) return null;

    /* Decaying is reported by its own message. */
    if (!Number.isFinite(Number(expiry)) || Number(expiry) <= 0) return null;

    const left = Number(expiry) - nowSeconds;

    if (left <= threshold) return entity.upkeepWarned ? null : 'warn';
    if (entity.upkeepWarned && left > threshold + REARM_MARGIN_SECONDS) return 'rearm';

    return null;
}

module.exports = {
    REARM_MARGIN_SECONDS: REARM_MARGIN_SECONDS,
    check: check,
};
