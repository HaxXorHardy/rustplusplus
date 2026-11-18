# Full list of Features

## Discord Slash Commands
- **/alarm** - Change the image of a paired Smart Alarm.
- **/alias** - Create an alias for a command/sequence of characters.
- **/blacklist** - Blacklist a user from using the bot.
- **/cameras** - Cameras of the server: list, add, snapshot and the stranger watch.
- **/cctv** - Get cctv camera codes for monuments.
- **/craft** - Display the cost to craft an item.
- **/credentials** - Log in with Steam, show or remove the registered accounts.
- **/deathmap** - Show the deaths of the team on the map.
- **/decay** - Display the decay time of an item.
- **/despawn** - Display the despawn time of an item.
- **/help** - Get help message.
- **/ingameaccess** - Set in-game command access mode.
- **/item** - Get the details of an item.
- **/leader** - Transfer leadership.
- **/map** - Display the In-Game Map.
- **/market** - Search for or subscribe to items in vending machines (no data at the moment, see below).
- **/players** - Get Battlemetrics data on all connected players.
- **/recycle** - Display the output of recycling an item.
- **/removedevices** - Remove all smart devices of the active server (e.g. after a wipe).
- **/research** - Display the cost to research an item.
- **/reset** - Reset Discord Channels.
- **/role** - Setup a specific role to use rustplusplus.
- **/stack** - Display the stack size of an item.
- **/status** - Health of the bot: connection, token, push and recent warnings.
- **/storagemonitor** - Change the image of a paired Storage Monitor.
- **/switch** - Change the image of a paired Smart Switch.
- **/teamstats** - Online time, sessions and deaths of the team this week.
- **/upkeep** - Get the upkeep cost of an item.
- **/uptime** - Get the current uptime for rustplusplus.
- **/voice** - Let rustplusplus join voicechat.
- **/whitelist** - Whitelist a user for in-game bot commands.

## In-Game Commands
- **afk** - Display afk teammates.
- **alive** - Display who has been alive longest.
- **cargo** - Display information regarding Cargoship (no data at the moment).
- **chinook** - Display information regarding Chinook 47 (no data at the moment).
- **connection/connections** - Display latest team connections.
- **craft** - Display the cost to craft an item.
- **death/deaths** - Display latest deaths.
- **decay** - Display the decay time of an item.
- **deepsea** - Get information regarding the Deep Sea (no data at the moment).
- **despawn** - Display the despawn time of an item.
- **events** - Get recent events.
- **heli** - Get information regarding Patrol Helicopter (no data at the moment).
- **large** - Get information regarding Large Oil Rig (no data at the moment).
- **leader** - Transfer leadership.
- **marker/markers** - Set markers to navigate to.
- **market** - Search for or subscribe to items in vending machines (no data at the moment).
- **mute** - Mute rustplusplus In-Game.
- **note/notes** - Add notes.
- **offline** - Display offline teammates.
- **online** - Display online teammates.
- **player/players** - Get Battlemetrics information about players.
- **pop** - Get population of the server.
- **prox** - Display teammates that are nearby.
- **recycle** - Display the output of recycling an item.
- **research** - Display the cost to research an item.
- **send** - Send a message through rustplusplus to a person on Discord.
- **small** - Get information regarding Small Oil Rig (no data at the moment).
- **stack** - Display the stack size of an item.
- **steamid** - Get teammate steamid.
- **team** - Get team information (names of all teammates).
- **time** - Get In-Game time.
- **timer/timers** - Setup timers.
- **tr** - Translate from English to another language.
- **trf** - Translate from one language to another.
- **tts** - Text-To-Speech (Need to have teamchat open in Discord).
- **unmute** - Unmute rustplusplus In-Game.
- **upkeep** - Check upkeep of Storage Monitor Tool Cupboards.
- **uptime** - Display the uptime of rustplusplus and currently connected server.
- **vendor** - Get information regarding the Traveling Vendor (no data at the moment).
- **wipe** - Display time since wipe.

## Smart Devices
> Pair Smart Devices such as `Smart Switches`, `Smart Alarms`, `Storage Monitors` and control them from Discord or In-Game teamchat.

- See [Smart Switches](smart_devices.md#smart-switches) - timers like `!sw on 10m` keep running through reconnects and restarts.
- See [Smart Switch Groups](smart_devices.md#smart-switch-groups) - switch picker, toggle, timer, day/night automation, schedules, alarm triggers.
- See [Smart Alarms](smart_devices.md#smart-alarms) - cooldown, `@everyone` escalation, raid mode with direct message and raid report.
- See [Storage Monitors](smart_devices.md#storage-monitors) - upkeep early warning, alerts by item amount.
- See [After a wipe](smart_devices.md#after-a-wipe) - checklist and removal of the devices of the old map.

## Rust Server Information
- See number of players, max capacity and queue size of the Rust Server.
- See the In-Game time and time till day/night.
- See how long ago wipe was, and when the next forced wipe is (first Thursday of the month, 19:00 London time).
- See Map Size, Map Seed and Map Name.
- F1 console connect information.

## In-Game Event Notifications
> Facepunch's Rust+ API no longer reports any events: on a live server (2026-11-18) the map markers contained only players - no Cargo Ship, Patrol Helicopter, Chinook 47, Oil Rig crates, Vending Machines, Deep Sea (derived from vending machines) or Traveling Vendor. All event notification settings were removed (1.50.1 and 1.50.3); the `events` channel stays empty.

## Push Notifications
> The bot registers itself as a device of the Rust+ account (see [Credentials](credentials.md#push-notifications-fcm)).

- Paired servers and devices appear within seconds.
- Smart alarms and team logins of servers the bot is **not** connected to are reported.
- Raid alarm plugins (e.g. umod raid-alarm) post `@everyone` in the activity channel.

## Team
> Get information about teammates such as Online/Offline/AFK/Alive/Dead/Location/Paired/Leader.

- Connect/disconnect/death messages in the activity channel and in-game.
- `/teamstats` and a weekly report (online hours, sessions, deaths) in the activity channel.
- `/deathmap` draws the deaths of the team on the map.

## Other
- Connect through different Rust Servers seemingly through the `servers` Text-Channel in Discord.
- Easily access rustplusplus settings via the Discord Text-Channel `settings` (including the alarm cooldown, raid mode, upkeep warning and time zone).
- Run In-Game commands either from In-Game teamchat or from Discord Text-Channel `commands`.
- Communicate with teammates from In-Game to Discord and vice versa.
- Get activity information in the `activity` Text-Channel on Discord: Smart Devices not reachable, teammate connect/disconnect/leave/join/death, Smart Alarms, raid reports, storage alerts, upkeep warnings, server went offline/online, map wipe (with checklist), decay, tracker notifications, the weekly team report etc...
- Create Battlemetrics Trackers to track players or groups.
- Camera stranger watch: players that are not in the team are posted with a picture.
- `/status` shows the health of the bot, the Serverlog channel mirrors the log for the administrators.
