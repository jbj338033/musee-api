FROM oven/bun:1 AS base

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl ffmpeg && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get purge -y curl && apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY tsconfig.json ./

RUN mkdir -p /app/data/audio

ENV DATA_DIR=/app/data
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
