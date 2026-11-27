#!/bin/sh
# Starts the bot as the unprivileged `node` user.
#
# Volumes of an older image (which ran as root) are owned by root, and a volume keeps its owner when the image
# changes. As root, hand the directories the bot writes to over to `node` - only when they are not owned by it yet,
# so a normal start does not walk the whole tree - and drop the privileges. exec keeps the command (node) the
# process that receives SIGTERM. Any command works, e.g. `docker run ... node scripts/rustplusLogin.js`.
set -eu

NODE_UID="$(id -u node)"

if [ "$(id -u)" = "0" ]; then
    for dir in /app/credentials /app/instances /app/logs /app/maps /app/runtime; do
        mkdir -p "$dir"
        if [ "$(stat -c %u "$dir")" != "$NODE_UID" ]; then
            echo "docker-entrypoint: $dir is not owned by node, changing the owner to node:node" >&2
            chown -R node:node "$dir"
        fi
    done

    export HOME=/home/node
    exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
