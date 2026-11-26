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
    Splits the byte stream of Google's Mobile Connection Server (MCS) into messages. The stream starts with one
    version byte, then every message is <tag byte><varint32 size><protobuf bytes>. Modelled on the parser of
    @liamcottle/push-receiver 0.0.4 (MIT, Copyright (c) 2017 Matthieu Lemoine) and Chromium's connection handler.
*/

const Path = require('path');
const Protobuf = require('protobufjs');

const MCS_VERSION = 41;
const MCS_VERSION_OLD = 38;
const MAX_SIZE_BYTES = 5;
/* MCS payloads are 4 KiB by protocol; anything far above that means the stream is out of step. */
const MAX_MESSAGE_SIZE = 1024 * 1024;

const TAGS = {
    heartbeatPing: 0,
    heartbeatAck: 1,
    loginRequest: 2,
    loginResponse: 3,
    close: 4,
    iqStanza: 7,
    dataMessageStanza: 8,
    streamErrorStanza: 10,
};

const TYPE_NAMES = {
    [TAGS.heartbeatPing]: 'HeartbeatPing',
    [TAGS.heartbeatAck]: 'HeartbeatAck',
    [TAGS.loginRequest]: 'LoginRequest',
    [TAGS.loginResponse]: 'LoginResponse',
    [TAGS.close]: 'Close',
    [TAGS.iqStanza]: 'IqStanza',
    [TAGS.dataMessageStanza]: 'DataMessageStanza',
    [TAGS.streamErrorStanza]: 'StreamErrorStanza',
};

let root = null;

function loadRoot() {
    if (!root) root = Protobuf.loadSync(Path.join(__dirname, 'proto', 'mcs.proto'));
    return root;
}

function lookupType(name) {
    return loadRoot().lookupType(`mcs_proto.${name}`);
}

/* { value, length } of the varint32 at offset, or null if it is not complete yet. Throws if it is too long. */
function readVarint32(buffer, offset) {
    let value = 0;

    for (let i = 0; i < MAX_SIZE_BYTES; i++) {
        if (offset + i >= buffer.length) return null;

        const byte = buffer[offset + i];
        value += (byte & 0x7f) * (2 ** (7 * i));
        if ((byte & 0x80) === 0) return { value: value, length: i + 1 };
    }

    throw new Error('Invalid MCS message size.');
}

function encodeVarint32(value) {
    const bytes = [];
    let rest = value >>> 0;

    do {
        let byte = rest & 0x7f;
        rest >>>= 7;
        if (rest !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (rest !== 0);

    return Buffer.from(bytes);
}

class McsParser {
    constructor() {
        this.buffer = Buffer.alloc(0);
        this.versionRead = false;

        /* Received bytes not joined yet, and how many bytes the next message needs at least. */
        this.chunks = [];
        this.length = 0;
        this.needed = 1;
    }

    /*
        Adds received bytes and returns the complete messages [{ tag, object }]. Throws on a broken stream. The chunks
        are only joined once they can complete a message: a large message in many small chunks is not copied again
        with each one.
    */
    push(chunk) {
        this.chunks.push(chunk);
        this.length += chunk.length;
        if (this.length < this.needed) return [];

        this.buffer = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.length);
        this.chunks = [];
        this.length = 0;

        const messages = [];
        let message = this.next();
        while (message !== null) {
            messages.push(message);
            message = this.next();
        }

        /* The rest waits for the next chunk. */
        if (this.buffer.length > 0) {
            this.chunks.push(this.buffer);
            this.length = this.buffer.length;
        }
        this.buffer = Buffer.alloc(0);

        return messages;
    }

    /* The next complete message of this.buffer, or null - then this.needed is the length that may complete it. */
    next() {
        let offset = 0;
        const incomplete = (needed) => {
            this.needed = needed;
            return null;
        };

        if (!this.versionRead) {
            if (this.buffer.length < 1) return incomplete(1);

            const version = this.buffer[0];
            if (version < MCS_VERSION && version !== MCS_VERSION_OLD) {
                throw new Error(`Unsupported MCS version ${version}.`);
            }
            offset = 1;
        }

        if (this.buffer.length < offset + 1) return incomplete(offset + 1);
        const tag = this.buffer[offset];
        offset += 1;

        const size = readVarint32(this.buffer, offset);
        if (size === null) return incomplete(this.buffer.length + 1);
        if (size.value > MAX_MESSAGE_SIZE) throw new Error(`MCS message of ${size.value} bytes is too large.`);
        offset += size.length;

        if (this.buffer.length < offset + size.value) return incomplete(offset + size.value);

        const name = TYPE_NAMES[tag];
        if (!name) throw new Error(`Unknown MCS tag ${tag}.`);

        const bytes = this.buffer.subarray(offset, offset + size.value);
        this.buffer = this.buffer.subarray(offset + size.value);
        this.versionRead = true;

        if (size.value === 0) return { tag: tag, object: {} };

        const type = lookupType(name);
        const object = type.toObject(type.decode(bytes), { longs: String, enums: String, bytes: Buffer });

        return { tag: tag, object: object };
    }
}

module.exports = {
    McsParser,
    TAGS,
    MCS_VERSION,
    lookupType,
    readVarint32,
    encodeVarint32,
};
