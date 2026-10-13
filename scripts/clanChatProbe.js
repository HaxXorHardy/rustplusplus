#!/usr/bin/env node
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
    Standalone diagnostic for the clan chat of the Rust+ API (getClanInfo / getClanChat / sendClanMessage).

    It connects directly to a paired rust server (the pairing credentials are read from the rustplusplus
    instance file) and prints the clan info and the clan chat history of the paired account. It does not
    use the running bot, which makes it possible to check clan chat support of a server without restarting
    the bot and without the "which chat channel did I use" ambiguity.

    Usage:
        node scripts/clanChatProbe.js [--guild=<guildId>] [--server=<ip-appPort>] [--send] [--timeout=<ms>]

    --guild    Instance file (guild id) to use, defaults to the only file in the instances folder.
    --server   Server id (ip-appPort) from that instance file, defaults to activeServer.
    --send     Also send a probe message to the clan chat (visible for the clan in-game!) and print the result.
    --send-team Also send a probe message to the team chat (visible for the team in-game!) and print the result.
    --timeout  Timeout per request in milliseconds, defaults to 10000.
*/

const Fs = require('fs');
const Path = require('path');

const RustPlusLib = require('@liamcottle/rustplus.js');
const { isResponseFailure, describeResponse } = require('../src/util/responseUtils.js');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
    console.log('Usage: node scripts/clanChatProbe.js [--guild=<guildId>] [--server=<ip-appPort>] [--send] ' +
        '[--timeout=<ms>]');
}

function parseArgs(argv) {
    const options = {
        guildId: null,
        serverId: null,
        send: false,
        sendTeam: false,
        timeoutMs: 10000,
        help: false,
    };

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--send') {
            options.send = true;
            continue;
        }
        if (arg === '--send-team') {
            options.sendTeam = true;
            continue;
        }
        if (arg.startsWith('--guild=')) {
            options.guildId = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--server=')) {
            options.serverId = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg.startsWith('--timeout=')) {
            const value = Number.parseInt(arg.split('=').slice(1).join('='), 10);
            if (!Number.isNaN(value) && value > 0) options.timeoutMs = value;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

function listInstanceFiles() {
    const instancesDirectory = Path.join(__dirname, '..', 'instances');
    if (!Fs.existsSync(instancesDirectory)) return [];

    return Fs.readdirSync(instancesDirectory)
        .filter((e) => e.endsWith('.json') && !e.endsWith('.tmp'))
        .map((e) => e.slice(0, -'.json'.length));
}

function readInstance(guildId) {
    const instancePath = Path.join(__dirname, '..', 'instances', `${guildId}.json`);
    return JSON.parse(Fs.readFileSync(instancePath, 'utf8'));
}

function printClanInfo(response) {
    if (isResponseFailure(response)) {
        console.log(`[clan-probe] getClanInfo failed: ${describeResponse(response)}`);
        return;
    }
    if (!response.clanInfo) {
        console.log('[clan-probe] getClanInfo: no clanInfo in response (not supported by this server).');
        return;
    }

    /* AppResponse.clanInfo is an AppClanInfo wrapper, the actual data is nested in its clanInfo. */
    const clanInfo = response.clanInfo.clanInfo;
    if (!clanInfo) {
        console.log('[clan-probe] getClanInfo: response received, but the account is not in a clan.');
        return;
    }

    const members = Array.isArray(clanInfo.members) ? clanInfo.members : [];
    console.log(`[clan-probe] clan="${clanInfo.name}" clanId=${clanInfo.clanId} ` +
        `members=${members.length}/${clanInfo.maxMemberCount} motd="${clanInfo.motd || ''}"`);
    for (const member of members) {
        console.log(`[clan-probe]   member: ${member.name} (${member.steamId})`);
    }
}

function printClanChat(response) {
    if (isResponseFailure(response)) {
        console.log(`[clan-probe] getClanChat failed: ${describeResponse(response)}`);
        return;
    }
    if (!response.clanChat) {
        console.log('[clan-probe] getClanChat: no clanChat in response (not supported by this server).');
        return;
    }

    const messages = Array.isArray(response.clanChat.messages) ? response.clanChat.messages : [];
    console.log(`[clan-probe] getClanChat: ${messages.length} message(s) in clan chat history.`);
    for (const message of messages) {
        console.log(`[clan-probe]   ${message.name} (${message.steamId}): ${message.message}`);
    }
}

async function request(rustplus, data, timeoutMs) {
    return await rustplus.sendRequestAsync(data, timeoutMs).catch((e) => e);
}

function printTeamInfo(response) {
    if (isResponseFailure(response)) {
        console.log(`[clan-probe] getTeamInfo failed: ${describeResponse(response)}`);
        return;
    }
    if (!response.teamInfo) {
        console.log('[clan-probe] getTeamInfo: no teamInfo in response.');
        return;
    }

    const members = Array.isArray(response.teamInfo.members) ? response.teamInfo.members : [];
    console.log(`[clan-probe] team: leaderSteamId=${response.teamInfo.leaderSteamId} members=${members.length}`);
    for (const member of members) {
        console.log(`[clan-probe]   team member: ${member.name} (${member.steamId}) online=${member.isOnline}`);
    }
}

function printTeamChat(response) {
    if (isResponseFailure(response)) {
        console.log(`[clan-probe] getTeamChat failed: ${describeResponse(response)}`);
        return;
    }
    if (!response.teamChat) {
        console.log('[clan-probe] getTeamChat: no teamChat in response.');
        return;
    }

    const messages = Array.isArray(response.teamChat.messages) ? response.teamChat.messages : [];
    console.log(`[clan-probe] getTeamChat: ${messages.length} message(s) in team chat history.`);
    for (const message of messages) {
        console.log(`[clan-probe]   ${message.name} (${message.steamId}): ${message.message}`);
    }
}

async function main() {
    let options = null;
    try {
        options = parseArgs(process.argv.slice(2));
    }
    catch (e) {
        console.error(`[clan-probe] ${e.message}`);
        printHelp();
        process.exit(1);
    }

    if (options.help) {
        printHelp();
        return;
    }

    let guildId = options.guildId;
    if (guildId === null) {
        const guildIds = listInstanceFiles();
        if (guildIds.length !== 1) {
            console.error(`[clan-probe] Could not determine the instance file automatically ` +
                `(found ${guildIds.length}). Use --guild=<guildId>.`);
            process.exit(1);
        }
        guildId = guildIds[0];
    }

    const instance = readInstance(guildId);
    const serverId = options.serverId || instance.activeServer;
    const server = instance.serverList[serverId];

    if (!server) {
        console.error(`[clan-probe] Unknown server "${serverId}" for guild ${guildId}. ` +
            `Known: ${Object.keys(instance.serverList).join(', ')}`);
        process.exit(1);
    }

    console.log(`[clan-probe] guild=${guildId} server=${serverId} title="${server.title}" ` +
        `endpoint=${server.serverIp}:${server.appPort} steamId=${server.steamId}`);

    const rustplus = new RustPlusLib(server.serverIp, server.appPort, server.steamId, server.playerToken);

    /* Log every broadcast the server pushes, so clan chat broadcasts become visible. */
    rustplus.on('message', (message) => {
        if (!message.broadcast) return;

        console.log(`[clan-probe] broadcast: ${Object.keys(message.broadcast).join(', ')}`);

        const clanMessage = message.broadcast.clanMessage;
        if (clanMessage && clanMessage.message) {
            console.log(`[clan-probe] CLAN CHAT: ${clanMessage.message.name} ` +
                `(${clanMessage.message.steamId}): ${clanMessage.message.message}`);
        }

        const teamMessage = message.broadcast.teamMessage;
        if (teamMessage && teamMessage.message) {
            console.log(`[clan-probe] TEAM CHAT: ${teamMessage.message.name} ` +
                `(${teamMessage.message.steamId}): ${teamMessage.message.message}`);
        }
    });

    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout while connecting')), options.timeoutMs);
            rustplus.on('connected', () => {
                clearTimeout(timer);
                resolve();
            });
            rustplus.on('error', (e) => {
                console.log(`[clan-probe] socket error: ${e && e.message ? e.message : e}`);
            });
            rustplus.connect();
        });

        console.log('[clan-probe] connected.');

        printTeamInfo(await request(rustplus, { getTeamInfo: {} }, options.timeoutMs));
        printClanInfo(await request(rustplus, { getClanInfo: {} }, options.timeoutMs));
        printClanChat(await request(rustplus, { getClanChat: {} }, options.timeoutMs));
        printTeamChat(await request(rustplus, { getTeamChat: {} }, options.timeoutMs));

        if (options.sendTeam) {
            const probeTeam = `RPP team chat probe ${Date.now()}`;
            console.log(`[clan-probe] Sending team message: "${probeTeam}"`);
            console.log('[clan-probe] sendTeamMessage result: ' +
                `${describeResponse(await request(rustplus, { sendTeamMessage: { message: probeTeam } }, options.timeoutMs))}`);

            await sleep(2000);
            printTeamChat(await request(rustplus, { getTeamChat: {} }, options.timeoutMs));
        }

        if (options.send) {
            const probe = `RPP clan chat probe ${Date.now()}`;
            console.log(`[clan-probe] Sending clan message: "${probe}"`);
            console.log('[clan-probe] sendClanMessage result: ' +
                `${describeResponse(await request(rustplus, { sendClanMessage: { message: probe } }, options.timeoutMs))}`);

            await sleep(2000);
            printClanChat(await request(rustplus, { getClanChat: {} }, options.timeoutMs));

            /* Cross check: on some server builds the clan chat is delivered through the team chat channel. */
            printTeamChat(await request(rustplus, { getTeamChat: {} }, options.timeoutMs));
        }

        /* Keep the socket open for a moment to catch broadcasts that are pushed live. */
        console.log('[clan-probe] Listening for broadcasts for 5 seconds ...');
        await sleep(5000);
    }
    catch (e) {
        console.error(`[clan-probe] Failed: ${e && e.message ? e.message : e}`);
        rustplus.disconnect();
        process.exit(1);
    }

    rustplus.disconnect();
    console.log('[clan-probe] done.');
}

main();
