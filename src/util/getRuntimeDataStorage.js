const RuntimeDataStorage = require('./RuntimeDataStorage');

let runtimeDataStorage = null;

module.exports = () => {
    if (runtimeDataStorage === null) {
        runtimeDataStorage = new RuntimeDataStorage();
    }

    return runtimeDataStorage;
};

/* Release the cached instance. Used by tests and by scripts that need a clean lifecycle; production
   code keeps using the lazily created singleton. */
module.exports.reset = () => {
    if (runtimeDataStorage !== null) {
        runtimeDataStorage.close();
        runtimeDataStorage = null;
    }
};
