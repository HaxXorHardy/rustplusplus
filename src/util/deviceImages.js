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
    The images of the devices (resources/images/electrics) as links instead of uploads. Every message of a device
    uploaded its image again on each edit, and Discord handled edits with an upload one after another, about every
    17 s for all channels together (live 2026-11-18): the status of switches and groups lagged minutes behind. A link
    needs no upload. RPP_IMAGE_BASE_URL can point to another copy of the repository.
*/

const Config = require('../../config');

const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/HaxXorHardy/rustplusplus/master';

function baseUrl() {
    const configured = Config.general && Config.general.imageBaseUrl;
    return `${configured || DEFAULT_BASE_URL}`.replace(/\/+$/, '');
}

/* The link of an image of resources/images, for example "team_info_logo.png". */
function resource(name) {
    return `${baseUrl()}/src/resources/images/${`${name}`.split('/').map(encodeURIComponent).join('/')}`;
}

/* The link of a device image, for example "smart_switch.png". */
function url(image) {
    return resource(`electrics/${image}`);
}

module.exports = {
    DEFAULT_BASE_URL: DEFAULT_BASE_URL,
    resource: resource,
    url: url,
};
