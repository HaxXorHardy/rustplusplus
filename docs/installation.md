# Installation Documentation

## Required Software

Program | Version | Download | Note
------- | ------- | -------- | ----
`NodeJS` | >= 22.13.0 | [**here**](https://nodejs.org/en/download/) | The runtime data is stored with the built-in `node:sqlite`, which needs no `--experimental-sqlite` flag from 22.13.0 on.
`Git` | Any | [**here**](https://git-scm.com/downloads) | &nbsp;

## Optional Software
[**FFmpeg**](https://ffmpeg.org/download.html) (with libopus, as in the usual builds) has to be on the `PATH` for the voice feature (`/voice join`, event notifications spoken in the voice channel): the text-to-speech audio is converted with it. The Docker image contains it.

[**GraphicsMagick**](http://www.graphicsmagick.org/download.html) draws the step-trace of the cargoship and the patrol helicopter on the map. The Rust+ API no longer reports those two, so it is not needed at the moment; the Docker image contains it anyway.

## Configuration
Copy [`.env.example`](../.env.example) to `.env` and fill in at least `RPP_DISCORD_CLIENT_ID` and `RPP_DISCORD_TOKEN` (see [Discord Bot Setup](discord_bot_setup.md)). Every other value has a default.


## Clone the repository

Open a terminal (`Git Bash` / `CMD` / `Terminal` / `PowerShell` or similar) and run the following commands:

    $ git clone https://github.com/HaxXorHardy/rustplusplus.git
    $ cd rustplusplus
    $ npm install
