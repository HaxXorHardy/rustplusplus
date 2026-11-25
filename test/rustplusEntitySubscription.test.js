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

const Assert = require('node:assert');
const Test = require('node:test');

const Client = require('../src/structures/clientRegistry.js');
const RustPlus = require('../src/structures/RustPlus.js');

const SERVER_ID = 'relay-6f2a1c3d-4b5e-4978-8a9b-0c1d2e3f4a5b';

/* Only the parts of the instance are needed, the entities are just ids. */
function fakeInstance(server) {
    return { serverList: server ? { [SERVER_ID]: server } : {} };
}

function fakeRustplus(failing = []) {
    return {
        serverId: SERVER_ID,
        calls: [],
        log() { /* the test does not need the log */ },
        async setSubscriptionAsync(entityId, value) {
            /* setSubscriptionAsync reports failures through the resolved value. */
            if (failing.includes(entityId)) return { error: 'entity unknown' };

            this.calls.push([entityId, value]);
            return {};
        },
    };
}

Test.describe('RustPlus.subscribeEntities', () => {
    Test.it('subscribes to the alarms of the server', async () => {
        const rustplus = fakeRustplus();
        const instance = fakeInstance({
            switches: { '111': {}, '222': {} },
            alarms: { '333': {}, '444': {} },
            storageMonitors: { '555': {} },
        });

        const subscribed = await RustPlus.prototype.subscribeEntities.call(rustplus, instance);

        Assert.strictEqual(subscribed, 2);
        Assert.deepStrictEqual(rustplus.calls, [['333', true], ['444', true]]);
    });

    Test.it('keeps going when a single alarm fails', async () => {
        /* The failure is logged, which needs the translation of the bot instance. */
        const previousClient = Client.client;
        Client.client = { intlGet: () => 'WARNING' };

        try {
            const rustplus = fakeRustplus(['222']);
            const instance = fakeInstance({ alarms: { '111': {}, '222': {} } });

            Assert.strictEqual(await RustPlus.prototype.subscribeEntities.call(rustplus, instance), 1);
            Assert.deepStrictEqual(rustplus.calls, [['111', true]]);
        }
        finally {
            Client.client = previousClient;
        }
    });

    Test.it('does nothing for an unknown server or without alarms', async () => {
        const rustplus = fakeRustplus();

        Assert.strictEqual(await RustPlus.prototype.subscribeEntities.call(rustplus, fakeInstance(null)), 0);
        Assert.strictEqual(await RustPlus.prototype.subscribeEntities.call(rustplus,
            fakeInstance({ switches: { '111': {} } })), 0);
        Assert.deepStrictEqual(rustplus.calls, []);
    });
});

Test.describe('RustPlus.subscribeAlarm', () => {
    Test.it('subscribes one alarm and tells whether it worked', async () => {
        const previousClient = Client.client;
        Client.client = { intlGet: () => 'INFO' };

        try {
            const ok = fakeRustplus();
            Assert.strictEqual(await RustPlus.prototype.subscribeAlarm.call(ok, 7854530), true);
            Assert.deepStrictEqual(ok.calls, [['7854530', true]]);

            const failing = fakeRustplus(['7854530']);
            Assert.strictEqual(await RustPlus.prototype.subscribeAlarm.call(failing, '7854530'), false);
        }
        finally {
            Client.client = previousClient;
        }
    });

    Test.it('marks an alarm the server does not know like subscribeEntities, and again reachable when it works',
        async () => {
            const previousClient = Client.client;
            const alarm = { name: 'Base' };
            const instance = fakeInstance({ alarms: { '7854530': alarm } });
            let saved = 0;
            Client.client = { intlGet: () => 'INFO', getInstance: () => instance, setInstance: () => { saved += 1; } };

            try {
                const gone = fakeRustplus();
                gone.setSubscriptionAsync = async () => ({ error: 'not_found' });

                Assert.strictEqual(await RustPlus.prototype.subscribeAlarm.call(gone, '7854530'), false);
                Assert.strictEqual(alarm.reachable, false);
                Assert.strictEqual(saved, 1);

                Assert.strictEqual(await RustPlus.prototype.subscribeAlarm.call(fakeRustplus(), '7854530'), true);
                Assert.strictEqual(alarm.reachable, true);
                Assert.strictEqual(saved, 2);

                /* A timeout says nothing about the entity. */
                const slow = fakeRustplus();
                slow.setSubscriptionAsync = async () => new Error('Timeout reached while waiting for response');
                Assert.strictEqual(await RustPlus.prototype.subscribeAlarm.call(slow, '7854530'), false);
                Assert.strictEqual(alarm.reachable, true);
                Assert.strictEqual(saved, 2);
            }
            finally {
                Client.client = previousClient;
            }
        });
});
