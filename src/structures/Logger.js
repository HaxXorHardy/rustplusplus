/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

const Colors = require("colors");
const Winston = require("winston");

const Config = require('../../config');
const formatLogValue = require('../util/formatLogValue');

class Logger {
    constructor(logFilePath, type) {
        this.logger = Winston.createLogger({
            /* In debug mode the file transport must also accept the 'debug' level. */
            level: Config.general.debug ? 'debug' : 'info',
            transports: [new Winston.transports.File({
                filename: logFilePath,
                maxsize: 10000000,
                maxFiles: 2,
                tailable: true
            })],
        });

        this.type = type;
        this.guildId = null;
        this.serverName = null;
    }

    setGuildId(guildId) {
        this.guildId = guildId;
    }

    getTime() {
        let d = new Date();

        let year = d.getFullYear();
        let month = d.getMonth() + 1;
        let date = d.getDate() < 10 ? ('0' + d.getDate()) : d.getDate();
        let hours = d.getHours() < 10 ? ('0' + d.getHours()) : d.getHours();
        let minutes = d.getMinutes() < 10 ? ('0' + d.getMinutes()) : d.getMinutes();
        let seconds = d.getSeconds() < 10 ? ('0' + d.getSeconds()) : d.getSeconds();

        return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
    }

    formatError(error, includeStack = Config.general.showCallStackError) {
        return formatLogValue(error, {
            includeStack: Boolean(includeStack),
            secrets: [Config.discord.token, Config.battlemetrics?.token],
        });
    }

    log(title, text, level = 'info') {
        /* Debug logs are only emitted when debug mode is enabled (RPP_DEBUG=true). */
        if (level === 'debug' && !Config.general.debug) {
            return;
        }

        let time = this.getTime();
        const lines = this.formatError(text, level === 'error' && Config.general.showCallStackError)
            .split(/\r?\n/);
        lines[0] = `${title}: ${lines[0]}`;

        switch (this.type) {
            case 'default': {
                for (const line of lines) {
                    this.logger.log({
                        level: level,
                        message: `${time} | ${line}`
                    });

                    console.log(
                        Colors.green(`${time} `) +
                        ((level === 'error') ? Colors.red(line) : ((level === 'debug') ? Colors.gray(line) : Colors.yellow(line)))
                    );
                }
            } break;

            case 'guild': {
                for (const line of lines) {
                    this.logger.log({
                        level: level,
                        message: `${time} | ${this.guildId} | ${this.serverName} | ${line}`
                    });

                    console.log(
                        Colors.green(`${time} `) +
                        Colors.cyan(`${this.guildId} `) +
                        Colors.white(`${this.serverName} `) +
                        ((level === 'error') ? Colors.red(line) : ((level === 'debug') ? Colors.gray(line) : Colors.yellow(line)))
                    );
                }
            } break;

            default: {
            } break;
        }
    }

    /* Convenience wrapper: only writes when debug mode is enabled. */
    debug(title, text) {
        this.log(title, text, 'debug');
    }
}

module.exports = Logger;
