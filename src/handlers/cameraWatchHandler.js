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

/* The entities of a camera arrive with the first frames, a complete image needs ~3-4 s. */
const COLLECT_MS = 2500;
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

        const intervalSeconds = CameraWatch.normalizeIntervalSeconds(
            instance.generalSettings.cameraWatchIntervalSeconds);
        if ((nowMs - (rustplus.lastCameraWatchMs || 0)) < (intervalSeconds * 1000)) return;

        rustplus.lastCameraWatchMs = nowMs;
        rustplus.cameraWatchIsRunning = true;

        try {
            rustplus.cameraAlertState = CameraWatch.pruneAlertState(rustplus.cameraAlertState || {}, nowMs,
                ALERT_COOLDOWN_MS);

            for (const [code, camera] of watched) {
                if (rustplus.isDeleted) break;
                await module.exports.checkCamera(rustplus, client, code, camera);
            }
        }
        catch (e) {
            rustplus.log(client.intlGet(null, 'warningCap'),
                `The camera watch failed: ${e && e.message ? e.message : e}`, 'warn');
        }
        finally {
            rustplus.cameraWatchIsRunning = false;
        }
    },

    /* Looks at one camera and reports strangers the cooldown does not suppress. */
    checkCamera: async function (rustplus, client, code, cameraSettings = {}) {
        const camera = new Camera(rustplus, code);

        if (!(await camera.subscribe())) {
            await module.exports.handleSubscribeFailure(rustplus, client, code, camera.lastError);
            return;
        }

        try {
            await camera.collect(COLLECT_MS);

            const names = CameraWatch.teamNameSet(rustplus.team);
            const strangers = CameraWatch.findStrangers(camera.players, names);
            if (strangers.length === 0) return;

            const nowMs = Date.now();
            const state = rustplus.cameraAlertState || {};
            const fresh = strangers.filter((stranger) =>
                CameraWatch.isCooldownOver(state, CameraWatch.alertKey(code, stranger), nowMs, ALERT_COOLDOWN_MS));
            if (fresh.length === 0) return;

            /* The camera is subscribed anyway, so take the complete picture for the alert. */
            if (camera.frameCount > 0) await camera.collect(SNAPSHOT_MS - COLLECT_MS);
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

