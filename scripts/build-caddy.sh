#!/bin/sh
set -eu

# Keep native and container builds on the same tested module versions.
PROJECT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT=${1:-"$PROJECT_DIR/caddy"}
case "$OUTPUT" in /*) ;; *) OUTPUT="$PWD/$OUTPUT" ;; esac
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT HUP INT TERM
cd "$BUILD_DIR"
xcaddy build v2.11.9 \
  --with github.com/mholt/caddy-l4@v0.1.3 \
  --with github.com/corazawaf/coraza-caddy/v2@v2.6.2 \
  --with github.com/ssakalis/localcaddyhub/modules/caddystarttls="$PROJECT_DIR/src/modules/caddystarttls" \
  --output "$OUTPUT"
