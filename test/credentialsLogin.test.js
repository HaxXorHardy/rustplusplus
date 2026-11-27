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
    The three login ways of /credentials login: the QR code and the pasted token keep the Steam credentials out of
    Discord, the password modal stays as the fallback. The tests replace the Steam session, the Rust+ requests and the
    Discord side, so only the flow of the handler is checked.
*/

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const CredentialRevocation = require('../src/util/credentialRevocation.js');
const CredentialsLoginHandler = require('../src/handlers/credentialsLoginHandler.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');
const InstanceUtils = require('../src/util/instanceUtils.js');
const RustPlusHistory = require('../src/util/rustplusHistory.js');
const RustPlusLogin = require('../src/util/rustplusLogin.js');
const RustPlusSync = require('../src/util/rustplusSync.js');

const GUILD_ID = '1474484924093432003';
const USER_ID = '1474484924093432999';
const STEAM_ID = '76561198190865617';

/* A Rust+ account token: the payload carries the steam id and the expiry, the rest is not read by the bot. */
function makeToken(steamId, expSeconds) {
    const payload = Buffer.from(JSON.stringify({
        steamId: steamId, version: 1, iss: 1794336686, exp: expSeconds
    }), 'utf8').toString('base64');

    return `${payload}.signature`;
}

function fakeClient(t) {
    const replies = [];
    const instance = { activeServer: null, serverList: {} };

    const client = {
        intlGet: (guildId, key, variables = {}) => {
            const values = Object.keys(variables).map((name) => `${name}=${variables[name]}`);
            return values.length === 0 ? key : `${key}(${values.join(',')})`;
        },
        log: () => undefined,
        interactionEditReply: async (interaction, content) => {
            replies.push(content);
            return content;
        },
        getInstance: () => instance,
        setInstance: () => undefined,
        createRustplusInstance: () => undefined,
        rustplusInstances: {},
        rustplusReconnectTimers: {}
    };

    Client.client = client;
    t.after(() => {
        Client.client = null;
    });

    return { client, replies, instance };
}

function fakeInteraction() {
    return {
        guildId: GUILD_ID,
        user: { id: USER_ID },
        member: { user: { id: USER_ID } },
    };
}

/* Replaces the parts of the handler that talk to Steam, the Rust+ API and Discord. */
function stubDependencies(t, options = {}) {
    const calls = { storeAuth: [], fetchSyncData: [], sendServerMessage: [], loginToRustPlus: [] };

    const original = {
        SteamLogin: RustPlusLogin.SteamLogin,
        loginToRustPlus: RustPlusLogin.loginToRustPlus,
        fetchSyncData: RustPlusLogin.fetchSyncData,
        storeAuth: RustPlusLogin.storeAuth,
        applySyncServers: RustPlusSync.applySyncServers,
        fetchHistory: RustPlusHistory.fetchHistory,
        applyPairingEntries: RustPlusHistory.applyPairingEntries,
        sendServerMessage: DiscordMessages.sendServerMessage,
    };

    RustPlusLogin.SteamLogin = options.SteamLogin || original.SteamLogin;
    RustPlusLogin.loginToRustPlus = async (cookies) => {
        calls.loginToRustPlus.push(cookies);
        if (options.loginError) throw new Error(options.loginError);
        return { steamId: STEAM_ID, token: makeToken(STEAM_ID, Math.floor(Date.now() / 1000) + 86400) };
    };
    RustPlusLogin.fetchSyncData = async (token) => {
        calls.fetchSyncData.push(token);
        if (options.fetchSyncDataError) throw new Error(options.fetchSyncDataError);
        return { servers: options.servers || [] };
    };
    RustPlusLogin.storeAuth = (steamId, token, servers, refreshToken, storeOptions = {}) => {
        calls.storeAuth.push({ steamId, token, servers, refreshToken, keepRefreshToken: storeOptions.keepRefreshToken });

        /* The real storeAuth keeps a refresh token that is already stored (unless told not to). */
        const kept = storeOptions.keepRefreshToken === false ? null : options.existingRefreshToken;
        return { steamId, token, steamRefreshToken: refreshToken || kept || null };
    };

    /* The owners of the account over every guild (never the real credentials folder). */
    original.getOwners = CredentialRevocation.getOwners;
    CredentialRevocation.getOwners = () => options.owners || [];
    RustPlusSync.applySyncServers = () => ({ servers: 1, created: 0, devices: 0, skipped: [] });
    RustPlusHistory.fetchHistory = async () => [];
    RustPlusHistory.applyPairingEntries = () => ({ devices: 0 });

    /* The login registers the Discord user in the credentials file of the guild. */
    original.readCredentialsFile = InstanceUtils.readCredentialsFile;
    original.writeCredentialsFile = InstanceUtils.writeCredentialsFile;
    InstanceUtils.readCredentialsFile = () => ({ hoster: null });
    InstanceUtils.writeCredentialsFile = () => undefined;
    DiscordMessages.sendServerMessage = async (guildId, serverId) => {
        calls.sendServerMessage.push(serverId);
    };

    t.after(() => {
        RustPlusLogin.SteamLogin = original.SteamLogin;
        RustPlusLogin.loginToRustPlus = original.loginToRustPlus;
        RustPlusLogin.fetchSyncData = original.fetchSyncData;
        RustPlusLogin.storeAuth = original.storeAuth;
        RustPlusSync.applySyncServers = original.applySyncServers;
        RustPlusHistory.fetchHistory = original.fetchHistory;
        RustPlusHistory.applyPairingEntries = original.applyPairingEntries;
        InstanceUtils.readCredentialsFile = original.readCredentialsFile;
        InstanceUtils.writeCredentialsFile = original.writeCredentialsFile;
        DiscordMessages.sendServerMessage = original.sendServerMessage;
        CredentialRevocation.getOwners = original.getOwners;
    });

    return calls;
}

/* A steam login session that delivers the given cookies/refresh token, or fails like Steam does. */
function fakeSteamLogin(state) {
    return class {
        constructor() {
            state.created = (state.created || 0) + 1;
        }

        async startQr() {
            if (state.startQrError) throw new Error(state.startQrError);
            return state.qrUrl || 'https://s.team/q/1234567890';
        }

        async wait() {
            if (state.waitError) throw new Error(state.waitError);
            return ['steamLoginSecure=abc'];
        }

        getRefreshToken() {
            return state.refreshToken === undefined ? 'refresh-token' : state.refreshToken;
        }
    };
}

Test.describe('CredentialsLoginHandler.token', () => {
    Test.it('rejects a value that is not an account token', async (t) => {
        const { client, replies } = fakeClient(t);
        const calls = stubDependencies(t);

        await CredentialsLoginHandler.token(client, fakeInteraction(), 'not-a-token');

        Assert.strictEqual(replies.length, 1);
        Assert.ok(String(replies[0].embeds[0].toJSON().description).startsWith('credentialsLoginTokenInvalid'));
        Assert.deepStrictEqual(calls.storeAuth, []);
    });

    Test.it('rejects an expired token', async (t) => {
        const { client, replies } = fakeClient(t);
        const calls = stubDependencies(t);
        const expired = makeToken(STEAM_ID, Math.floor(Date.now() / 1000) - 60);

        await CredentialsLoginHandler.token(client, fakeInteraction(), expired);

        Assert.ok(String(replies[0].embeds[0].toJSON().description).startsWith('credentialsLoginTokenExpired'));
        Assert.deepStrictEqual(calls.storeAuth, []);
    });

    Test.it('rejects a token that Steam does not accept', async (t) => {
        const { client, replies } = fakeClient(t);
        stubDependencies(t, { fetchSyncDataError: 'HTTP 401' });

        await CredentialsLoginHandler.token(client, fakeInteraction(),
            makeToken(STEAM_ID, Math.floor(Date.now() / 1000) + 86400));

        Assert.ok(String(replies[0].embeds[0].toJSON().description).startsWith('credentialsLoginTokenRejected'));
    });

    Test.it('stores the token of a valid login', async (t) => {
        const { client, replies } = fakeClient(t);
        const token = makeToken(STEAM_ID, Math.floor(Date.now() / 1000) + 86400);
        const calls = stubDependencies(t, { servers: [{ id: 'abc', name: 'Test Server' }] });

        await CredentialsLoginHandler.token(client, fakeInteraction(), `  \`${token}\`  `);

        Assert.strictEqual(calls.storeAuth.length, 1);
        Assert.strictEqual(calls.storeAuth[0].steamId, STEAM_ID);
        Assert.strictEqual(calls.storeAuth[0].token, token);
        Assert.strictEqual(calls.storeAuth[0].refreshToken, null);
        Assert.deepStrictEqual(calls.fetchSyncData, [token]);

        const description = String(replies[0].embeds[0].toJSON().description);
        Assert.ok(description.startsWith('credentialsLoginSuccess'));
        Assert.ok(description.includes('credentialsLoginTokenHint'), 'a login without refresh token has to warn');
    });

    Test.it('keeps the warning out when a refresh token is already stored', async (t) => {
        const { client, replies } = fakeClient(t);
        const token = makeToken(STEAM_ID, Math.floor(Date.now() / 1000) + 86400);
        stubDependencies(t, { existingRefreshToken: 'stored-refresh-token' });

        await CredentialsLoginHandler.token(client, fakeInteraction(), token);

        const description = String(replies[0].embeds[0].toJSON().description);
        Assert.ok(!description.includes('credentialsLoginTokenHint'));
    });

    Test.it('does not carry over the refresh token of another owner of the account', async (t) => {
        const { client, replies } = fakeClient(t);
        const token = makeToken(STEAM_ID, Math.floor(Date.now() / 1000) + 86400);
        const calls = stubDependencies(t, { existingRefreshToken: 'other-owner-refresh', owners: ['someone-else'] });

        await CredentialsLoginHandler.token(client, fakeInteraction(), token);

        Assert.strictEqual(calls.storeAuth[0].keepRefreshToken, false);
        Assert.ok(String(replies[0].embeds[0].toJSON().description).includes('credentialsLoginTokenHint'));
    });

    Test.it('keeps the own refresh token on a token login of the same owner', async (t) => {
        const { client } = fakeClient(t);
        const token = makeToken(STEAM_ID, Math.floor(Date.now() / 1000) + 86400);
        const calls = stubDependencies(t, { existingRefreshToken: 'own-refresh', owners: [USER_ID] });

        await CredentialsLoginHandler.token(client, fakeInteraction(), token);

        Assert.strictEqual(calls.storeAuth[0].keepRefreshToken, true);
    });
});

Test.describe('CredentialsLoginHandler.startQr', () => {
    Test.it('renders the QR challenge and finishes the login', async (t) => {
        const { client, replies } = fakeClient(t);
        const state = { refreshToken: 'qr-refresh-token' };
        const calls = stubDependencies(t, { SteamLogin: fakeSteamLogin(state) });

        await CredentialsLoginHandler.startQr(client, fakeInteraction());

        /* First reply: the picture and the hint, second one: the success report. */
        Assert.strictEqual(replies.length, 2);
        Assert.strictEqual(replies[0].files.length, 1);
        Assert.ok(Buffer.isBuffer(replies[0].files[0]) || typeof replies[0].files[0] === 'object');
        Assert.strictEqual(state.created, 1);

        Assert.strictEqual(calls.storeAuth.length, 1);
        Assert.strictEqual(calls.storeAuth[0].steamId, STEAM_ID);
        Assert.strictEqual(calls.storeAuth[0].refreshToken, 'qr-refresh-token');
        Assert.ok(String(replies[1].embeds[0].toJSON().description).startsWith('credentialsLoginSuccess'));
    });

    Test.it('reports an expired QR challenge', async (t) => {
        const { client, replies } = fakeClient(t);
        stubDependencies(t, { SteamLogin: fakeSteamLogin({ waitError: 'Steam login timed out.' }) });

        await CredentialsLoginHandler.startQr(client, fakeInteraction());

        Assert.strictEqual(replies.length, 2);
        Assert.strictEqual(String(replies[1].embeds[0].toJSON().description), 'credentialsLoginQrExpired');
    });

    Test.it('reports a challenge that Steam did not create', async (t) => {
        const { client, replies } = fakeClient(t);
        stubDependencies(t, { SteamLogin: fakeSteamLogin({ startQrError: 'Steam is offline.' }) });

        await CredentialsLoginHandler.startQr(client, fakeInteraction());

        Assert.strictEqual(replies.length, 1);
        Assert.ok(String(replies[0].embeds[0].toJSON().description).startsWith('credentialsLoginQrFailed'));
    });

    Test.it('forgets the session of the user after the login', async (t) => {
        const { client } = fakeClient(t);
        stubDependencies(t, { SteamLogin: fakeSteamLogin({}) });

        const interaction = fakeInteraction();
        await CredentialsLoginHandler.startQr(client, interaction);

        Assert.strictEqual(CredentialsLoginHandler.getFlow(client, interaction.user.id), null);
    });
});

/* A Steam session whose approval the test hands out, and that records polls and cancellations. */
function controllableSteamLogin(sessions) {
    return class {
        constructor() {
            this.cancelled = false;
            this.polls = 0;
            this.cookies = new Promise((resolve, reject) => {
                this.approve = () => resolve(['steamLoginSecure=abc']);
                this.rejectCookies = reject;
            });
            this.cookies.catch(() => undefined);
            sessions.push(this);
        }

        async startQr() {
            return 'https://s.team/q/1234567890';
        }

        forcePoll() {
            this.polls += 1;
        }

        cancel() {
            this.cancelled = true;
            this.rejectCookies(new Error('Steam login was cancelled.'));
        }

        async wait() {
            return await this.cookies;
        }

        getRefreshToken() {
            return 'refresh-token';
        }
    };
}

/* Lets the handler run up to the point where it waits for Steam. */
async function settle() {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

Test.describe('CredentialsLoginHandler flows', () => {
    Test.it('finishes a QR login once when "Done" is pressed while it waits for Steam', async (t) => {
        const { client, replies } = fakeClient(t);
        const sessions = [];
        const calls = stubDependencies(t, { SteamLogin: controllableSteamLogin(sessions) });

        const qrInteraction = fakeInteraction();
        const qr = CredentialsLoginHandler.startQr(client, qrInteraction);
        await settle();

        const doneInteraction = fakeInteraction();
        const done = CredentialsLoginHandler.confirm(client, doneInteraction);
        const doneAgain = CredentialsLoginHandler.confirm(client, fakeInteraction());
        await settle();

        sessions[0].approve();
        await Promise.all([qr, done, doneAgain]);

        Assert.strictEqual(sessions[0].polls, 2, 'every press asks Steam right away');
        Assert.strictEqual(calls.loginToRustPlus.length, 1, 'only one Rust+ token is minted');
        Assert.strictEqual(calls.storeAuth.length, 1);

        /* QR picture, the success of the QR message and the same outcome for both button presses. */
        const successes = replies.filter((e) =>
            String(e.embeds[0].toJSON().description).startsWith('credentialsLoginSuccess'));
        Assert.strictEqual(successes.length, 3);
    });

    Test.it('cancels the open Steam login when a new login replaces it', async (t) => {
        const { client, replies } = fakeClient(t);
        const sessions = [];
        const calls = stubDependencies(t, { SteamLogin: controllableSteamLogin(sessions) });

        const first = CredentialsLoginHandler.startQr(client, fakeInteraction());
        await settle();

        const second = CredentialsLoginHandler.startQr(client, fakeInteraction());
        await settle();

        Assert.strictEqual(sessions[0].cancelled, true, 'the replaced session stops polling Steam');
        Assert.strictEqual(sessions[1].cancelled, false);

        await first;

        /* The replaced login neither reports an error over the new one nor removes the new flow. */
        Assert.ok(!replies.some((e) => String(e.embeds[0].toJSON().description).startsWith('credentialsLoginFailed')));
        Assert.strictEqual(CredentialsLoginHandler.getFlow(client, USER_ID).flow, sessions[1]);

        sessions[1].approve();
        await second;

        Assert.strictEqual(calls.storeAuth.length, 1);
        Assert.strictEqual(CredentialsLoginHandler.getFlow(client, USER_ID), null);
        Assert.strictEqual(sessions[1].cancelled, true, 'a finished login does not keep its session');
    });

    Test.it('leaves an open Steam login alone when a token login finishes', async (t) => {
        const { client } = fakeClient(t);
        const sessions = [];
        stubDependencies(t, { SteamLogin: controllableSteamLogin(sessions) });

        const qr = CredentialsLoginHandler.startQr(client, fakeInteraction());
        await settle();

        await CredentialsLoginHandler.token(client, fakeInteraction(),
            makeToken(STEAM_ID, Math.floor(Date.now() / 1000) + 86400));

        Assert.strictEqual(CredentialsLoginHandler.getFlow(client, USER_ID).flow, sessions[0]);

        sessions[0].approve();
        await qr;
    });
});
