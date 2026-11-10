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

## Team map notes

`AppTeamInfo.mapNotes` and `AppTeamInfo.leaderMapNotes` (the marks the team placed on the map) are parsed into
`Team.mapNotes` and `Team.leaderMapNotes` and updated on every poll (`src/pollingHandlers/pollingHandler.js`). Drawing
them on the map is a separate feature.
