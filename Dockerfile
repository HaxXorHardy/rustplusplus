FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="rustplusplus"
LABEL org.opencontainers.image.description="A NodeJS Discord Bot that uses the rustplus.js library to utilize the power of the Rust+ Companion App with additional Quality-of-Life features."
LABEL org.opencontainers.image.url="https://github.com/HaxXorHardy/rustplusplus"
LABEL org.opencontainers.image.source="https://github.com/HaxXorHardy/rustplusplus"
LABEL org.opencontainers.image.documentation="https://github.com/HaxXorHardy/rustplusplus/blob/master/docs/documentation.md"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.authors="HaxXorHardy (https://github.com/HaxXorHardy) - based on FaiThiX (https://github.com/faithix) and Alexander Emanuelsson / alexemanuelol (https://github.com/alexemanuelol)"

RUN apt-get update && apt-get install -y graphicsmagick && apt-get clean

WORKDIR /app

COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm install
COPY . /app

VOLUME [ "/app/credentials" ]
VOLUME [ "/app/instances" ]
VOLUME [ "/app/logs" ]
VOLUME [ "/app/maps" ]

CMD ["npm", "start"]
