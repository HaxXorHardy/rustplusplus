# Credentials Documentation

> To use an instance of the bot you have to log in once with a Steam account that is signed in to the Rust+ app and has
> paired your server. The login creates the Rust+ account token the bot needs for the authenticated websocket, the
> server list, the pairing ids and the paired devices. No FCM credentials and no credential application are needed
> anymore.

## Logging in

Run `/credentials login` in Discord. The bot offers three ways, all of them end in the same login:

| Way | Secret goes through Discord? | Renews itself |
|---|---|---|
| **QR code (Steam app)** - recommended | no | yes, the Steam refresh token is stored |
| **Paste token** | only the Rust+ account token | no, the bot reminds you by DM |
| **Password** | Steam account name, password and Steam Guard code (ephemeral) | yes, the Steam refresh token is stored |

### QR code

1. `/credentials login` → **QR code (Steam app)**.
2. Scan the picture with the Steam app (or open the link on a phone that is signed in to Steam) and confirm the login
   there.
3. The bot polls Steam and reports the result. The challenge expires after a few minutes, press the button again then.

The picture is rendered by the bot itself: the challenge is a one time login approval and is never sent to a QR service.

### Paste token

1. Open https://app.playrust.com, log in and open a server of the account.
2. Copy the value `authentication.token` out of the DevTools console or the IndexedDB (`rustplus-cache`, store
   `cache`) - the snippet is in [FAQ.md](../FAQ.md#reading-the-values-manually-in-the-browser).
3. `/credentials login` → **Paste token** and paste the value.

This way stores no Steam refresh token, so the bot cannot renew the login itself: `RPP_CREDENTIALS_EXPIRY_WARNING`
(default 3 days) before the token expires the Discord user that logged in gets a direct message, and the same message
once it has expired.

### Password

1. `/credentials login` → **Password**.
2. Steam account name and password, then the Steam Guard confirmation in the app (**Confirmed**) or the code
   (**Enter code**).

The answer is ephemeral, only you see the response - but Discord transmits the text. Use the QR code or the token if you
do not want that.

## What the login stores

| File | Content |
|---|---|
| `credentials/rustplusAuth/<steamId>.json` | account token, expiry, server list (name → pairing id) and - for the QR and password login - the Steam refresh token |
| `credentials/<guildId>.json` | which Discord user owns which steam account, `hoster` is the first one |

Afterwards the bot writes the pairing ids into the servers of the guild whose name matches, posts the messages of new
servers and devices and reconnects the active server. `/credentials show` lists the registered accounts with the expiry
of their token, `/credentials remove` and `/credentials set_hoster` manage them.

## Token renewal and the DM reminder

* A login with a refresh token renews itself: `RPP_RUSTPLUS_TOKEN_RENEW_BEFORE` (default 3 days) before the expiry the
  bot fetches a new token (fresh Steam cookies over the refresh token, no password, no Steam Guard). One hourly check
  (`util/tokenRecovery.js`) does that for every stored login, a connect only renews a token that has already expired.
* `node scripts/rustplusLogin.js --renew` is meant for a bot that is **not** running. Every renewal invalidates the
  previous token, a running bot notices the newer stored token on the next failed poll and reconnects - but there is no
  reason to renew behind its back.
* A login without one (pasted token) is reported to its owner: the bot checks every
  `RPP_CREDENTIALS_EXPIRY_CHECK_INTERVAL` (default 1 hour) and sends a direct message before and after the expiry, each
  state once per token.
* The refresh token dies when the Steam password is changed or all devices are deauthorized - after that the log says
  `No Steam refresh token stored, a new login is required.` and `/credentials login` is needed once.

## Why no FCM credentials anymore?

Facepunch removed the direct Rust+ connections, the bot speaks the same authenticated websocket as the Rust+ app and
needs the account token for it. The push notifications of the app are not needed either: the notification history of the
account (`POST /api/history/read`) carries the pairings, so devices are adopted without FCM.

See also: [FAQ.md](../FAQ.md#do-i-still-need-fcm-credentials), [Commands](commands.md#credentials).

## What happens when Facepunch rejects the token

Facepunch keeps one token per account: a renewal mints a new one and the relay answers every socket that was opened with
the old one with `not_found`. So the token is renewed in exactly one place, `util/tokenRecovery.js`:

- a renewal is single-flight per steam account - whoever asks while one runs (connect, history read, handshake error)
  waits for it and uses its result, there is never a second login in parallel,
- after a renewal **every** connection of the account is rebuilt: all guilds, the team leader connections and the
  reconnects that wait on their backoff,
- a rejected token (`401`/`403` of the history read or of the handshake) is renewed on the second rejection in a row,
  at most once every two minutes,
- after three renewals without a working connection the account is left alone for 30 minutes and the owner of the
  credentials gets a direct message to run `/credentials login`,
- no renewal while a connection of the account runs on the stored token and answered a poll within the last two
  minutes - the token evidently works, the refusal is a proxy, a rate limit or a hiccup of Facepunch,
- a renewal that returns the same token rebuilds nothing; a proactive renewal whose new token still expires inside
  `RPP_RUSTPLUS_TOKEN_RENEW_BEFORE` is not repeated for 12 hours (it used to repeat every hour),
- a socket whose token is older than the stored one (renewed by another guild, the login or the script) is rebuilt on
  the next failed poll without renewing anything,
- a working connection resets all of it.

The pairing history (`POST /api/history/read`) and the account state (`/api/syncData`) are read once per account and
run, whatever the number of guilds that use it. A connection that answers `not_found` right after the handshake reads
only its own account, at most every two minutes. A server is only marked as unpaired when the account state could be
read and the server is not answering at that moment - the history drops old notifications, so its silence proves
nothing.

## Push notifications (FCM)

With `RPP_PUSH_ENABLED=true` (default) the bot registers every stored login as a device of the Rust+ app, the same
way the Rust+ app and the rustplusplus credential application do (`util/rustplusPush.js`):

1. the account token of the Steam login (nothing to do, `/credentials login` stored it),
2. a registration with Google as an Android device of the Rust+ app (android id, security token, FCM token),
3. an Expo push token for that device,
4. `POST /api/push/register`: Facepunch sends the notifications of the account to that device.

Steps 2 and 3 run once, step 4 again after every new account token and a day before the registration expires. The
result is stored in `credentials/rustplusPush/<steamId>.json`; the account token itself is not copied there. The bot
shows up as one more device in the Rust+ account. Delete that file to register a new device.

What the notifications are used for (`util/rustplusPushNotifications.js`):

| Notification | What happens |
| --- | --- |
| Raid alarm of the [raid-alarm plugin](https://umod.org/plugins/raid-alarm) | `@everyone` in the activity channel, the team chat in-game when connected to that server |
| Smart alarm | reported when the bot is **not** connected to that server (`RPP_PUSH_ALARMS_OTHER_SERVERS`); the connected server reports its alarms over the socket |
| Team login | reported when the bot is **not** connected to that server; the team poll reports the rest |
| Pairing | the history of the account is read right away instead of on the next run |
| Death | left to the history, it reports deaths already |
| anything else | logged in full (`Rust+ push: unhandled notification ...`) |

Everything is optional: a failed registration or connection is logged once an hour and the bot keeps running on the
history. A device whose FCM connection fails three times in a row is registered anew.
