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
    One Rust+ camera: subscribe, collect the frames the server pushes, render them (util/cameraRenderer.js), unsubscribe.

    Two things the server decides and a caller has to live with:
    - one subscription per connection at a time, so cameras are checked one after another
    - the paired account has to be offline, an account that is on the server is answered with `player_online`
*/

const CameraRenderer = require('../util/cameraRenderer.js');
const Timer = require('../util/timer.js');

/* Entities of a camera frame, the enum of AppCameraRays.Entity. */
const ENTITY_TYPE_TREE = 1;
const ENTITY_TYPE_PLAYER = 2;

class Camera {
    constructor(rustplus, code) {
        this._rustplus = rustplus;
        this._code = code;
        this._frames = [];
        this._subscribeInfo = null;
        this._listener = null;
        this._subscribed = false;
        this._lastError = null;
    }

    get code() { return this._code; }
    get frames() { return this._frames; }
    get frameCount() { return this._frames.length; }
    get lastError() { return this._lastError; }
    get isSubscribed() { return this._subscribed; }
    get width() { return this._subscribeInfo === null ? 0 : this._subscribeInfo.width; }
    get height() { return this._subscribeInfo === null ? 0 : this._subscribeInfo.height; }
    get controlFlags() { return this._subscribeInfo === null ? 0 : this._subscribeInfo.controlFlags; }

    /* Everything the camera saw in the collected frames, unique per entity. */
    get entities() {
        const unique = new Map();

        for (const frame of this._frames) {
            for (const entity of Array.isArray(frame.entities) ? frame.entities : []) {
                const key = `${entity.type}:${entity.entityId}`;
                if (!unique.has(key)) unique.set(key, entity);
            }
        }

        return [...unique.values()];
    }

    /* Player entities (a sleeping body counts as one), trees are filtered out. */
    get players() {
        return this.entities.filter((entity) => entity.type === ENTITY_TYPE_PLAYER);
    }

    async subscribe() {
        if (this._subscribed) return true;

        const response = await this._rustplus.subscribeToCameraAsync(this._code);

        /*
            protobuf sets an unused optional field to null, so a successful answer has `error: null` - a falsy check,
            not `!== undefined`, is what tells an AppError apart.
        */
        if (!response || response.error) {
            /* The wrapper answers with an object, not with an Error: { error: 'player_online' } and friends. */
            this._lastError = `${response && response.error ? response.error : 'unknown'}`;
            return false;
        }

        if (!response.cameraSubscribeInfo) {
            this._lastError = 'empty';
            return false;
        }

        this._subscribeInfo = response.cameraSubscribeInfo;
        this._frames = [];
        this._listener = (message) => {
            if (message.broadcast && message.broadcast.cameraRays) this._frames.push(message.broadcast.cameraRays);
        };

        this._rustplus.on('message', this._listener);
        this._subscribed = true;
        return true;
    }

    /* Collects the frames of `durationMs` - at ~12 frames/s and ~3 % coverage per frame that is a complete picture. */
    async collect(durationMs) {
        await Timer.sleep(durationMs);
        return this._frames.length;
    }

    /*
        Waits until `minFrames` frames arrived or `timeoutMs` passed and returns the number of frames.

        The entities of a frame are the whole view of the camera, so for "who is there" a few frames are enough (a check
        does not need a picture at all). Three frames are the safe minimum: the first frame after a subscribe can still be
        a sweep start without entities.
    */
    async waitForFrames({ minFrames = 3, timeoutMs = 400, pollMs = 50 } = {}) {
        const deadline = Date.now() + timeoutMs;

        while (this._frames.length < minFrames && Date.now() < deadline) {
            await Timer.sleep(pollMs);
        }

        return this._frames.length;
    }

    async render() {
        return await CameraRenderer.renderPng(this._frames, this.width, this.height);
    }

    async unsubscribe() {
        if (this._listener !== null) {
            this._rustplus.removeListener('message', this._listener);
            this._listener = null;
        }

        if (this._subscribed) {
            this._subscribed = false;
            await this._rustplus.unsubscribeFromCameraAsync();
        }
    }

    /*
        Subscribe, collect, render, unsubscribe. `ok` is false when the server refused the camera, `error` then holds the
        code of the server (`player_online`, `not_found`, ...).
    */
    async snapshot(durationMs = 4000) {
        try {
            if (!(await this.subscribe())) {
                return { ok: false, error: this._lastError, entities: [], players: [] };
            }

            await this.collect(durationMs);

            const rendered = await this.render();

            return {
                ok: true,
                error: null,
                png: rendered.buffer,
                coverage: rendered.coverage,
                width: this.width,
                height: this.height,
                controlFlags: this.controlFlags,
                frameCount: this.frameCount,
                entities: this.entities,
                players: this.players,
            };
        }
        finally {
            await this.unsubscribe();
        }
    }
}

module.exports = Camera;
module.exports.ENTITY_TYPE_TREE = ENTITY_TYPE_TREE;
module.exports.ENTITY_TYPE_PLAYER = ENTITY_TYPE_PLAYER;
