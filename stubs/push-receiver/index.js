'use strict';

/* Stand-in for @liamcottle/push-receiver (see package.json): any use from the rustplus.js CLI fails loudly. */
function unavailable() {
    throw new Error('@liamcottle/push-receiver is not installed in rustplusplus; the bot uses src/util/fcm.');
}

module.exports = {
    listen: unavailable,
    register: unavailable,
    AndroidFCM: { register: unavailable },
    Client: class Client { constructor() { unavailable(); } },
};
