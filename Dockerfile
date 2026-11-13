FROM caddy:2.11.9-builder AS caddy-builder
WORKDIR /build/localcaddyhub
COPY src/modules/caddystarttls ./src/modules/caddystarttls
COPY scripts/build-caddy.sh ./scripts/build-caddy.sh
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 \
    && ./scripts/build-caddy.sh /caddy

FROM node:24.22.3-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/Ssakalis/LocalCaddyHub"
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=caddy-builder /caddy /usr/bin/caddy
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY static ./static
COPY Caddyfile ./Caddyfile
COPY examples ./examples
# Match the official Caddy storage layout; all three volumes must persist.
ENV NODE_ENV=production XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config
VOLUME ["/app/data", "/data", "/config"]
EXPOSE 8090 80 443 443/udp
CMD ["node", "src/index.js"]
