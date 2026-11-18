/*
    Copyright (C) 2026

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

/*
    Storage alerts: rules per storage monitor such as "Rifle Ammo < 100" or "Sulfur > 10000", set in the edit form
    of the monitor. A rule reports once when it becomes true and again only after it was false in between
    (entity.alerts[].triggered). Blueprints do not count.
*/

const RULE = /^(.+?)\s*(<=|>=|<|>)\s*([\d.,]+\s*[kK]?)$/;

/* "10k" -> 10000, "1.5k" -> 1500, "2,000" -> 2000 */
function parseAmount(text) {
    const clean = `${text}`.replace(/\s/g, '').replace(/,/g, '');
    const thousand = /k$/i.test(clean);
    const value = Number(thousand ? clean.slice(0, -1) : clean);
    if (!Number.isFinite(value) || value < 0) return null;

    return Math.round(thousand ? value * 1000 : value);
}

/* The item id for a name the user typed: the exact name or short name first, else the closest name. */
function findItemId(items, name) {
    const wanted = `${name}`.trim().toLowerCase();
    if (wanted === '') return null;

    for (const [id, item] of Object.entries(items.items || {})) {
        if (`${item.name}`.toLowerCase() === wanted || `${item.shortname}`.toLowerCase() === wanted) return id;
    }

    return typeof items.getClosestItemIdByName === 'function' ? items.getClosestItemIdByName(name) : null;
}

/*
    Parse the text of the edit form. Returns { rules, rejected }: rules = [{ itemId, op, amount, triggered: false }],
    rejected = the parts that were no rule or named no item.
*/
function parse(items, text) {
    const rules = [];
    const rejected = [];

    for (const part of `${text || ''}`.split(/[,;\n]+/)) {
        const trimmed = part.trim();
        if (trimmed === '') continue;

        const match = RULE.exec(trimmed);
        const amount = match ? parseAmount(match[3]) : null;
        const itemId = match ? findItemId(items, match[1]) : null;

        if (!match || amount === null || itemId === null) {
            rejected.push(trimmed);
            continue;
        }

        rules.push({ itemId: `${itemId}`, op: match[2], amount: amount, triggered: false });
    }

    return { rules: rules, rejected: rejected };
}

/* The rules as text for the edit form. */
function format(items, rules) {
    if (!Array.isArray(rules)) return '';

    return rules.map((rule) => `${items.getName(rule.itemId) || rule.itemId} ${rule.op} ${rule.amount}`).join(', ');
}

/* item id -> quantity in the storage, without blueprints. */
function quantities(storageItems) {
    const result = {};

    for (const item of storageItems || []) {
        if (!item || item.itemIsBlueprint) continue;
        const id = `${item.itemId}`;
        result[id] = (result[id] || 0) + (Number(item.quantity) || 0);
    }

    return result;
}

function holds(rule, quantity) {
    switch (rule.op) {
        case '<': return quantity < rule.amount;
        case '<=': return quantity <= rule.amount;
        case '>': return quantity > rule.amount;
        case '>=': return quantity >= rule.amount;
        default: return false;
    }
}

/*
    Check the rules of a monitor against its items. Marks the rules (triggered) and returns the ones that just became
    true: [{ rule, quantity }]. changed tells whether the instance has to be saved.
*/
function evaluate(entity, storageItems) {
    const result = { fired: [], changed: false };
    if (!entity || !Array.isArray(entity.alerts) || entity.alerts.length === 0) return result;

    const counts = quantities(storageItems);

    for (const rule of entity.alerts) {
        const quantity = counts[`${rule.itemId}`] || 0;
        const now = holds(rule, quantity);

        if (now && !rule.triggered) {
            rule.triggered = true;
            result.fired.push({ rule: rule, quantity: quantity });
            result.changed = true;
        }
        else if (!now && rule.triggered) {
            rule.triggered = false;
            result.changed = true;
        }
    }

    return result;
}

/*
    After a storage monitor was read: report the rules that just became true (activity channel, and in game when
    the monitor's in-game setting is on). rustplus.storageMonitors[entityId] holds the items.
*/
async function check(client, rustplus, entityId) {
    const instance = client.getInstance(rustplus.guildId);
    const server = instance.serverList[rustplus.serverId];
    const entity = server ? server.storageMonitors[entityId] : null;
    const storage = rustplus.storageMonitors ? rustplus.storageMonitors[entityId] : null;
    /* An unreachable monitor keeps its last contents: checking them would report a state that is gone. */
    if (!entity || !storage || entity.reachable === false) return;

    const result = evaluate(entity, storage.items);
    if (result.changed) client.setInstance(rustplus.guildId, instance);

    for (const { rule, quantity } of result.fired) {
        const text = client.intlGet(rustplus.guildId, 'storageAlertFired', {
            device: entity.name,
            item: client.items.getName(rule.itemId) || rule.itemId,
            quantity: `${quantity}`,
            rule: `${rule.op} ${rule.amount}`
        });

        rustplus.log(client.intlGet(null, 'infoCap'), text);

        const DiscordMessages = require('../discordTools/discordMessages.js');
        await DiscordMessages.sendStorageAlertMessage(rustplus.guildId, rustplus.serverId, entityId, text);

        if (entity.inGame) rustplus.sendInGameMessage(text);
    }
}

module.exports = {
    parse: parse,
    format: format,
    evaluate: evaluate,
    check: check,
};
