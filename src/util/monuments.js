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
    The monument names of the Rust+ map. The server sends a token per monument (AppMap.monuments[].token), the readable
    name comes from the localized table of structures/Map.js. A monument that a newer Rust version added is missing
    there, its token is formatted instead of dropping the monument (or drawing the raw token on the map).
*/

/* 'jungle_ziggurat' -> 'Jungle Ziggurat', 'apartmentcomplex' -> 'Apartmentcomplex', 'radtown' -> 'Radtown'. */
function formatToken(token) {
    const cleaned = `${token === undefined || token === null ? '' : token}`
        .replace(/_display_name$/i, '')
        .replace(/_name$/i, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleaned === '') return '';

    return cleaned
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

module.exports = {
    formatToken: formatToken,
};
