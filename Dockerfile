# Stage 1: Build Custom Caddy with NTLM Support
FROM caddy:builder AS caddy-builder

# xcaddy is pre-installed in caddy:builder
RUN xcaddy build \
    --with github.com/caddyserver/ntlm-transport \
    --output /caddy

# Stage 2: Build Go Manager Application
# Use golang image for building the manager
FROM golang:1.20-bookworm AS manager-builder

WORKDIR /app

# Copy Go source
COPY main.go .

# Build the Go application statically
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /server main.go
RUN chmod +x /server

# Stage 3: Final Image
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy Caddy binary from builder
COPY --from=caddy-builder /caddy /usr/bin/caddy

# Copy Manager binary from builder
COPY --from=manager-builder /server /app/server

# Copy static assets and default configuration
COPY static /app/static
COPY Caddyfile /app/Caddyfile

# Ensure execution permissions (just in case)
RUN chmod +x /usr/bin/caddy /app/server

# Expose necessary ports
EXPOSE 8090 80 443

# Start the manager
CMD ["/app/server"]
