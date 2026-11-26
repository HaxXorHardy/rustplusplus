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
    Coalesced and throttled runs of one job per key (one message, one device).

    - At most one run per key at a time. A request while it runs only marks the key as outdated, and one more run with
      the latest state follows.
    - A throttled request runs at most once per interval, measured from the end of the previous run. A request in the
      pause only marks the key as outdated; the run at the end of the pause shows the latest state.
    - An immediate request (a button, the storage monitor round) does not wait for the pause. While a run is going on
      it is queued right after it.
    - The newest job of a key wins: a request replaces the job of the run that is still due.

    The caller of a run that starts at once waits for it and gets its error; later runs are detached and report errors
    through onError. An interval of 0 turns the pause off (the runs are only coalesced).
*/
function createKeyedThrottle(getIntervalMs, onError = () => undefined) {
    const states = new Map();

    function intervalMs() {
        const value = Number(getIntervalMs());
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function getState(key) {
        let state = states.get(key);
        if (!state) {
            state = { running: false, dirty: false, urgent: false, lastRunAt: null, timer: null, job: null };
            states.set(key, state);
        }
        return state;
    }

    function clearTimer(state) {
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
    }

    function schedule(key, state, waitMs) {
        clearTimer(state);
        state.timer = setTimeout(() => {
            state.timer = null;
            if (state.running) return;

            /* The pause of an idle key is over: it is forgotten (the keys are messages and devices that come and go). */
            if (!state.dirty) {
                if (states.get(key) === state) states.delete(key);
                return;
            }

            detached(key, state);
        }, Math.max(0, waitMs));
        /* A pending update does not keep the process alive. */
        if (state.timer && typeof state.timer.unref === 'function') state.timer.unref();
    }

    function remainingPauseMs(state) {
        if (state.lastRunAt === null) return 0;
        return state.lastRunAt + intervalMs() - Date.now();
    }

    async function execute(key, state) {
        clearTimer(state);
        state.running = true;
        state.dirty = false;
        state.urgent = false;

        try {
            await state.job();
        }
        finally {
            state.running = false;
            state.lastRunAt = Date.now();

            if (state.dirty) {
                if (state.urgent) {
                    detached(key, state);
                }
                else {
                    schedule(key, state, remainingPauseMs(state));
                }
            }
            else if (intervalMs() === 0) {
                if (states.get(key) === state) states.delete(key);
            }
            else {
                /* Kept for the pause (lastRunAt), then forgotten unless another request came. */
                schedule(key, state, remainingPauseMs(state));
            }
        }
    }

    function detached(key, state) {
        execute(key, state).catch((e) => onError(key, e));
    }

    return {
        /*
            options.immediate: run now (or right after the running one) instead of after the pause.
            options.delayMs: the earliest start of a throttled run (e.g. to let the server settle first).
            Resolves when the run started by this request is done, at once when the request was only noted.
        */
        request: function (key, job, options = {}) {
            const state = getState(key);
            state.job = job;

            if (state.running) {
                state.dirty = true;
                if (options.immediate) state.urgent = true;
                return Promise.resolve();
            }

            if (options.immediate) return execute(key, state);

            /* A run is due: it takes the newest job. (A timer of a clean key only forgets it, see schedule.) */
            if (state.timer && state.dirty) {
                return Promise.resolve();
            }

            const waitMs = Math.max(options.delayMs || 0, remainingPauseMs(state));
            if (waitMs <= 0) return execute(key, state);

            state.dirty = true;
            schedule(key, state, waitMs);
            return Promise.resolve();
        },

        /* True while a run of the key is going on or due. */
        isPending: function (key) {
            const state = states.get(key);
            return !!state && (state.running || state.dirty);
        },

        /* The number of keys that are remembered (tests). */
        size: function () {
            return states.size;
        },

        /* Forgets every key and cancels the due runs (tests). */
        reset: function () {
            for (const state of states.values()) clearTimer(state);
            states.clear();
        },
    };
}

module.exports = {
    createKeyedThrottle: createKeyedThrottle,
};
