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
    Watches the cameras of a server and reports players that do not belong to the team.

    A camera can only be subscribed while the paired account is offline (`player_online` otherwise) - which is exactly
    when the base is unattended. Only one camera can be subscribed at a time, so the cameras are checked one after
    another with a pause between the rounds.
*/

const Camera = require('../structures/Camera.js');
const CameraWatch = require('../util/cameraWatch.js');
const DiscordMessages = require('../discordTools/discordMessages.js');

/*
    A check only needs the entities of a camera: they arrive with the first frames, so 3 frames (or 400 ms) are enough -
    the first frame after a subscribe can still be a sweep start. Only an alert needs a picture, that collects
    SNAPSHOT_MS of frames and renders them.
*/
const CHECK_MIN_FRAMES = 3;
const CHECK_TIMEOUT_MS = 400;
const SNAPSHOT_MS = 4000;

const ALERT_COOLDOWN_MS = 10 * 60 * 1000;               /* One alert per camera and player in this window. */
const PAUSE_AFTER_PLAYER_ONLINE_MS = 5 * 60 * 1000;     /* Retry a paused watch after this. */

module.exports = {
    /*
        Called from the polling cycle. Returns immediately when nothing is due, so a camera is never polled while the
        previous round is still running.
    */
    handler: async function (rustplus, client) {
        const instance = client.getInstance(rustplus.guildId);
        if (!instance || !instance.generalSettings || instance.generalSettings.cameraWatchEnabled !== true) return;

        const server = instance.serverList[rustplus.serverId];
        if (!server || !server.watchedCameras) return;

        const watched = Object.entries(server.watchedCameras).filter(([, camera]) => camera.enabled !== false);
        if (watched.length === 0) return;

        if (rustplus.cameraWatchIsRunning) return;

        const nowMs = Date.now();
        if (rustplus.cameraWatchPausedUntilMs && nowMs < rustplus.cameraWatchPausedUntilMs) return;

        const intervalSeconds = CameraWatch.effectiveIntervalSeconds(
            instance.generalSettings.cameraWatchIntervalSeconds, watched.length);
        const chosenSeconds = CameraWatch.normalizeIntervalSeconds(instance.generalSettings.cameraWatchIntervalSeconds);

        if (intervalSeconds !== chosenSeconds && rustplus.cameraWatchIntervalWarnedFor !== intervalSeconds) {
            rustplus.cameraWatchIntervalWarnedFor = intervalSeconds;
            rustplus.log(client.intlGet(null, 'infoCap'),
                `The camera watch interval is raised from ${chosenSeconds} s to ${intervalSeconds} s: ` +
                `${watched.length} camera(s) need that long for one round.`, 'debug');
        }

        if ((nowMs - (rustplus.lastCameraWatchMs || 0)) < (intervalSeconds * 1000)) return;

        rustplus.lastCameraWatchMs = nowMs;
        rustplus.cameraWatchIsRunning = true;

        const roundStartedMs = Date.now();
        const round = { cameras: 0, frames: 0, sightings: 0 };

        try {
            rustplus.cameraAlertState = CameraWatch.pruneAlertState(rustplus.cameraAlertState || {}, nowMs,
                ALERT_COOLDOWN_MS);

            for (const [code, camera] of watched) {
                if (rustplus.isDeleted) break;

                const result = await module.exports.checkCamera(rustplus, client, code, camera);
                round.cameras += 1;
                round.frames += result.frames;
                round.sightings += result.strangers;
            }

            /* One line per round (debug): the measurement that shows what a check costs. */
            rustplus.log(client.intlGet(null, 'infoCap'),
                `camera watch: ${round.cameras} camera(s), ${round.frames} frame(s), ` +
                `${round.sightings} sighting(s) in ${Date.now() - roundStartedMs} ms.`, 'debug');
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The camera watch failed: ${e && e.message ? e.message : e}`, 'warn');
        }
        finally {
            rustplus.cameraWatchIsRunning = false;
        }
    },

    /*
        Looks at one camera and reports strangers the cooldown does not suppress.
        Returns { frames, strangers } for the round summary of the caller.
    */
    checkCamera: async function (rustplus, client, code, cameraSettings = {}) {
        const camera = new Camera(rustplus, code);
        const result = { frames: 0, strangers: 0 };

        if (!(await camera.subscribe())) {
            await module.exports.handleSubscribeFailure(rustplus, client, code, camera.lastError);
            return result;
        }

        try {
            const startedMs = Date.now();
            result.frames = await camera.waitForFrames({ minFrames: CHECK_MIN_FRAMES, timeoutMs: CHECK_TIMEOUT_MS });

            if (result.frames === 0) {
                rustplus.log(client.intlGet(null, 'infoCap'),
                    `Camera "${code}": no frame in ${CHECK_TIMEOUT_MS} ms, no verdict.`, 'debug');
                return result;
            }

            const instance = client.getInstance(rustplus.guildId);
            const names = CameraWatch.teamIgnoreSet(rustplus.team,
                instance.generalSettings.cameraWatchReportTeam === true);
            const strangers = CameraWatch.findStrangers(camera.players, names);
            result.strangers = strangers.length;
            if (strangers.length === 0) return result;

            const nowMs = Date.now();
            const state = rustplus.cameraAlertState || {};
            const fresh = strangers.filter((stranger) =>
                CameraWatch.isCooldownOver(state, CameraWatch.alertKey(code, stranger), nowMs, ALERT_COOLDOWN_MS));
            if (fresh.length === 0) return result;

            /* The camera is subscribed anyway, so collect the frames of a complete picture for the alert. */
            const elapsedMs = Date.now() - startedMs;
            if (elapsedMs < SNAPSHOT_MS) await camera.collect(SNAPSHOT_MS - elapsedMs);
            const rendered = camera.frameCount === 0 ? null : await camera.render();

            for (const stranger of fresh) {
                CameraWatch.markAlert(state, CameraWatch.alertKey(code, stranger), nowMs);
            }
            rustplus.cameraAlertState = state;

            await DiscordMessages.sendCameraAlertMessage(rustplus, {
                code: code,
                name: cameraSettings.name || null,
                strangers: fresh,
                png: rendered === null ? null : rendered.buffer,
                coverage: rendered === null ? 0 : rendered.coverage,
            });

            return result;
        }
        finally {
            await camera.unsubscribe();
        }
    },

    /*
        player_online: the paired account is on the server, the watch pauses and tries again later.
        not_found: the code is unknown (or the pairing token of the server is stale), the camera is disabled once so the
        watch does not ask for it every round.
    */
    handleSubscribeFailure: async function (rustplus, client, code, error) {
        if (error === 'player_online') {
            rustplus.cameraWatchPausedUntilMs = Date.now() + PAUSE_AFTER_PLAYER_ONLINE_MS;
            rustplus.log(client.intlGet(null, 'infoCap'),
                `Camera "${code}" is paused: the paired account is on the server, Rust+ streams cameras only while it ` +
                'is offline.', 'debug');
            return;
        }

        if (error === 'not_found') {
            const instance = client.getInstance(rustplus.guildId);
            const server = instance.serverList[rustplus.serverId];

            if (server && server.watchedCameras && server.watchedCameras[code]) {
                server.watchedCameras[code].enabled = false;
                client.setInstance(rustplus.guildId, instance);
            }
        }

        rustplus.log(client.intlGet(null, 'warningCap'),
            `Camera "${code}" could not be subscribed (${error}), it is skipped.`, 'warn');
    },
};

