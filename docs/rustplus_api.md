# Rust+ API coverage

Everything the Rust+ protocol offers is reachable through the wrapper, even the parts the bot does not use (yet).

The protocol of the game server is defined in `rustplus.proto` (shipped with `@liamcottle/rustplus.js`). The bot keeps
one table of it in [`src/util/rustplusApi.js`](../src/util/rustplusApi.js): 20 requests and 6 broadcasts. A request is
built from that table, a missing field of the proto is a one line change - `test/rustplusApi.test.js` compares the table
against the proto file, so nothing can be forgotten silently.

```js
rustplus.apiRequestAsync('getClanChat');                  // -> { getClanChat: {} }
rustplus.apiRequestAsync('setClanMotd', { message: 'hi' }); // -> { setClanMotd: { message: 'hi' } }
```

## Requests

`RustPlus` (`src/structures/RustPlus.js`) is the connection of a server with token bookkeeping, `RustPlusLite`
(`src/structures/RustPlusLite.js`) is the same without the bot around it. Both have `apiRequestAsync(name, params)`
for every request of the table, plus the named short cuts below.

| Request | Answer field | Wrapper method |
| --- | --- | --- |
| `getInfo` | `info` | `getInfoAsync()` |
| `getTime` | `time` | `getTimeAsync()` |
| `getMap` | `map` | `getMapAsync()` |
| `getMapMarkers` | `mapMarkers` | `getMapMarkersAsync()` |
| `getTeamInfo` | `teamInfo` | `getTeamInfoAsync()` |
| `getTeamChat` | `teamChat` | `getTeamChatAsync()` |
| `sendTeamMessage` | `success` | `sendTeamMessageAsync(message)` |
| `getEntityInfo` | `entityInfo` | `getEntityInfoAsync(entityId)` |
| `setEntityValue` | `success` | `turnSmartSwitchAsync()`, `setEntityValueAsync(entityId, value)` |
| `checkSubscription` | `flag` | `checkSubscriptionAsync(entityId)` |
| `setSubscription` | `success` | `setSubscriptionAsync(entityId, value)` |
| `promoteToLeader` | `success` | `promoteToLeaderAsync(steamId)` |
| `getClanInfo` | `clanInfo` | `getClanInfoAsync()` |
| `getClanChat` | `clanChat` | `getClanChatAsync()` |
| `setClanMotd` | `success` | `setClanMotdAsync(message)` |
| `sendClanMessage` | `success` | `sendClanMessageAsync(message)` |
| `getNexusAuth` | `nexusAuth` | `getNexusAuthAsync(appKey)` |
| `cameraSubscribe` | `cameraSubscribeInfo` | `subscribeToCameraAsync()`, `getCameraFrameAsync()` |
| `cameraUnsubscribe` | `success` | `unsubscribeFromCameraAsync()` |
| `cameraInput` | `success` | `sendCameraInputAsync()` |

## Broadcasts

The game server pushes a message on its own, the bot subscribes once per connection. Every broadcast arrives in
[`src/rustplusEvents/message.js`](../src/rustplusEvents/message.js) and is dispatched to its handler there; an
unhandled broadcast is logged (debug).

| Broadcast | Handler |
| --- | --- |
| `teamChanged` | `messageBroadcastTeamChanged` (team handler + `Team.updateTeam`) |
| `teamMessage` | `messageBroadcastTeamMessage` (`src/handlers/teamChatHandler.js`) |
| `entityChanged` | `messageBroadcastEntityChanged` (smart switch, alarm, storage monitor) |
| `clanChanged` | `messageBroadcastClanChanged` (`src/handlers/clanChatHandler.js`) |
| `clanMessage` | `messageBroadcastClanMessage` (`src/handlers/clanChatHandler.js`) |
| `cameraRays` | `messageBroadcastCameraRays` (camera frames) |

## An empty answer is not an error

A request the server does not support - or a request with a missing parameter - is **not** answered with an error, it
answers with an empty `AppResponse` (`{}`). Verified against a live server: `getEntityInfo` without an id,
`checkSubscription` without an id, an unknown field and a camera subscription with an invalid id all came back as `{}`;
`getNexusAuth` returns `{}` for every app key, `getClanInfo`/`getClanChat` return `{}` when the account is in no clan.

`src/util/responseUtils.js` tells the cases apart:

```js
const { classifyResponse } = require('./src/util/responseUtils.js');

const result = classifyResponse(await rustplus.getClanChatAsync());
// 'success' | 'error' | 'empty' | 'timeout' | 'invalid'
```

`isResponseFailure()` is unchanged: only a thrown error or an `AppError` counts as a failure. Use `classifyResponse()`
when a feature has to know whether the server answered at all.

## Map markers

`getMapMarkers` used to list players, vending machines, Chinook 47, the cargo ship, crates, the patrol helicopter and the
Traveling Vendor (`MapMarkers.types` in `src/structures/MapMarkers.js`). Against a live server on 2026-11-18 it returned
**only player markers** (`{ "1": 3 }`): no vending machines, no events. The notifications built on them were removed in
1.50.1 (`RustPlus.sendEvent()` only logs an event whose setting is gone); the Deep Sea is detected from vending machines
outside the grid and has no data either. The Traveling Vendor (type 9) does not appear anymore either; its settings were
removed in 1.50.3, so no event notification setting is left.

The code stays, gated by `RPP_MAP_EVENTS_ENABLED` (default off, `src/util/mapEvents.js`): `MapMarkers.updateMapMarkers()`
only tracks the players, the vending machine subscriptions do not run, the event commands and `/market` are off, the
information channel has no event section. Setting it to `true` brings all of it back.

## Monument names

The map sends a token per monument (`AppMap.monuments[].token`). The readable, localized names are in the table of
`src/structures/Map.js` (`monumentInfo`). A monument a newer Rust version added is not dropped anymore: its token is
formatted by [`src/util/monuments.js`](../src/util/monuments.js) (`jungle_ziggurat` -> `Jungle Ziggurat`), both for
`/map monuments` and for the drawn map.

## Cameras

`cameraSubscribe { cameraId }` answers with `cameraSubscribeInfo` (`width`, `height`, `nearPlane`, `farPlane`,
`controlFlags`). While a camera is subscribed the server pushes `cameraRays` broadcasts (~12 per second) with the
raycast samples and the entities in view.

| Item | Value on a live server (PTZ camera, 2026-11) |
| --- | --- |
| Resolution | `320x180` |
| Control flags | `10` = `MOUSE` + `FIRE` = pan/tilt + zoom of a **PTZ camera** (an Auto Turret adds `CROSSHAIR`/`RELOAD`, a static CCTV camera has none) |
| Frames | ~12 per second, ~6.3 KB of ray data per frame (~78 KB/s) |
| Complete image | ~30-40 frames, i.e. 3-4 seconds, one frame covers only a few percent of the pixels |
| Entities | `Player` and `Tree` with `entityId`, `name`, position (relative to the camera, in metres), rotation, size - **no steam id** |

Two answers a subscription can get, both are AppErrors:

- `not_found` - the code is unknown **or** the `playerToken` of the server is stale (it rotates on every re-pairing, and
  a stale token makes *every* request answer `not_found`, not only cameras).
- `player_online` - the paired account is on the server. Rust+ only streams cameras while it is offline.

Only one camera can be subscribed per connection at a time, so cameras have to be checked one after another. A camera
subscription costs 1 token, camera movement 0.01.

### The account token and the socket

The relay socket is authenticated **once**, at the handshake, with the account token (`util/rustplusSocket.js` sends it
as the websocket subprotocol). Facepunch keeps the newest token of an account, so every new Rust+ login mints a new one
and then answers the requests of the *old* socket with `not_found` - the same answer a stale `playerToken` gets, which
makes it look like a lost pairing (the pairing itself is fine, the notification history keeps delivering).

A token can also be refused **for new requests only** while the open socket keeps working: the history and the account
state answer `403`, a new handshake `403` (observed 2026-11-18, a few minutes to ~40 minutes after a renewal). The bot
renews such a token when the socket drops, before it reconnects (`TokenRecovery.renewIfRefused()`, see
[credentials.md](credentials.md#what-happens-when-facepunch-rejects-the-token)).

For that reason the token is renewed in one place only (`util/tokenRecovery.js`, see
[credentials.md](credentials.md#what-happens-when-facepunch-rejects-the-token)): the renewal is single-flight per
account and rebuilds every socket of the account afterwards (`RustPlus.rebuildConnection(reason, { force: true })`).
`connect()` reads the stored token on every attempt, and a failed poll whose socket holds an older token than the stored
one (`RustPlus.hasStaleAuthToken()`) rebuilds the socket right away instead of renewing again.

A device that the server does not know anymore (`not_found` for its `entityId`, e.g. destroyed in game or lost with a
wipe) answers that way forever. The device round of the poll runs every 30 polls (5 minutes), so `util/unreachableDevices.js`
remembers such a device and asks it once an hour instead - one line at debug level per round would otherwise fill the log
(~290 ERROR lines a day per gone device).

Every failing `isResponseValid()` line names the caller as `(file:line)` (`util/callSite.js`): `not_found` is answered to
the poll, to a device round, to the pairing history and to a button, and the console line used to look the same for all
of them.

The poll never waits for Discord: the information embeds, the storage monitors and the order check run in their own
60 s cycle (`handlers/backgroundHandler.js`), and every awaited step of the poll has a 10 s deadline
(`util/withTimeout.js`). A cycle that hangs longer than 60 s is reported in the log and releases the `isPolling` flag,
the second one in a row rebuilds the connection - one Discord call waiting on a rate limit used to freeze every
poll-based update for minutes without a single line in the log. The order check fetches the channel once and then at
most every 15 minutes instead of once per minute.

A closed socket names its reason: `The relay socket was closed (code 1006) after 2h 34m`. `1001` and `1012` mean the
endpoint went away (relay or server restart, the 4 a.m. restart answers `502` at the handshake), `1006` means no close
frame came - the network dropped it, or the 30 s heartbeat closed it (the line says so). An outage is only announced in
Discord when the reconnect is still not through after a minute (`util/offlineAnnouncement.js`), so a short blip no longer
posts `server just went offline` plus `online`. 

### Rendering

The sample index -> pixel mapping is a shuffle (seeded xorshift, seed 1337) that every client has to apply, and the
image builds up over the frames. `src/util/cameraRenderer.js` does both and accumulates **all** frames; the library
(`@liamcottle/rustplus.js`) renders only the last 10, which leaves a dotted pattern (60 % of the pixels never covered).

`src/structures/Camera.js` wraps subscribe/collect/render/unsubscribe, and `src/handlers/cameraWatchHandler.js` uses it to
report players that are not in the team into the cameras channel.

A check of the watch does **not** render: the entities of a frame are the whole view of the camera, so `waitForFrames()`
waits for 3 frames (or 400 ms) and only the alert collects the ~4 s of frames a complete picture needs. One check
therefore costs ~19 KB instead of ~195 KB; a team member is only reported when the settings say so
(`cameraWatchReportTeam`).

## Team map notes

`AppTeamInfo.mapNotes` and `AppTeamInfo.leaderMapNotes` (the marks the team placed on the map) are parsed into
`Team.mapNotes` and `Team.leaderMapNotes` and updated on every poll (`src/handlers/pollingHandler.js`). Drawing
them on the map is a separate feature.
