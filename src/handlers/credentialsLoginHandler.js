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

const Constants = require('../util/constants.js');
const DiscordButtons = require('../discordTools/discordButtons.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const RustPlusAuth = require('../util/rustplusAuth.js');
const RustPlusLogin = require('../util/rustplusLogin.js');
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

async function reply(client, interaction, color, description, components = []) {
    const content = {
        embeds: [DiscordEmbeds.getEmbed({
            color: color === 0 ? Constants.COLOR_ACTIVE : Constants.COLOR_INACTIVE,
            description: description
        })],
        components: components
    };

    return await client.interactionEditReply(interaction, content);
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

/* Step 1 of the login: Steam credentials, then either the code prompt or the finish. */
async function start(client, interaction, accountName, password) {
    const guildId = interaction.guildId;

    deleteFlow(client, interaction.user.id);

    let flow = null;
    let guard = null;

    try {
        flow = new RustPlusLogin.SteamLogin({
            accountName: accountName,
            password: password,
            timeoutMs: FLOW_TIMEOUT_MS,
            log: (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug')
        });

        storeFlow(client, interaction.user.id, flow);

        guard = await flow.start();
    }
    catch (e) {
        deleteFlow(client, interaction.user.id);
        return await reply(client, interaction, 1, client.intlGet(guildId, 'credentialsLoginFailed', {
            error: getErrorMessage(e)
        }));
    }

    if (guard === null) return await complete(client, interaction, flow);

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

/* Step 3: Rust+ token, server list and local storage. */
async function complete(client, interaction, flow) {
    const guildId = interaction.guildId;

    try {
        const cookies = await flow.wait();
        const auth = await RustPlusLogin.loginToRustPlus(cookies,
            (text) => client.log(client.intlGet(null, 'infoCap'), text, 'debug'));
        const servers = await RustPlusLogin.fetchServerList(auth.token);

        RustPlusLogin.storeAuth(auth.steamId, auth.token, servers);

        const instance = client.getInstance(guildId);
        const matched = RustPlusAuth.applyServerGuids(instance, servers);
        client.setInstance(guildId, instance);

        restartActiveServer(client, guildId);

        const expires = RustPlusTransport.getAuthTokenExpiry(auth.token);

        return await reply(client, interaction, 0, client.intlGet(guildId, 'credentialsLoginSuccess', {
            steamId: `${auth.steamId}`,
            servers: `${matched}`,
            expires: expires === null ? '?' : `<t:${expires}:f>`
        }));
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

module.exports = {
    start: start,
    submitCode: submitCode,
    confirm: confirm,
    complete: complete,
    getFlow: getFlow,
};
