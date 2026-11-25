const Assert = require('node:assert');
const Test = require('node:test');

const Throttle = require('../src/util/outageLogThrottle.js');

const DNS = 'Could not read the pairing history of 76561198190865617: getaddrinfo ENOTFOUND companion-rust.facepunch.com';

function setup() {
    const clock = { ms: 1_000_000 };
    const summaries = [];
    Throttle.reset({ now: () => clock.ms });
    Throttle.setWriter((text) => summaries.push(text));

    return { clock, summaries };
}

/* Three failures within a minute: the outage is on. */
function startOutage(clock) {
    for (let i = 0; i < Throttle.FAILURES_TO_START; i++) {
        Throttle.shouldWrite('default', 'WARNING', DNS, 'warn');
        clock.ms += 1000;
    }
}

Test.describe('outageLogThrottle', () => {
    Test.afterEach(() => Throttle.reset());

    Test.it('recognises network failures', () => {
        Assert.ok(Throttle.isNetworkFailure(DNS));
        Assert.ok(Throttle.isNetworkFailure('Slow Discord request: DELETE /x took 10012 ms, failed (UND_ERR_CONNECT_TIMEOUT).'));
        Assert.ok(Throttle.isNetworkFailure('could not be registered (timeout of 15000ms exceeded)'));
        Assert.ok(!Throttle.isNetworkFailure('Camera "6767" could not be subscribed (not_found), it is skipped.'));
    });

    Test.it('writes everything while there is no outage', () => {
        setup();

        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Could not delete message: 1', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Could not delete message: 2', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'WARNING', DNS, 'warn'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'WARNING', DNS, 'warn'), true);
        Assert.strictEqual(Throttle.isActive(), false, 'two failures are no outage');
    });

    Test.it('writes each kind once during an outage, also the lines that follow a failure', () => {
        const { clock } = setup();
        startOutage(clock);
        Assert.strictEqual(Throttle.isActive(), true);

        Assert.strictEqual(Throttle.shouldWrite('default', 'WARNING', DNS, 'warn'), false);
        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Battlemetrics Server 123 failed to update.', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Battlemetrics Server 456 failed to update.', 'error'), false);

        /* Another guild, info and debug lines are not held back. */
        Assert.strictEqual(Throttle.shouldWrite('guild:2', 'ERROR', 'Battlemetrics Server 1 failed to update.', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'INFO', 'Poll cycles: 6', 'info'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'INFO', 'Poll cycles: 6', 'info'), true);
    });

    Test.it('says when the outage is over and what it left out, then writes everything again', () => {
        const { clock, summaries } = setup();
        startOutage(clock);
        Throttle.shouldWrite('default', 'WARNING', DNS, 'warn');
        Throttle.shouldWrite('default', 'ERROR', 'Could not delete message: 1', 'error');
        Throttle.shouldWrite('default', 'ERROR', 'Could not delete message: 2', 'error');
        Throttle.shouldWrite('default', 'ERROR', 'Could not delete message: 3', 'error');

        clock.ms += Throttle.QUIET_MS - 1;
        Throttle.check();
        Assert.deepStrictEqual(summaries, []);

        clock.ms += 1;
        Throttle.check();
        Assert.strictEqual(Throttle.isActive(), false);
        Assert.strictEqual(summaries.length, 1);
        Assert.match(summaries[0], /^The network problems are over/);
        /* The lines that started the outage were written, only the repeats after it are counted. */
        Assert.match(summaries[0], /3 repeated line\(s\)/);
        Assert.match(summaries[0], /2x "ERROR: Could not delete message: 1", 1x "WARNING: Could not read the pairing/);

        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Could not delete message: 4', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Could not delete message: 5', 'error'), true);
    });

    Test.it('reports a long outage on the way and writes each kind once again', () => {
        const { clock, summaries } = setup();
        startOutage(clock);

        for (let elapsed = 0; elapsed < Throttle.REPORT_EVERY_MS; elapsed += 60 * 1000) {
            Throttle.shouldWrite('default', 'WARNING', DNS, 'warn');
            clock.ms += 60 * 1000;
        }

        Assert.strictEqual(Throttle.shouldWrite('default', 'WARNING', DNS, 'warn'), true);
        Assert.strictEqual(summaries.length, 1);
        Assert.match(summaries[0], /^The network problems go on/);
        Assert.strictEqual(Throttle.isActive(), true);
    });

    Test.it('keeps the outage of one log out of the others and reports it into that log', () => {
        const { clock, summaries } = setup();
        const guildSummaries = [];
        const writeGuild = (text) => guildSummaries.push(text);

        /* One guild cannot reach its service: its own log has an outage, the bot log and other guilds do not. */
        for (let i = 0; i < Throttle.FAILURES_TO_START; i++) {
            Throttle.shouldWrite('guild:1', 'WARNING', DNS, 'warn', writeGuild);
            clock.ms += 1000;
        }

        Assert.strictEqual(Throttle.isActive('guild:1'), true);
        Assert.strictEqual(Throttle.isActive('guild:2'), false);
        Assert.strictEqual(Throttle.isActive('default'), false);

        Assert.strictEqual(Throttle.shouldWrite('guild:1', 'ERROR', 'Switch 1 failed.', 'error', writeGuild), true);
        Assert.strictEqual(Throttle.shouldWrite('guild:1', 'ERROR', 'Switch 2 failed.', 'error', writeGuild), false);
        Assert.strictEqual(Throttle.shouldWrite('guild:2', 'ERROR', 'Switch 1 failed.', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('guild:2', 'ERROR', 'Switch 2 failed.', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Message 1 not deleted.', 'error'), true);
        Assert.strictEqual(Throttle.shouldWrite('default', 'ERROR', 'Message 2 not deleted.', 'error'), true);

        clock.ms += Throttle.QUIET_MS;
        Throttle.check();

        Assert.strictEqual(Throttle.isActive(), false);
        Assert.strictEqual(guildSummaries.length, 1, 'the summary goes into the log that left the lines out');
        Assert.match(guildSummaries[0], /1x "ERROR: Switch 1 failed\."/);
        Assert.deepStrictEqual(summaries, [], 'the bot log has nothing to report');
    });

    Test.it('takes the stack and the ids out of the kind', () => {
        const a = Throttle.kindOf('default', 'ERROR', "[\n  'Message send failed: ',\n  '    at onConnectTimeout (/app/x.js:1:2)'\n]");
        const b = Throttle.kindOf('default', 'ERROR', "[\n  'Message send failed: ',\n  '    at other (/app/y.js:9:9)'\n]");
        Assert.strictEqual(a, b);
    });
});
