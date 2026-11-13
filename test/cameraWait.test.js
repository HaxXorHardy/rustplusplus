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
    Camera.waitForFrames: a check only needs a few frames (the entities of a frame are the whole view), and it must not
    wait for a picture. The test drives the frames by hand, so no server is needed.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Camera = require('../src/structures/Camera.js');

/* A rustplus instance for the camera: only the camera requests and the message stream are used. */
function cameraAdapter() {
    return {
        listeners: [],
        on(event, listener) { this.listeners.push(listener); },
        removeListener(event, listener) {
            this.listeners = this.listeners.filter((entry) => entry !== listener);
        },
        subscribeToCameraAsync: async () => ({
            seq: 1,
            error: null,
            cameraSubscribeInfo: { width: 320, height: 180, farPlane: 250, controlFlags: 10 },
        }),
        unsubscribeFromCameraAsync: async () => ({ seq: 2, error: null }),
        /** Pushes one frame into the camera, like the server does with a cameraRays broadcast. */
        pushFrame(entities = []) {
            for (const listener of this.listeners) {
                listener({ broadcast: { cameraRays: { sampleOffset: 0, rayData: Buffer.alloc(8), entities: entities } } });
            }
        },
    };
}

async function subscribedCamera() {
    const adapter = cameraAdapter();
    const camera = new Camera(adapter, 'cam69');

    Assert.strictEqual(await camera.subscribe(), true);
    Assert.strictEqual(camera.width, 320);

    return { adapter, camera };
}

Test.describe('Camera.waitForFrames', () => {
    Test.it('returns as soon as the requested frames arrived', async () => {
        const { adapter, camera } = await subscribedCamera();

        setTimeout(() => {
            adapter.pushFrame([{ type: 2, entityId: 1, name: 'Raider' }]);
            adapter.pushFrame([{ type: 2, entityId: 1, name: 'Raider' }]);
            adapter.pushFrame([{ type: 2, entityId: 1, name: 'Raider' }]);
        }, 40);

        const startedMs = Date.now();
        const frames = await camera.waitForFrames({ minFrames: 3, timeoutMs: 2000, pollMs: 10 });
        const elapsedMs = Date.now() - startedMs;

        Assert.strictEqual(frames, 3);
        Assert.ok(elapsedMs < 1000, `returned after ${elapsedMs} ms instead of waiting for the timeout`);
        Assert.strictEqual(camera.players.length, 1);
    });

    Test.it('gives up after the timeout when no frame arrives', async () => {
        const { camera } = await subscribedCamera();

        const startedMs = Date.now();
        const frames = await camera.waitForFrames({ minFrames: 3, timeoutMs: 120, pollMs: 10 });
        const elapsedMs = Date.now() - startedMs;

        Assert.strictEqual(frames, 0);
        Assert.ok(elapsedMs >= 110, `returned after ${elapsedMs} ms, before the timeout`);
        Assert.ok(elapsedMs < 1000, `waited ${elapsedMs} ms for a 120 ms timeout`);
    });

    Test.it('only counts cameraRays frames', async () => {
        const { adapter, camera } = await subscribedCamera();

        /* A team chat broadcast must not count as a camera frame. */
        for (const listener of adapter.listeners) listener({ broadcast: { teamMessage: { message: 'hi' } } });
        adapter.pushFrame();

        const frames = await camera.waitForFrames({ minFrames: 2, timeoutMs: 100, pollMs: 10 });

        Assert.strictEqual(frames, 1);
    });

    Test.it('stops listening after the camera was unsubscribed', async () => {
        const { adapter, camera } = await subscribedCamera();

        await camera.unsubscribe();
        adapter.pushFrame();

        Assert.strictEqual(camera.frameCount, 0);
        Assert.strictEqual(adapter.listeners.length, 0);
    });
});
