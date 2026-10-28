const RustlabsStaticStorage = require('./RustlabsStaticStorage');

let staticFilesStorage = null;

module.exports = () => {
    if (staticFilesStorage === null) {
        staticFilesStorage = new RustlabsStaticStorage();
    }

    return staticFilesStorage;
};

/* Release the cached instance so tests and scripts can control the storage lifecycle. Production code
   keeps using the lazily created singleton. */
module.exports.reset = () => {
    if (staticFilesStorage !== null) {
        staticFilesStorage.close();
        staticFilesStorage = null;
    }
};

