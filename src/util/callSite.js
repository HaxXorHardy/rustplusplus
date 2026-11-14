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
    A rejected response does not say who asked for it: `not_found` comes from a dozen rounds (the poll, a device round,
the pairing history, a button), and the console line looked identical for all of them. The stack of the moment the
message is written names the caller, so the log line carries `file:line`.
*/

/*
    The file name of a frame, with and without a path: a stack written on Windows uses backslashes, one written on
    Linux slashes - and path.basename only knows the separators of the platform it runs on.
*/
function baseName(file) {
    const parts = `${file}`.split(/[\\/]/);

    return parts[parts.length - 1];
}

/*
    The first frame outside `skip` (module file names), as `file:line`. Node writes frames as
        at Object.handler (/app/src/handlers/smartAlarmHandler.js:48:37)
        at async /app/src/... (file:///app/src/util/x.js:12:5)
*/
function format(stack, skip = []) {
    if (typeof stack !== 'string') return null;

    for (const line of stack.split('\n')) {
        const match = line.match(/\(?((?:[A-Za-z]:)?[^()\s]+?):(\d+):(\d+)\)?\s*$/);
        if (!match) continue;

        const file = match[1];
        if (skip.some((name) => file.includes(name))) continue;

        return `${baseName(file)}:${match[2]}`;
    }

    return null;
}

/* The call site of the caller of `describe`, as `file:line`, or null when the stack is not usable. */
function describe(skip = []) {
    return format(new Error().stack, skip.concat(['callSite.js']));
}

module.exports = {
    format: format,
    describe: describe,
};
