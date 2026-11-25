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
    The name and the message of a smart alarm as they are set in game. Rust+ has no request for them: getEntityInfo
    answers with the state only, and the pairing names every alarm "Smart Alarm". The push of a trigger carries them
    (title and message, the text the Rust+ app shows), so the alarm takes them from there.

    A text that was set in Discord (the edit form of the alarm) stays, whatever it is: saving the edit form with another
    text marks the field (nameFromDiscord / messageFromDiscord, markEditedInDiscord) and the push never replaces it
    again. Otherwise a field is taken from the game while it is still the default of the bot, or was taken from the
    game before (nameFromGame / messageFromGame).
*/

const Fs = require('fs');
const Path = require('path');

const LANGUAGES_DIR = Path.join(__dirname, '..', 'languages');

let defaults = null;

/* The default name and message of an alarm in every language of the bot. */
function loadDefaults() {
    if (defaults !== null) return defaults;

    defaults = { names: new Set(['Smart Alarm']), messages: new Set() };

    for (const file of Fs.readdirSync(LANGUAGES_DIR)) {
        if (!file.endsWith('.json')) continue;

        try {
            const texts = JSON.parse(Fs.readFileSync(Path.join(LANGUAGES_DIR, file), 'utf8'));
            if (typeof texts.smartAlarm === 'string') defaults.names.add(texts.smartAlarm);
            if (typeof texts.baseIsUnderAttack === 'string') defaults.messages.add(texts.baseIsUnderAttack);
        }
        catch (e) {
            /* A broken language file has no default to compare with. */
        }
    }

    return defaults;
}

function clean(text) {
    return typeof text === 'string' ? text.trim() : '';
}

function isDefaultName(name) {
    const text = clean(name);
    return text === '' || loadDefaults().names.has(text);
}

function isDefaultMessage(message) {
    const text = clean(message);
    return text === '' || loadDefaults().messages.has(text);
}

/*
    Takes the name (title) and the message of the push into the alarm where it may. Returns the fields that changed,
    [] when nothing did.
*/
function applyFromPush(alarm, title, message) {
    if (!alarm || typeof alarm !== 'object') return [];

    const changed = [];
    const name = clean(title);
    const text = clean(message);

    /* Set in Discord: never replaced, also when the text equals a default of the bot. */
    const nameMayChange = alarm.nameFromDiscord !== true &&
        (alarm.nameFromGame === true || isDefaultName(alarm.name));
    const messageMayChange = alarm.messageFromDiscord !== true &&
        (alarm.messageFromGame === true || isDefaultMessage(alarm.message));

    if (name !== '' && nameMayChange) {
        if (alarm.name !== name) changed.push('name');
        alarm.name = name;
        alarm.nameFromGame = true;
    }

    if (text !== '' && messageMayChange) {
        if (alarm.message !== text) changed.push('message');
        alarm.message = text;
        alarm.messageFromGame = true;
    }

    return changed;
}

/* The edit form in Discord was saved: a field with another text than before is the user's own from now on. */
function markEditedInDiscord(alarm, name, message) {
    if (!alarm || typeof alarm !== 'object') return;

    if (name !== alarm.name) {
        alarm.nameFromGame = false;
        alarm.nameFromDiscord = true;
    }
    if (message !== alarm.message) {
        alarm.messageFromGame = false;
        alarm.messageFromDiscord = true;
    }
}

module.exports = {
    isDefaultName: isDefaultName,
    isDefaultMessage: isDefaultMessage,
    applyFromPush: applyFromPush,
    markEditedInDiscord: markEditedInDiscord,
};
