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

For that reason `RustPlus.rebuildConnection()` closes the socket after a renewal (`util/rustplusHistory.js` and
`checkAuthTokenRenewal()`): the reconnect reads the stored token and the connection works again. A renewal is only asked
for after **two** rejected reads in a row, because every renewal itself invalidates the running socket - and a `403`
is a proxy refusal, not a dead token.

A device that the server does not know anymore (`not_found` for its `entityId`, e.g. destroyed in game or lost with a
wipe) answers that way forever. The device round of the poll runs every 30 polls (5 minutes), so `util/unreachableDevices.js`
remembers such a device and asks it once an hour instead - one line at debug level per round would otherwise fill the log
(~290 ERROR lines a day per gone device).

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
`Team.mapNotes` and `Team.leaderMapNotes` and updated on every poll (`src/pollingHandlers/pollingHandler.js`). Drawing
them on the map is a separate feature.
