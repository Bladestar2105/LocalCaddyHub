# Stage 1: Build Custom Caddy with NTLM Support
FROM caddy:builder AS caddy-builder

# xcaddy is pre-installed in caddy:builder
RUN xcaddy build \
    --with github.com/caddyserver/ntlm-transport \
    --with github.com/mholt/caddy-l4 \
    --output /caddy

# Stage 2: Node Application setup
FROM node:22-bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy Caddy binary from builder
COPY --from=caddy-builder /caddy /usr/bin/caddy

# Ensure execution permissions (just in case)
RUN chmod +x /usr/bin/caddy

# Copy package.json and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source code, static assets and default configuration
COPY src ./src
COPY static ./static
COPY Caddyfile ./Caddyfile

# Expose necessary ports
EXPOSE 8090 80 443

# Start the Node.js application
CMD ["npm", "start"]
