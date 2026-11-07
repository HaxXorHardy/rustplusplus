# Frequently Asked Questions
- [When I run 'npm install' I get an error](#when-i-run-npm-install-i-get-an-error)
- [I've added the credentials but when I pair I get no notification](#credentials-added-but-no-pair-notification)
- [The bot keep resetting channel permissions after restart](#bot-reset-channel-permissions)
- [Im getting 'ERROR: {"code":"DisallowedIntents"}' when trying to start the bot](#disallowed-intents)
- [Im getting 'ERROR: {"code": "TokenInvalid"}' when trying to start the bot](#token-invalid)
- [Im getting 'ERROR: SyntaxError: Unexpected token '', ""... is not valid JSON' or 'ERROR: SyntaxError: Unexpected token in JSON at position 0' when trying to start the bot](#unexpected-token-invalid-json)
- [When trying to get my credentials from the app, it's completely empty](#credential-app-empty)
- [In-Game chat messages are not shown In-Game (or not mirrored to Discord) on some servers](#ingame-chat-on-some-servers)

<a name="when-i-run-npm-install-i-get-an-error"></a>
## When I run 'npm install' I get an error

If you're getting the error below, try running `npm i -g npm`. This should allow you to successfully do `npm install` afterwards.
![npm install error](docs/images/faq/npm-install-error.png)


<a name="credentials-added-but-no-pair-notification"></a>
## I've added the credentials but when I pair I get no notification

If you're having trouble getting a pair notifications (server/smart device), several things can be causing this. It's possible that the credentials you are currently using have been outdated, when generating credentials, they usually last for two weeks, so you can try to re-generate them through the [rustplusplus credential application](https://github.com/alexemanuelol/rustplusplus-credential-application) or the [rustplusplus website](https://rustplusplus-credentials.netlify.app/).

If you're still not getting any notifications and you are simultaneously using the rust companion app and are successfully getting pairing notifications there, this could be the issue. While it's possible to run both apps at the same time, it's not recommended. The reason for this is that using the same steam account credentials in different places makes the notifications a bit unstable, some notifications might still get through. In the scenario of trying to pair a server or a smart device, you can just try doing several attempts of pairing and eventually it will get through.


<a name="bot-reset-channel-permissions"></a>
## The bot keep resetting channel permissions after restart

This is intentional. While this might change in the future, the current solution for this is to use the /role command to set a specific role that will be allowed to view the channels.


<a name="disallowed-intents"></a>
## Im getting 'ERROR: {"code":"DisallowedIntents"}' when trying to start the bot

![DisallowedIntents](docs/images/faq/disallowedintents.png)

If you're getting this error it's because you missed a step in the setup guide (Step 9). Kick the bot from your discord server and go [here](https://github.com/HaxXorHardy/rustplusplus/blob/master/docs/discord_bot_setup.md) and follow the guide from step 9.


<a name="token-invalid"></a>
## Im getting 'ERROR: {"code": "TokenInvalid"}' when trying to start the bot

![TokenInvalid](docs/images/faq/token_invalid.png)

This happens when the token you placed in the config file is invalid. There have been cases where people clone the repository with git and also download the zip of the repository, ending having two separate repositories of the bot. The problem that have occured for these people is that they've placed the token in one respository and tried running the other one. So make sure that you are trying to start the correct bot that have the config setup with the token.


<a name="unexpected-token-invalid-json"></a>
## Im getting 'ERROR: SyntaxError: Unexpected token '', ""... is not valid JSON' when trying to start the bot

![Unexpected token in json 1](docs/images/faq/unexpected_token_invalid_json.png)
![Unexpected token in json 2](docs/images/faq/unexpected_token_invalid_json_at_pos_0.png)

This occurs for some people when their PC crash, there is still no solution for this but I hope to solve this in the future. Meanwhile you can follow the [issue on GitHub](https://github.com/HaxXorHardy/rustplusplus/issues) for updates. Current solution to be able to continue is to remove your instance file and let the bot create a new one when you start the bot next time.


<a name="credential-app-empty"></a>
## When trying to get my credentials from the app, it's completely empty

If the rustplusplus credential application looks like the image below after you've logged in with your steam details this might be because of where you live or something else blocking you from generating. The solution for you would be to try it on the [rustplusplus website](https://rustplusplus-credentials.netlify.app/) instead.

![credential app empty](docs/images/faq/empty-credential-app.png)


<a name="ingame-chat-on-some-servers"></a>
## In-Game chat messages are not shown In-Game (or not mirrored to Discord) on some servers

rustplusplus uses the chat of the Rust+ Companion API. That chat is always the **Team Chat** or the **Clan Chat** of the hoster's steam account (the Rust+ API has no global chat). Some rust servers handle that chat differently, which the bot cannot change:

* **Messages sent by the bot never appear In-Game:** the Rust+ API does not deliver every chat message. On some servers the request is answered *without* an error, but the message never reaches the In-Game chat; on other servers the AppError `message_not_sent` is returned even though the message *was* delivered (see [liamcottle/rustplus.js#31](https://github.com/liamcottle/rustplus.js/issues/31)). rustplusplus logs the server answer and, with `RPP_DEBUG=true`, also verifies the delivery using the team chat history.
* **In-Game chat messages are not mirrored to Discord:** the Rust+ API does not provide In-Game clan chat messages on many servers, so the `clanchat` Channel only works one way there (Discord -> In-Game).
* **Nothing appears In-Game although the bot is connected:** make sure you are looking at the right chat In-Game (Team Chat / Clan Chat, not the Global Chat).

You can check what a server supports without touching the running bot:

```
node scripts/clanChatProbe.js [--server=<ip-appPort>] [--send] [--send-team]
```

<a name="rustplus-connection-problems"></a>
## The bot cannot connect to the server (reconnect loop, `ECONNRESET` / `socket hang up`)

The bot reaches the Rust+ websocket of the server in one of two ways:

| Transport | Endpoint | When it is used |
|---|---|---|
| direct | `ws://<server-ip>:<app-port>` | default, fastest |
| Facepunch proxy | `wss://companion-rust.facepunch.com/game/<server-ip>/<app-port>` | when the app port is not reachable from the outside or direct connections do not work |

`ERROR: Error [code=ECONNRESET]: socket hang up` directly after `CONNECTING` means the TCP connection is accepted
and dropped again. Typical causes:

* the server is offline or restarting (for example during a wipe),
* the **app port** changed after a wipe/restart - check the app port and add the server again,
* the hosting provider does not expose the app port to the internet (NAT, proxy, DDoS protection),
* direct connections to the Rust+ websocket are not accepted by the server anymore (the Rust server code removed
  support for them, see the commit `rustplus_remove_direct` / `#168162`).

The transport is configured with `RPP_RUSTPLUS_TRANSPORT` in the `.env` file:

| Value | Behaviour |
|---|---|
| `auto` (default) | direct first, after 3 failed attempts in a row the Facepunch proxy is used |
| `direct` | only direct connections (`ws://...`) |
| `proxy` | only the Facepunch proxy (`wss://companion-rust.facepunch.com/...`) |

The `CONNECTING` line in the log shows which endpoint is used:

```
CONNECTING: CONNECTING TO SERVER... (direct ws://1.2.3.4:28082)
CONNECTING: CONNECTING TO SERVER... (Facepunch proxy companion-rust.facepunch.com/game/1.2.3.4/28082, 3 direct attempt(s) failed)
```

### Check both transports without touching the bot

```
node scripts/rustplusProbe.js [--guild=<guildId>] [--server=<ip-appPort>]
node scripts/rustplusProbe.js --ip=<ip> --port=<appPort> [--json]
```

The probe only opens (and immediately closes) the websocket, so no player token is needed. Example measured on
2026-11-07 against a **live** rust server (7/100 players, the port answered and was open):

```
  direct  ws://1.2.3.4:28018                                     ECONNRESET (socket hang up)      80 ms
  proxy   wss://companion-rust.facepunch.com/game/1.2.3.4/28018  HTTP 418 I'm a teapot          1457 ms
```

Facepunch's relay answers `HTTP 418` for **every** target - also for a nonsense target and for a plain HTTPS `GET`
without any websocket upgrade - which means the relay endpoint is currently disabled, not that the server is
offline. Combined with `ECONNRESET` on the direct connection this matches the removal of direct connections in the
Rust server code: **as of 2026-11-07 the Rust+ websocket is not reachable for third party clients at all.**

That is nothing the bot can work around: it keeps retrying and automatically uses whichever transport works again
once Facepunch provides one. Use the probe script to check the state from time to time.

### The transport the Rust+ app uses (verified 2026-11-07)

The mobile app (0.0.37) is only a native shell: it loads the web app **https://app.playrust.com** and uses its
JavaScript for the connection. That code builds the websocket like this:

```js
getWebSocketConnectUrl(v) { return `wss://${host()}/socket/${this.serverId}?v=${v}` }
getSubProtocols() {
    const token = this._getAuthToken();
    return ['rustplus.auth.v1', base64url(token)];
}
```

| Part | Value |
|---|---|
| host | `companion-rust.facepunch.com` (staging build: `rust-companion-app-staging.azurewebsites.net`) |
| `serverId` | the **pairing id (UUID)** of the server - not `ip:port` |
| `v` | build timestamp of the web app: `2026-10-20T13:20:54.122Z` -> `1792502454122` |
| auth token | the player token, sent as the **second websocket subprotocol** (base64url encoded) |

That explains the observations: `ws://ip:appPort` is reset (direct connections removed), the old
`/game/<ip>/<port>` relay always answers `418`, and `/socket/<id>` answers `404` for an id that Facepunch does not
know (an unauthenticated or unknown request never reaches the upgrade).

**rustplusplus speaks this protocol since 2026-11-07**, see the login section below.

### Logging in with Steam

The server id and the account token come from a Steam login of the Rust+ web app. There are two ways to do it, both
run the same code.

#### In Discord: `/credentials login` (recommended)

1. Run `/credentials login` (needs the usual admin permissions).
2. A modal asks for the Steam account name and password. The answer is ephemeral, only you see the response - but
   Discord itself transmits the text, so use it on a server you trust.
3. Steam Guard: asks Steam whether the device may be authorized (push message in the Steam app), approve it there
   and press **Confirmed** - the bot polls Steam immediately. If Steam asks for a code instead (e-mail or
   authenticator), press **Enter code**. Both buttons are shown when Steam accepts both ways.
4. The bot stores `credentials/rustplusAuth/<steamId>.json` (token + server list), writes the pairing id into every
   server of the guild whose name matches, reconnects the active server and shows the expiry date.

#### Headless: `npm run rustplus:login`

```
node scripts/rustplusLogin.js --account=<name>     # password: RPP_STEAM_PASSWORD or prompt
```

1. The password is asked on the terminal (or taken from `RPP_STEAM_PASSWORD`), the Steam Guard code is asked when
   Steam requires one.
2. It stores `credentials/rustplusAuth/<steamId>.json` with the account token and the server list
   (server name -> pairing id).
3. Start the bot: it reads the token, resolves the server id of the active server by its name and connects over the
   authenticated websocket. The resolved id is stored as `guid` in `instances/<guildId>.json`.
4. Repeat the login when the token expires (`exp` inside the token, about two weeks) - the bot logs a warning
   when that happens.

Notes:

* The login needs no browser and no extra program: `steam-session` talks to the Steam login servers directly.
* In Docker, mount the `credentials/rustplusAuth` folder (or run `/credentials login` once inside the running bot).
* The pairing id is also stored when a server is paired (`id` of the pairing notification), so the login file is
  only needed for the token.
* Without a token the bot falls back to the direct/proxy transports (`RPP_RUSTPLUS_TRANSPORT`), which Facepunch
  disabled - the log says so.

#### Do I still need FCM credentials?

No, not for the bot to work. `/api/syncData` - which the login already fetches - contains the servers of the
account **and their paired devices**:

```json
{ "servers": [ { "id": "<uuid>", "name": "...", "playerToken": 123,
                 "entityCategories": [ { "entities": [ { "entityId": {...}, "type": 1, "name": "..." } ] } ] } ] }
```

`/credentials login` therefore writes missing servers and adopts switches, alarms and storage monitors on its own,
with the names from the Rust+ app (`type` 1 = switch, 2 = alarm, 3 = storage monitor). A server without `ip/port`
in the account state is keyed `relay-<uuid>`, which is exactly what the authenticated socket needs.

FCM credentials are only needed for the push notifications of the app (raid alarm, team login, smart alarm while the
bot is not connected). Everything else is read from the account itself:

#### Newly paired devices are adopted automatically

Pairing a device in-game only puts a **notification** into the history of the account (`POST /api/history/read`,
the same list the app and app.playrust.com show). It contains everything:

```json
{ "title": "Smart Switch", "body": "Tap to pair with this device.",
  "data": "{\"id\":\"<server uuid>\",\"name\":\"...\",\"ip\":\"91.229.114.90\",\"port\":\"28111\",
            \"playerToken\":-395561831,\"entityId\":\"116582\",\"entityType\":\"1\",\"entityName\":\"Smart Switch\"}" }
```

`util/rustplusHistory.js` reads that history, `/credentials login` adopts the devices right away and
`RPP_RUSTPLUS_HISTORY_INTERVAL` (default 5 minutes) keeps doing it while the bot runs - the Discord message of the
new switch/alarm is posted as well. **No tapping in the app, no FCM credentials.**

#### The token renews itself

1. The login stores the **Steam refresh token** next to the account token (`steamRefreshToken` in
   `credentials/rustplusAuth/<steamId>.json`).
2. `RPP_RUSTPLUS_TOKEN_RENEW_BEFORE` (default `259200` = 3 days) before the token expires, the bot fetches a new one:
   it asks Steam for fresh community cookies with that refresh token and repeats the Rust+ login.
   **No password, no Steam Guard prompt** - it happens while connecting, the log shows
   `Rust+ account token renewed.`
3. For cron / a bot that is not running: `node scripts/rustplusLogin.js --renew` (all stored accounts) or
   `--renew=<steamId>`, also without a password.
4. The refresh token dies when the Steam password is changed or all devices are deauthorized - after that the log
   says `No Steam refresh token stored, a new login is required.` and `/credentials login` is needed once.

#### How it is built

| File | Task |
|---|---|
| `src/util/rustplusTransport.js` | endpoints and handshake data (socket url, subprotocols, origin, token expiry) |
| `src/util/rustplusSocket.js` | the authenticated websocket, wired to the events of `rustplus.js` |
| `src/util/rustplusAuth.js` | reads/writes `credentials/rustplusAuth/<steamId>.json`, resolves server names -> ids |
| `src/util/rustplusLogin.js` | Steam login (`steam-session`), Rust+ login, `/api/syncData` |
| `src/util/rustplusLoginPages.js` | HTTP/HTML part of the browser flow (cookie jar, forms, page parsing) |
| `src/util/fcm/pairingAddress.js` | server key of a pairing notification (ip/port or the pairing id) |
| `src/handlers/credentialsLoginHandler.js` | the Discord flow (`/credentials login`, code modal, reconnect) |

The login logs every step (`Rust+ login step N: … (cookies: …)`, `page title …, openid fields …`), so a failing
login shows which page Steam returned instead of a generic error.

#### Reading the values manually in the browser

Useful for debugging, the login script does all of this automatically.

1. Open https://app.playrust.com and log in with Steam.
2. Open a server in the app first (so a connection exists), then open the DevTools console and paste:

```js
/* log every websocket the app opens from now on */
const OWS = window.WebSocket;
window.WebSocket = new Proxy(OWS, {
    construct(target, args) {
        console.log('%c[WS URL]', 'color:#0f0', args[0]);
        console.log('%c[WS PROTOCOLS]', 'color:#0f0', args[1]);
        return new target(...args);
    }
});

/* also dump the persisted app state: the settings model holds `authentication.token` and the server list */
(async () => {
    const dumpStore = (db, storeName) => new Promise((resolve) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => {
            for (const row of request.result) console.log('[store]', db.name, storeName, row);
            resolve();
        };
        request.onerror = () => resolve();
    });

    for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve) => {
            const request = indexedDB.open(info.name);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = () => resolve(null);
        });
        if (!db) continue;
        for (const storeName of db.objectStoreNames) await dumpStore(db, storeName);
    }

    console.log('[localStorage]', Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
})();
```

3. Force a new connection without reloading the page (a reload would drop the patch):
   switch to another server and back, or set DevTools Network throttling to "Offline" and back.
   The console then shows the URL and the subprotocols; the second subprotocol value is the auth token and the
   last path segment of the URL is the server id.

   Without a reconnect the values are in the `[store]` lines instead: the settings model (IndexedDB
   `rustplus-cache`, store `cache`) contains `authentication.token` (the auth token) and the server entries with
   their `id` (the server id). The developer section of the settings page (`/settings#developer`) only contains
   test buttons, it does not show the values.
4. Check the transport. Either with the bot repository:

```
node scripts/rustplusProbe.js --socket-id=<server id from the URL> --auth-token-b64=<second subprotocol>
```

   or directly in the browser console (the Network tab shows the HTTP status of the upgrade):

```js
const ws = new WebSocket('wss://companion-rust.facepunch.com/socket/<id>?v=<v>',
    ['rustplus.auth.v1', '<token>']);
ws.onopen = () => console.log('OPEN');
ws.onclose = (e) => console.log('CLOSE', e.code, e.reason);
ws.onerror = () => console.log('ERROR (see Network tab)');
```

