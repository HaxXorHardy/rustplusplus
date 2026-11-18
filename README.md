<p align="center">
<img src="./rustplusplus.png" width="500"></a>
</p>

<p align="center">
<a href="https://discord.gg/vcrKbKVAbc"><img src="https://img.shields.io/badge/Discord-Rust++-%237289DA?style=flat&logo=discord" alt="discord"/></a>
<a href="https://ko-fi.com/alexemanuelol"><img src="https://img.shields.io/badge/Donate%20a%20Coffee-alexemanuelol-yellow?style=flat&logo=buy-me-a-coffee" alt="donate on ko-fi"/></a>

<p align="center">
<a href="https://crowdin.com/project/rustplusplus"><img src="https://badges.crowdin.net/rustplusplus/localized.svg" alt="Crowdin"/></a>
</p>

<p align="center">
    <a href="https://discord.gg/vcrKbKVAbc">
        <img src="./join_discord.png" width="250">
    </a>
</p>

<h1 align="center"><em><b>rustplusplus</b> ~ Rust+ Discord Bot</em></h1>
</p>

A NodeJS Discord Bot that uses the [rustplus.js](https://github.com/liamcottle/rustplus.js) library to utilize the power of the [Rust+ Companion App](https://rust.facepunch.com/companion) with additional Quality-of-Life features.

> **Note:** This repository is a fork of [FaiThiX/rustplusplus](https://github.com/faithix/rustplusplus), which itself is a fork of the original [alexemanuelol/rustplusplus](https://github.com/alexemanuelol/rustplusplus). All credit for the original bot and its main development goes to **alexemanuelol**.


## **How-to Setup Video**

[![Image of setup video](https://www.youtube.com/s/desktop/4a88d8c6/img/favicon_144x144.png)](https://youtu.be/GX03brJiMZg)

## **Features**

* Control [Smart Switches](docs/smart_devices.md#smart-switches) and [Switch Groups](docs/smart_devices.md#smart-switch-groups) from Discord or the In-Game Team Chat - with timers that survive restarts, day/night automation, real-time schedules and alarms that turn a group on.
* [Smart Alarms](docs/smart_devices.md#smart-alarms) notify in Discord and In-Game, with a cooldown, `@everyone` escalation and a **raid mode** (direct message while nobody of the team is online, raid report afterwards).
* [Storage Monitors](docs/smart_devices.md#storage-monitors) keep track of tool cupboard upkeep (with an early warning) and of box contents (alerts such as `Rifle Ammo < 100`).
* [Push notifications](docs/credentials.md#push-notifications-fcm) of the Rust+ app: pairings appear within seconds, smart alarms and team logins of other servers and raid alarm plugins are reported.
* The [Information Text Channel](docs/discord_text_channels.md#information-channel) shows the map, the server (with the next forced wipe), monuments and the team.
* Communicate with teammates from [Discord to In-Game](docs/discord_text_channels.md#teamchat-channel) and vice versa.
* Team statistics with a weekly report, a death map of the team and a [wipe helper](docs/smart_devices.md#after-a-wipe) that removes the devices of the old map.
* Keep track of other teams on the server with the [Battlemetrics Player Tracker](docs/discord_text_channels.md#trackers-channel).
* `/status` shows the health of the bot (connection, token, push, recent warnings); the [Serverlog Channel](docs/discord_text_channels.md#serverlog-channel) mirrors the log for the administrators.
* Alot of [QoL Commands](docs/commands.md) that can be used In-Game or from Discord.
* View the [Full list of features](docs/full_list_features.md).

> **Event notifications:** Facepunch's Rust+ API no longer reports any events - no Cargo Ship, Patrol Helicopter, Chinook 47, Oil Rig crates, Vending Machines, Deep Sea or Traveling Vendor (verified against a live server on 2026-11-18: the map markers contain only players). All event notifications were removed (1.50.1/1.50.3). The code for these events stays, but it does not run while `RPP_MAP_EVENTS_ENABLED` is off (default): the commands (`!cargo`, `!heli`, `!chinook`, `!small`, `!large`, `!vendor`, `!deepsea`, `!events`, `!market`) do nothing, `/market` is not registered and the information channel shows no event section. Set it to `true` should Facepunch send them again.


## **Documentation**

> Documentation can be found [here](https://github.com/HaxXorHardy/rustplusplus/blob/master/docs/documentation.md). The documentation explains the features as well as `how to setup the bot`, so make sure to take a look at it 😉

## **Credentials**

> The bot does not use FCM credentials and no credential application anymore. Sign in once with `/credentials login` in Discord: the QR code of the Steam app (nothing secret goes through Discord), the account token copied out of your own browser, or the password form as fallback. All three create the Rust+ account token in `credentials/rustplusAuth/<steamId>.json` and adopt the servers and paired devices of the account. Headless: `npm run rustplus:login`.
>
> The ways are described in [docs/credentials.md](docs/credentials.md), the details (token renewal, DM reminder, diagnosing a login) in [FAQ.md](FAQ.md#logging-in-with-steam).


## **How to run the bot**

> To run the bot, simply open the terminal of your choice and run the following from repository root:

    $ npm start

> The configuration is read from the environment or a `.env` file in the repository root, see [`.env.example`](.env.example) (`RPP_DISCORD_CLIENT_ID` and `RPP_DISCORD_TOKEN` are required).


## **How to update the repository**

> Depending on your OS / choice of terminal you can run:

    $ update.bat

or

    $ ./update.sh


## **How to update the static game data**

> Refresh the item list and the RustLabs data after a game update and rebuild the static database:

    $ npm run update:static-data

> See [docs/static_data.md](docs/static_data.md) for options and details.


## **Running via docker**

    $ docker run --rm -it -v ${pwd}/credentials:/app/credentials -v ${pwd}/instances:/app/instances -v ${pwd}/logs:/app/logs -v ${pwd}/maps:/app/maps -v ${pwd}/runtime:/app/runtime -e RPP_DISCORD_CLIENT_ID=111....1111 -e RPP_DISCORD_TOKEN=token --name rpp ghcr.io/haxxorhardy/rustplusplus

or

    $ docker-compose up -d

Make sure you use the correct values for `RPP_DISCORD_CLIENT_ID` as well as `RPP_DISCORD_TOKEN` in the docker command/docker-compose.yml.

| Volume | Content | Without it |
| --- | --- | --- |
| `/app/credentials` | Rust+ login and push device | log in again after every update |
| `/app/instances` | settings, servers, devices, switch timers, team stats | everything is set up again |
| `/app/logs` | log files | logs are lost on every update |
| `/app/maps` | map images | they are rebuilt on the next connect |
| `/app/runtime` | runtime data (custom in-game timers, offline times of teammates) | lost on every update |

Do not put a volume on `/app/data`: it holds the game data of the image (`staticData.sqlite`), an empty volume hides it and the bot does not start.

## **Thanks to**

**liamcottle**@GitHub - for the [rustplus.js](https://github.com/liamcottle/rustplus.js) library.
<br>
**.Vegas.#4844**@Discord - for the awesome icons!
<br>
**alexemanuelol**@GitHub - for the Main Development of the [Rust++ Bot](https://github.com/alexemanuelol/rustPlusPlus).
<br>
**FaiThiX**@GitHub - for the fork [rustplusplus](https://github.com/faithix/rustplusplus) that this project is based on.
