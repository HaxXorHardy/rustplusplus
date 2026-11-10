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

const Discord = require('discord.js');
const QrCode = require('qrcode');

const Constants = require('../util/constants.js');
const DiscordButtons = require('../discordTools/discordButtons.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const InstanceUtils = require('../util/instanceUtils.js');
const RustPlusAuth = require('../util/rustplusAuth.js');
const RustPlusHistory = require('../util/rustplusHistory.js');
const RustPlusLogin = require('../util/rustplusLogin.js');
const RustPlusSync = require('../util/rustplusSync.js');
const RustPlusTransport = require('../util/rustplusTransport.js');

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

function getFlow(client, userId) {
    if (client.steamLoginFlows === undefined) client.steamLoginFlows = {};

    const flow = client.steamLoginFlows[`${userId}`];
    if (!flow) return null;

    if (Date.now() - flow.createdAt > FLOW_TIMEOUT_MS) {
        delete client.steamLoginFlows[`${userId}`];
        return null;
    }

    return flow;
}

function storeFlow(client, userId, flow) {
    if (client.steamLoginFlows === undefined) client.steamLoginFlows = {};

    client.steamLoginFlows[`${userId}`] = { flow: flow, createdAt: Date.now() };

    const timer = setTimeout(() => {
        if (client.steamLoginFlows && client.steamLoginFlows[`${userId}`] &&
            client.steamLoginFlows[`${userId}`].flow === flow) {
            delete client.steamLoginFlows[`${userId}`];
        }
    }, FLOW_TIMEOUT_MS + 1000);

    if (typeof timer.unref === 'function') timer.unref();
}

function deleteFlow(client, userId) {
    if (client.steamLoginFlows !== undefined) delete client.steamLoginFlows[`${userId}`];
    return true;
}

function getErrorMessage(e) {
    const message = (e && e.message) ? e.message : `${e}`;
    return message.replace(/`/g, '\'').slice(0, 200);
}

async function reply(client, interaction, color, description, components = [], files = []) {
    const content = {
        embeds: [DiscordEmbeds.getEmbed({
            color: color === 0 ? Constants.COLOR_ACTIVE : Constants.COLOR_INACTIVE,
            description: description
        })],
        components: components,
        files: files
    };

    return await client.interactionEditReply(interaction, content);
}

/*
    The ways to log in, offered before a password is asked for. The QR code and the token keep the Steam credentials
    out of Discord, the password modal stays as the fallback for accounts without the Steam app and without a browser.
*/
function getLoginChooser(client, guildId) {
    return {
        embeds: [DiscordEmbeds.getCredentialsLoginChoiceEmbed(guildId)],
        components: [DiscordButtons.getCredentialsLoginChoiceButtons(guildId)]
    };
}

/* The running server of the guild has to reconnect to pick up the new token. */
function restartActiveServer(client, guildId) {
    const rustplus = client.rustplusInstances[guildId];
    if (!rustplus) return false;

    const instance = client.getInstance(guildId);
    const server = instance.serverList[rustplus.serverId];
    if (!server) return false;

    /* A reconnect that is already scheduled would race with the new instance. */
    if (client.rustplusReconnectTimers[guildId]) {
        clearTimeout(client.rustplusReconnectTimers[guildId]);
        client.rustplusReconnectTimers[guildId] = null;
    }

    rustplus.deleteThisRustplusInstance();
    client.createRustplusInstance(guildId, server.serverIp, server.appPort, server.steamId,
        server.playerToken);

    return true;
}

/*
    The login is the only way an account gets into the guild credentials: it stores which Discord user owns which steam
    account. The pairing id lives in the server entry, the account token in credentials/rustplusAuth/<steamId>.json, so
    the FCM fields of older versions are dropped with the entry.
*/
function registerCredentials(guildId, steamId, discordUserId) {
    const credentials = InstanceUtils.readCredentialsFile(guildId);

    credentials[`${steamId}`] = {
        discord_user_id: discordUserId,
        login: 'rustplus',
        updated_at: new Date().toISOString(),
    };

    /* The first login of a guild also chooses the hoster, a stale hoster is replaced. */
    const hoster = credentials.hoster;
    if (!hoster || !Object.prototype.hasOwnProperty.call(credentials, `${hoster}`)) {
        credentials.hoster = `${steamId}`;
    }

    InstanceUtils.writeCredentialsFile(guildId, credentials);
}

/* Step 1 of the login: Steam credentials, then either the code prompt or the finish. */
async function start(client, interaction, accountName, password) {
    const guildId = interaction.guildId;

    deleteFlow(client, interaction.user.id);

    let flow = null;
    let guard = null;

    try {
        client.log(client.intlGet(null, 'infoCap'), 'Rust+ login: starting the Steam login.');

        flow = new RustPlusLogin.SteamLogin({
            accountName: accountName,
            password: password,
            timeoutMs: FLOW_TIMEOUT_MS,
            log: (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug')
        });

        storeFlow(client, interaction.user.id, flow);

        guard = await flow.start();

        client.log(client.intlGet(null, 'infoCap'),
            guard === null ?
                'Rust+ login: Steam accepted the credentials, waiting for Steam to finish the login.' :
                `Rust+ login: Steam wants ${[].concat(guard.types).join(', ')}.`);
    }
    catch (e) {
        deleteFlow(client, interaction.user.id);
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginFailed', {
            error: getErrorMessage(e)
        }));
    }

    try {
        /* Without a guard Steam finishes on its own, tell the user that the bot is waiting for it. */
        if (guard === null) {
            await reply(client, interaction, 0, client.intlGet(guildId, 'credentialsLoginWaiting'));

            return await complete(client, interaction, flow);
        }

        const types = Array.isArray(guard.types) ? guard.types : [];
        const wantsConfirmation = types.includes('deviceConfirmation') || types.includes('emailConfirmation');
        const wantsCode = types.includes('deviceCode') || types.includes('emailCode');

        let description = null;
        const components = [];

        if (wantsConfirmation) {
            /* Steam asks whether this device may be authorized - no code, only the confirmation in the app. */
            description = types.includes('deviceConfirmation') ?
                client.intlGet(guildId, 'credentialsLoginConfirmGuard') :
                client.intlGet(guildId, 'credentialsLoginEmailConfirmGuard');
            components.push(DiscordButtons.getCredentialsLoginDoneButton(guildId));

            /* Steam may accept a code as well, keep it reachable for accounts without the app. */
            if (wantsCode) components.push(DiscordButtons.getCredentialsLoginCodeButton(guildId));
        }
        else {
            description = types.includes('emailCode') ?
                client.intlGet(guildId, 'credentialsLoginEmailGuard', {
                    domain: guard.detail === null ? 'e-mail' : guard.detail
                }) :
                client.intlGet(guildId, 'credentialsLoginDeviceGuard');
            components.push(DiscordButtons.getCredentialsLoginCodeButton(guildId));
        }

        return await reply(client, interaction, 0, description, components);
    }
    catch (e) {
        deleteFlow(client, interaction.user.id);
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginFailed', {
            error: getErrorMessage(e)
        }));
    }
}

/* Step 2a: the Steam Guard code from the e-mail or the authenticator. */
async function submitCode(client, interaction, code) {
    const guildId = interaction.guildId;
    const entry = getFlow(client, interaction.user.id);

    if (entry === null) {
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginExpired'));
    }

    try {
        await entry.flow.submitCode(code);
    }
    catch (e) {
        deleteFlow(client, interaction.user.id);
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginFailed', {
            error: getErrorMessage(e)
        }));
    }

    return await complete(client, interaction, entry.flow);
}

/* Step 2b: the confirmation in the Steam mobile app was accepted. */
async function confirm(client, interaction) {
    const entry = getFlow(client, interaction.user.id);

    if (entry === null) {
        return await reply(client, interaction, 1,
            client.intlGet(interaction.guildId, 'credentialsLoginExpired'));
    }

    /* Check with Steam immediately instead of waiting for the next poll of the app confirmation. */
    entry.flow.forcePoll();

    return await complete(client, interaction, entry.flow);
}

/*
    Step 3 of every login: the account token is stored, the Discord user becomes its owner, the servers and paired
    devices of the account are adopted, their messages are posted and the active server reconnects.
*/
async function finish(client, interaction, { steamId, token, servers, refreshToken = null }) {
    const guildId = interaction.guildId;

    try {
        /* The refresh token allows renewing the account token later without a Steam Guard prompt. */
        const stored = RustPlusLogin.storeAuth(steamId, token, servers, refreshToken);

        /* The login registers the Discord user as the owner of the steam account, /credentials show lists it. */
        registerCredentials(guildId, steamId, interaction.member.user.id);

        /* Servers and paired devices of the account. */
        const instance = client.getInstance(guildId);

        /*
            A server that was removed in Discord stays removed, also after a login: the deletion is the decision of the
            user, only a new pairing in the Rust+ app (a newer pairing notification) brings it back.
        */

        const applied = RustPlusSync.applySyncServers(instance, steamId, servers,
            (key) => client.intlGet(guildId, key));

        if (applied.skipped.length !== 0) {
            client.log(client.intlGet(null, 'infoCap'),
                `${applied.skipped.length} server(s) were not adopted again, they were removed in Discord. ` +
                'Pair them again in the Rust+ app to get them back.');
        }

        /* Devices that were paired in-game but not added in the app are only in the notification history. */
        let paired = { devices: 0 };
        try {
            const history = await RustPlusHistory.fetchHistory(token);
            const entries = RustPlusHistory.parsePairingEntries(history);

            paired = RustPlusHistory.applyPairingEntries(instance, steamId, entries,
                (key) => client.intlGet(guildId, key));
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'),
                `Could not read the pairing history: ${e && e.message ? e.message : e}`, 'warn');
        }

        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'),
            `Rust+ login: ${applied.servers} server(s), ${applied.created} newly created, ` +
            `${applied.devices + paired.devices} device(s) adopted.`);

        /* Post the server messages, otherwise the new servers are invisible in Discord. */
        const serverIds = Object.keys(instance.serverList);
        for (const serverId of serverIds) {
            await DiscordMessages.sendServerMessage(guildId, serverId, null);
        }

        /*
            The devices get their Discord messages when the server connects. With a single server it is activated
            right here, with several the user picks one in the servers channel.
        */
        let activated = null;

        if (instance.activeServer === null && serverIds.length === 1) {
            const serverId = serverIds[0];
            const server = instance.serverList[serverId];

            instance.activeServer = serverId;
            client.setInstance(guildId, instance);

            client.createRustplusInstance(guildId, server.serverIp, server.appPort, server.steamId,
                server.playerToken);

            activated = serverId;
        }
        else {
            restartActiveServer(client, guildId);
        }

        const expires = RustPlusTransport.getAuthTokenExpiry(token);

        /* A login without a refresh token cannot renew itself, the expiry handler reminds the user by DM. */
        const hint = stored.steamRefreshToken ? '' : `\n\n${client.intlGet(guildId, 'credentialsLoginTokenHint')}`;

        return await reply(client, interaction, 0, client.intlGet(guildId, 'credentialsLoginSuccess', {
            steamId: `${steamId}`,
            servers: `${applied.servers}`,
            expires: expires === null ? '?' : `<t:${expires}:f>`
        }) + (activated === null ? '' : `\n\n${client.intlGet(guildId, 'credentialsLoginConnected', {
            server: `${instance.serverList[activated].title}`
        })}`) + hint);
    }
    catch (e) {
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginFailed', {
            error: getErrorMessage(e)
        }));
    }
    finally {
        deleteFlow(client, interaction.user.id);
    }
}

/*
    Step 1 of the QR login: Steam returns a challenge that the user confirms in the Steam app. The image is built here,
    the URL never leaves the bot - it is a one time approval of a login.
*/
async function startQr(client, interaction) {
    const guildId = interaction.guildId;

    deleteFlow(client, interaction.user.id);

    let flow = null;
    let qr = null;

    try {
        client.log(client.intlGet(null, 'infoCap'), 'Rust+ login: asking Steam for a QR challenge.');

        flow = new RustPlusLogin.SteamLogin({
            timeoutMs: FLOW_TIMEOUT_MS,
            log: (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug')
        });

        storeFlow(client, interaction.user.id, flow);

        const url = await flow.startQr();
        qr = await QrCode.toBuffer(url, { type: 'png', width: 320, margin: 1 });
    }
    catch (e) {
        deleteFlow(client, interaction.user.id);
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginQrFailed', {
            error: getErrorMessage(e)
        }));
    }

    await reply(client, interaction, 0, client.intlGet(guildId, 'credentialsLoginQrIntro'), [
        DiscordButtons.getCredentialsLoginDoneButton(guildId),
        DiscordButtons.getCredentialsLoginPasswordButton(guildId)
    ], [new Discord.AttachmentBuilder(qr, { name: 'steam-qr.png' })]);

    return await complete(client, interaction, flow, { qr: true });
}

/*
    Step 1 of the token login: the account token is copied out of the own browser (app.playrust.com), so neither the
    password nor a Steam Guard code goes through Discord. The token carries the steam id and its expiry.
*/
async function token(client, interaction, rawToken) {
    const guildId = interaction.guildId;
    const accountToken = `${rawToken === undefined || rawToken === null ? '' : rawToken}`
        .trim().replace(/^`+/, '').replace(/`+$/, '');

    const steamId = RustPlusAuth.getTokenSteamId(accountToken);
    if (steamId === null) {
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginTokenInvalid'));
    }

    const expires = RustPlusTransport.getAuthTokenExpiry(accountToken);
    if (expires !== null && expires <= Math.floor(Date.now() / 1000)) {
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginTokenExpired'));
    }

    let data = null;
    try {
        client.log(client.intlGet(null, 'infoCap'), `Rust+ login: reading the account of ${steamId}.`);
        data = await RustPlusLogin.fetchSyncData(accountToken);
    }
    catch (e) {
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginTokenRejected', {
            error: getErrorMessage(e)
        }));
    }

    return await finish(client, interaction, {
        steamId: steamId,
        token: accountToken,
        servers: data.servers,
        refreshToken: null
    });
}

/* Step 2 of the password and the QR login: Steam finished, the Rust+ account of the login is read. */
async function complete(client, interaction, flow, options = {}) {
    const guildId = interaction.guildId;

    try {
        const cookies = await flow.wait();

        client.log(client.intlGet(null, 'infoCap'), 'Rust+ login: Steam finished, reading the Rust+ account.');

        const auth = await RustPlusLogin.loginToRustPlus(cookies,
            (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug'));
        const data = await RustPlusLogin.fetchSyncData(auth.token);

        return await finish(client, interaction, {
            steamId: auth.steamId,
            token: auth.token,
            servers: data.servers,
            refreshToken: flow.getRefreshToken()
        });
    }
    catch (e) {
        const expired = options.qr === true && /timed out/i.test(getErrorMessage(e));

        return await reply(client, interaction, 1, expired ?
            client.intlGet(guildId, 'credentialsLoginQrExpired') :
            client.intlGet(guildId, 'credentialsLoginFailed', { error: getErrorMessage(e) }));
    }
    finally {
        deleteFlow(client, interaction.user.id);
    }
}

module.exports = {
    start: start,
    startQr: startQr,
    token: token,
    submitCode: submitCode,
    confirm: confirm,
    complete: complete,
    finish: finish,
    getFlow: getFlow,
    getLoginChooser: getLoginChooser,
};
