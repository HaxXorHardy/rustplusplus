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

const Util = require('util');

const MAX_DEPTH = 5;
const MAX_ITEMS = 20;
const MAX_PROPERTIES = 50;
const MAX_STRING_LENGTH = 4000;
const MAX_OUTPUT_LENGTH = 32000;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|passwd|secret|token|api[-_]?key/i;
const SENSITIVE_TEXT_KEY_PATTERN =
    /\b(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|security[-_]?token|player[-_]?token|(?:x[-_])?api[-_]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s;&]+)/gi;

function safeGet(value, key) {
    try {
        return value[key];
    }
    catch (e) {
        return undefined;
    }
}

/* Narrow an unknown caught value to a printable message. */
function errorMessage(error) {
    return (error instanceof Error) ? error.message : String(error);
}

function redactText(value, secrets) {
    let text;
    try {
        text = String(value);
    }
    catch (e) {
        text = '[Unprintable value]';
    }

    for (const secret of secrets) {
        text = text.split(secret).join(REDACTED);
    }

    text = text.replace(/\b(Bearer|Bot|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]');
    text = text.replace(SENSITIVE_TEXT_KEY_PATTERN, `$1$2${REDACTED}`);

    if (text.length > MAX_STRING_LENGTH) {
        return `${text.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
    }

    return text;
}

function isErrorLike(value) {
    try {
        if (value instanceof Error) return true;
    }
    catch (e) {
        return false;
    }
    if (value === null || typeof value !== 'object') return false;

    return typeof safeGet(value, 'message') === 'string' || typeof safeGet(value, 'stack') === 'string';
}

function formatScalar(value, state) {
    if (typeof value === 'string') return redactText(value, state.secrets);
    try {
        const sanitized = value !== null && typeof value === 'object' ? sanitizeValue(value, state, 1) : value;
        return Util.inspect(sanitized, { colors: false, depth: 1 });
    }
    catch (e) {
        return '[Unprintable value]';
    }
}

function prefixMultiline(prefix, value) {
    const lines = value.split(/\r?\n/);
    return [`${prefix}${lines[0]}`, ...lines.slice(1).map(line => `  ${line}`)];
}

function formatError(error, state, depth) {
    if (depth > MAX_DEPTH) return '[Error depth exceeded]';
    if (state.seen.has(error)) return '[Circular Error]';

    state.seen.add(error);

    const nameValue = safeGet(error, 'name');
    const messageValue = safeGet(error, 'message');
    const name = redactText(typeof nameValue === 'string' && nameValue ? nameValue : 'Error', state.secrets);
    const message = typeof messageValue === 'string' ? redactText(messageValue, state.secrets) : '';
    const metadata = [];

    for (const key of ['code', 'status', 'statusCode', 'errno', 'syscall']) {
        const value = safeGet(error, key);
        if (value !== undefined && value !== null && value !== '') {
            const formattedValue = formatScalar(value, state);
            if (key === 'code' && name.includes(formattedValue)) continue;
            metadata.push(`${key}=${formattedValue}`);
        }
    }

    const response = safeGet(error, 'response');
    const responseStatus = response && safeGet(response, 'status');
    if (responseStatus !== undefined && !metadata.some(item => item.startsWith('status='))) {
        metadata.push(`status=${formatScalar(responseStatus, state)}`);
    }

    let headline = name;
    if (metadata.length > 0) headline += ` [${metadata.join(', ')}]`;
    if (message) headline += `: ${message}`;

    const lines = [headline];
    const config = safeGet(error, 'config');
    const method = config && safeGet(config, 'method');
    const url = config && safeGet(config, 'url');
    if (method || url) {
        const request = [method ? redactText(method, state.secrets).toUpperCase() : null,
            url ? redactText(url, state.secrets) : null]
            .filter(Boolean).join(' ');
        lines.push(`Request: ${request}`);
    }

    if (response) {
        const statusText = safeGet(response, 'statusText');
        if (statusText) lines.push(`Response status: ${redactText(statusText, state.secrets)}`);

        const data = safeGet(response, 'data');
        if (data !== undefined) {
            lines.push(...prefixMultiline('Response: ', formatAny(data, state, depth + 1)));
        }
    }

    if (state.includeStack) {
        const stack = safeGet(error, 'stack');
        if (typeof stack === 'string' && stack) {
            const stackLines = redactText(stack, state.secrets).split(/\r?\n/);
            if (stackLines.length > 1) lines.push(...stackLines.slice(1));
        }
    }

    const cause = safeGet(error, 'cause');
    if (cause !== undefined) {
        lines.push(...prefixMultiline('Caused by: ', formatAny(cause, state, depth + 1)));
    }

    const errors = safeGet(error, 'errors');
    if (Array.isArray(errors)) {
        for (let i = 0; i < Math.min(errors.length, MAX_ITEMS); i++) {
            lines.push(...prefixMultiline(`Error ${i + 1}: `, formatAny(errors[i], state, depth + 1)));
        }
        if (errors.length > MAX_ITEMS) lines.push(`...${errors.length - MAX_ITEMS} more errors`);
    }

    state.seen.delete(error);
    return lines.join('\n');
}

function sanitizeValue(value, state, depth) {
    if (typeof value === 'string') return redactText(value, state.secrets);
    if (value === null || typeof value !== 'object') return value;
    if (isErrorLike(value)) return formatError(value, state, depth);
    if (depth > MAX_DEPTH) return '[Depth exceeded]';
    if (state.seen.has(value)) return '[Circular]';

    state.seen.add(value);

    if (Array.isArray(value)) {
        const result = value.slice(0, MAX_ITEMS).map(item => sanitizeValue(item, state, depth + 1));
        if (value.length > MAX_ITEMS) result.push(`...${value.length - MAX_ITEMS} more items`);
        state.seen.delete(value);
        return result;
    }

    const result = {};
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch (e) {
        state.seen.delete(value);
        return `[Uninspectable object: ${redactText(errorMessage(e), state.secrets)}]`;
    }

    const keys = Object.keys(descriptors);
    for (const key of keys.slice(0, MAX_PROPERTIES)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            result[key] = REDACTED;
            continue;
        }

        const descriptor = descriptors[key];
        result[key] = Object.prototype.hasOwnProperty.call(descriptor, 'value') ?
            sanitizeValue(descriptor.value, state, depth + 1) : '[Getter/Setter]';
    }
    if (keys.length > MAX_PROPERTIES) result['...'] = `${keys.length - MAX_PROPERTIES} more properties`;

    state.seen.delete(value);
    return result;
}

function formatAny(value, state, depth = 0) {
    if (isErrorLike(value)) return formatError(value, state, depth);
    if (typeof value === 'string') return redactText(value, state.secrets);
    if (value === undefined) return 'undefined';

    try {
        return Util.inspect(sanitizeValue(value, state, depth), {
            colors: false,
            depth: MAX_DEPTH,
            maxArrayLength: MAX_ITEMS,
            breakLength: 120,
            compact: 3,
        });
    }
    catch (e) {
        return `[Uninspectable value: ${redactText(errorMessage(e), state.secrets)}]`;
    }
}

module.exports = function formatLogValue(value, options = {}) {
    const secrets = Array.isArray(options.secrets) ? options.secrets
        .filter(secret => typeof secret === 'string' && secret.length >= 8) : [];
    const state = {
        includeStack: options.includeStack === true,
        secrets: secrets,
        seen: new WeakSet(),
    };

    const formatted = formatAny(value, state);
    if (formatted.length <= MAX_OUTPUT_LENGTH) return formatted;
    return `${formatted.slice(0, MAX_OUTPUT_LENGTH)}\n...[output truncated]`;
};
