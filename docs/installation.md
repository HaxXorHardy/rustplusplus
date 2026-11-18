# Installation Documentation

## Required Software

Program | Version | Download | Note
------- | ------- | -------- | ----
`NodeJS` | >= 22.12.0 | [**here**](https://nodejs.org/en/download/) | Since discordjs v14 is used, the version needs to be at least 22.12.0.
`Git` | Any | [**here**](https://git-scm.com/downloads) | &nbsp;

## Optional Software
[**GraphicsMagick**](http://www.graphicsmagick.org/download.html) draws the step-trace of the cargoship and the patrol helicopter on the map. The Rust+ API no longer reports those two, so it is not needed at the moment; the Docker image contains it anyway.

## Configuration
Copy [`.env.example`](../.env.example) to `.env` and fill in at least `RPP_DISCORD_CLIENT_ID` and `RPP_DISCORD_TOKEN` (see [Discord Bot Setup](discord_bot_setup.md)). Every other value has a default.


## Clone the repository

Open a terminal (`Git Bash` / `CMD` / `Terminal` / `PowerShell` or similar) and run the following commands:

    $ git clone https://github.com/HaxXorHardy/rustplusplus.git
    $ cd rustplusplus
    $ npm install
