# Smart Devices

> Smart Devices is an umbrella term for three different devices, `Smart Switches`, `Smart Alarms` and `Storage Monitors`. To pair a Smart Device with rustplusplus, make sure you've [setup the Credentials](credentials.md). When the Credentials are setup, you just need a `wire tool` and start pairing like you would with the [Rust+ Companion App](https://rust.facepunch.com/companion). Once you've paired your Smart Devices, they should appear in their respective Discord Text-Channel (`switches`, `alarms` or `storagemonitors`) - within seconds with [push notifications](credentials.md#push-notifications-fcm), otherwise on the next read of the notification history.
<br>

It is possible to change the display image for all the different Smart Devices by running the corresponding Slash Command. The Slash Commands to change Smart Device images is `/switch`, `/alarm` and `/storagemonitor`.


## Smart Switches
> Paired Smart Switches can be located in the `switches` Text-Channel on Discord. Only Smart Switches from the currently/last connected Rust server will be shown in the channel.

![Image of a Smart Switch](images/smart_devices/smart_switch.png)

The image above is what a paired Smart Switch looks like in Discord. In this case the Smart Switch is called `Switch` and is located at E16. All Smart Devices have an Entity Id which is used to identify it. The Custom Command for this switch is `!sw` which can be used from the in-game teamchat.
<br><br>
The Smart Switch can be turned ON/OFF by clicking the `TURN ON` / `TURN OFF` button at the bottom. By clicking on the `EDIT` button, you can edit things such as the `Name` and the `Custom Command` for the Smart Switch. If the `AUTO SETTING` is set to either `AUTO-ON-PROXIMITY` or `AUTO-OFF-PROXIMITY`, there will be a proximity setting available to edit. The proximity setting is used to turn the switch ON/OFF when a teammate is within the proximity of the Smart Switch. To remove the Smart Switch, just click the trashcan button.
<br><br>
There are a few auto settings for Smart Switches:
- **OFF** - Smart Switch work as normal.
- **AUTO-DAY** - Smart Switch will be active only during the day.
- **AUTO-NIGHT** - Smart Switch will be active only during the night.
- **AUTO-ON** - Smart Switch will automatically go active during update cycle.
- **AUTO-OFF** - Smart Switch will automatically go inactive during update cycle.
- **AUTO-ON-PROXIMITY** - Smart Switch will automatically go active if teammate is in proximity, if outside proximity it will go inactive.
- **AUTO-OFF-PROXIMITY** - Smart Switch will automatically go inactive if teammate is in proximity, if outside proximity it will go active.
- **AUTO-ON-ANY-ONLINE** - Smart Switch will automatically go active if any teammate is online, if all offline it will go inactive.
- **AUTO-OFF-ANY-ONLINE** - Smart Switch will automatically go inactive if any teammate is online, if all offline it will go active.

<br>

Smart Switches can also be controlled from within the game through teamchat via custom commands. Custom command call combinations for the Smart Switch `Switch` are shown below:
* **!sw** - To toggle the switch.
* **!sw 60s** - To toggle the switch and then toggle it back after 60 seconds.
* **!sw on** - To turn the switch ON.
* **!sw off** - To turn the switch OFF.
* **!sw on 60s** - To turn the switch ON and automatically turn it OFF after 60 seconds.
* **!sw off 60s** - To turn the switch OFF and automatically turn it ON after 60 seconds.
* **!sw status** - To get the current status of the switch.

The timer of `!sw on 60s` keeps running when the connection is rebuilt (token renewal, a dropped socket) and when the bot restarts or is updated: running timers are stored in the instance file and started again with the time that is left. Switching the switch by hand (Discord, in-game) cancels it.

### Smart Switch Groups
> Smart Switch Groups is a feature that allows you to control multiple Smart Switches at once. The image below is what a Smart Switch Group looks like in Discord.

![Image of a Smart Switch Group](images/smart_devices/smart_switch_group.png)

To create a Smart Switch Group, click the `CREATE GROUP` button located under appropriate server in the `servers` Text-Channel on Discord. This will create the Smart Switch Group embed above located in the `switchgroups` Text-Channel on Discord. The Group above is called `Turrets` and have the id `518`. The Custom Command for this group is `!t` and the Group have three Smart Switches connected to it.

The embed shows the **status** of the group at a glance - 🟢 all on, 🟡 `3/5 on`, 🔴 all off (of the switches that answer) - and, when set, the automation, the schedule, the alarm trigger and a running timer (`turns off in 9 minutes`).

**Buttons**

| Button | What it does |
| --- | --- |
| `TURN ON` / `TURN OFF` | Turn all switches of the group on/off. A running timer of the group is cancelled. |
| `TOGGLE` | Everything off when anything is on, otherwise everything on. |
| `⏱️ TIMER` | Asks for a duration (`30s`, `10m`, `1h`) and on/off: the group switches now and back after that time. |
| `EDIT` | Name, Custom Command, the alarm off time and the schedule (see below). |
| 🗑️ | Remove the group. |

**Select menus**

| Menu | What it does |
| --- | --- |
| Switches in this group | Pick the switches of the group by name, the members are preselected. Discord allows 25 entries: with more switches the members come first. |
| Auto setting | `OFF`, `AUTO-DAY` (on during the day, off at night) or `AUTO-NIGHT` (on at night, off during the day). Switches when the in-game time turns. |
| Alarms that turn this group on | The Smart Alarms of the server that turn the group on when they fire (turrets, lights, ...). Only shown when the server has alarms. |

**Edit form**

* **Alarm: off again after** - e.g. `5m`: a group turned on by an alarm turns off again after that time. Empty = it stays on.
* **Schedule** - real-time windows such as `22:00-06:00 off, 18:00-22:00 on` (`on`/`off`, also `an`/`aus`). A time zone can be put in front: `Europe/Berlin: 22:00-06:00 off`; without one the time zone of the [settings channel](discord_text_channels.md#settings-channel) is used. A window switches the group when it begins and back when it ends; a restart does not switch anything by itself.

Switching a group runs up to four switches at the same time, a switch that does not answer is tried once more after two seconds, and the switches that stay unreachable are reported in **one** message (and one in-game line) instead of one per switch.

<br>

Smart Switch Groups can also be controlled from within the game through teamchat via custom commands. Custom command call combinations for the Smart Switch Group `Turrets` are shown below:
* **!t on** - To turn all the switches in the group ON.
* **!t off** - To turn all the switches in the group OFF.
* **!t on 60s** - To turn all the switches in the group ON and automatically turn them OFF after 60 seconds.
* **!t off 60s** - To turn all the switches in the group OFF and automatically turn them ON after 60 seconds.
* **!t status** - To get status of all Smart Switches in the group.

Group timers survive reconnects and restarts like the timers of single switches.


## Smart Alarms
> Paired Smart Alarms can be located in the `alarms` Text-Channel on Discord. All Smart Alarms from all servers will be shown in the channel.

![Image of a Smart Alarm](images/smart_devices/smart_alarm.png)

The image above is what a paired Smart Alarm looks like in Discord. In this case the Smart Alarm is called `Alarm` and is located at E16. All Smart Devices have an Entity Id which is used to identify it. From the `Last Trigger` you can see when the Smart Alarm was last triggered. Under `Message` you can see the Message is that will be broadcast when the Smart Alarm gets triggered. The Custom Command for this alarm is `!alarm` which can be used from the in-game teamchat. The Custom Command will tell you when it was last triggered.
<br><br>
By clicking the `@everyone` button you decide if the @everyone tag should be used in Discord when the Smart Alarm gets triggered. By clicking on the `EDIT` button, you can edit things such as the `Name`, `Message` and the `Custom Command` for the Smart Alarm. To remove the Smart Alarm, just click the trashcan button.
<br><br>
What happens when an alarm of the connected server fires:

* **Cooldown** - an alarm that fires again within the cooldown (default 60 s) posts no new message; the next message says how many triggers were left out.
* **Escalation** - the second trigger of the same alarm within 5 minutes mentions `@everyone`, also when the `@everyone` button of the alarm is off.
* **Raid mode** (default on) - when nobody of the team is online, the Discord users registered with `/credentials login` get a direct message (once per raid). Teammates that come online are noted, and after 10 minutes without an alarm a **raid report** goes to the activity channel: which alarms fired how often, who came online. A restart forgets a running raid.
* **Switch groups** - groups that have the alarm as trigger are turned on (see above).

Cooldown and raid mode are set in the `settings` channel. There are two more settings for Smart Alarms there: whether Smart Alarms that are not part of the currently connected server still notify when triggered (via push notifications), and whether Smart Alarms notify In-Game.


## Storage Monitors
> Paired Storage Monitors can be located in the `storagemonitors` Text-Channel on Discord. Only Storage Monitors from the currently/last connected Rust server will be shown in the channel.

![Image of a Storage Monitor](images/smart_devices/storage_monitor_tool_cupboard.png)
![Image of a Storage Monitor](images/smart_devices/storage_monitor_container.png)

The images above is what paired Storage Monitors looks like in Discord. There are three types of Storage Monitors depending on where you place them. The first one is of type `Tool Cupboard` and works almost like the second and third type `Large Wood Box` and `Vending Machine` but with the difference that it shows upkeep. In both cases the `Name` of the Storage Monitors is `Storage Monitor` and can be located at E16. All Smart Devices have an Entity Id which is used to identify it. It also shows how many slots the Storage Monitor has and how many of them are occupied. Lastly the Storage Monitor shows the content inside it, the items and quantity.
<br><br>
Tool Cupboard type Storage Monitor have the `@everyone` button that lets you decide if @everyone tag should be used in Discord when the Tool Cupboard starts to decay. By clicking on the `IN-GAME` button, you decide if decay notifications should be made In-Game as well.
<br><br>
**Upkeep early warning** - a Tool Cupboard warns once when its upkeep runs out within the time set in the `settings` channel (default 6 hours, `OFF` disables it), in the activity channel and in-game when `IN-GAME` is on. It warns again only after the cupboard was filled up past that time plus an hour.
<br><br>
Container type Storage Monitor have the `RECYCLE` button which lets you calculate what resources you would get if you recycled the content of the container.
<br><br>
By clicking on the `EDIT` button, you can edit the `Name` of the Storage Monitor and its **alerts**: rules such as `Rifle Ammo < 100, Low Grade Fuel < 50, Sulfur > 10k` (item name or short name, `<`, `<=`, `>`, `>=`, amounts like `10k`). A rule reports once when it becomes true (activity channel, in-game when the monitor's in-game setting is on) and again only after it was false in between. Stacks are added up, blueprints do not count, a monitor that is not reachable is not checked. The saved rules are shown in the message of the monitor (`Alerts`); a part that names no item is left out. Common names work too: `HQM`, `C4`, `frags`, `LGF`, `Rifle Ammo`, `Pistol Ammo`. To remove the Storage Monitor, just click the trashcan button.


## Unreachable Smart Devices
> When a Smart Devices gets removed, the hoster loses building privilege to the Smart Device or rustplusplus just don't get a response from pinging it, the device is unreachable. In the image below you can see the Smart Switch `Switch` can no longer be reached. In this case its because of a force wipe, The Smart Switch does no longer exist. If the Smart Device is unreachable because the hoster lost building privilege, gaining building privilege again will make the device reachable again. But if the Smart Device was removed from where it was placed you might as well remove it from Discord, once a Smart Device gets removed the Entity Id is invalid. Even if you place the same Smart Device, the Entity Id will be different.

![Image of an unreachable Smart Device](images/smart_devices/unreachable_device.png)


## After a wipe
> When the bot detects a map wipe of the connected server (the map changed), it clears what belonged to the old map - the death map, running switch timers, a raid in progress, the alert and upkeep states - and posts a **checklist** in the activity channel: the devices that have to be paired again, the switch groups to check, the alerts to set.

The checklist has a button **Remove the devices of the old map**. A private second step shows how many switches, alarms and storage monitors will be removed; with `RPP_NEED_ADMIN_PRIVILEGES` on (default) only administrators can confirm it. It removes the devices that existed when the wipe was detected (not the ones you paired since), with their Discord messages. They are marked as deleted, so the pairing history cannot bring them back. Switch groups stay with their name, command, schedule and automation - only the old switches and alarm triggers are taken out of them.

`/removedevices` does the same for **all** devices of the active server, for a wipe the bot did not notice (for example because it was offline).
