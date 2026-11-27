FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="rustplusplus"
LABEL org.opencontainers.image.description="A NodeJS Discord Bot that uses the rustplus.js library to utilize the power of the Rust+ Companion App with additional Quality-of-Life features."
LABEL org.opencontainers.image.url="https://github.com/HaxXorHardy/rustplusplus"
LABEL org.opencontainers.image.source="https://github.com/HaxXorHardy/rustplusplus"
LABEL org.opencontainers.image.documentation="https://github.com/HaxXorHardy/rustplusplus/blob/master/docs/documentation.md"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.authors="HaxXorHardy (https://github.com/HaxXorHardy) - based on FaiThiX (https://github.com/faithix) and Alexander Emanuelsson / alexemanuelol (https://github.com/alexemanuelol)"

RUN apt-get update \
    && apt-get install -y --no-install-recommends graphicsmagick ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
# Local stand-in packages referenced by package.json (file:stubs/...), needed by npm install.
COPY stubs /app/stubs

# Runtime dependencies only, exactly as locked: the bot runs with plain node (index.js); the TypeScript toolchain is a
# dev dependency.
RUN npm ci --omit=dev
COPY . /app

# Run as the unprivileged `node` user of the base image. The code stays owned by root (read-only for the bot); the
# directories the bot writes to are created and owned by `node` before VOLUME, so a fresh named volume starts
# writable. A bind mount keeps the owner of the host directory: one created by an earlier (root) container has to be
# chowned on the host (uid/gid 1000). data/ holds the static SQLite database, which SQLite may need to lock.
RUN mkdir -p /app/credentials /app/instances /app/logs /app/maps /app/runtime \
    && chown -R node:node /app/credentials /app/instances /app/logs /app/maps /app/runtime /app/data
USER node

VOLUME [ "/app/credentials" ]
VOLUME [ "/app/instances" ]
VOLUME [ "/app/logs" ]
VOLUME [ "/app/maps" ]
VOLUME [ "/app/runtime" ]

# node itself is the process that receives SIGTERM (npm did not forward it), see installProcessHandlers().
CMD ["node", "index.js"]
