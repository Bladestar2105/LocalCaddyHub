#!/bin/bash

set -e

echo "======================================================"
echo " LocalCaddyHub Update for Ubuntu 24.04 / Debian 12+"
echo "======================================================"

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script as root (e.g., sudo ./update.sh)"
  exit 1
fi

INSTALL_DIR="/opt/localcaddyhub"

echo "--> Stopping LocalCaddyHub service..."
if systemctl list-unit-files | grep -q localcaddyhub.service; then
  systemctl stop localcaddyhub
fi

echo "--> Updating LocalCaddyHub repository..."
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR"
  git pull
  echo "--> Installing npm dependencies..."
  npm install
else
  echo "Error: Directory $INSTALL_DIR not found. Is LocalCaddyHub installed?"
  exit 1
fi

echo "--> Building custom Caddy binary..."
# Create a temporary directory for building and ensure the user has access
BUILD_DIR=$(mktemp -d)
chown "${SUDO_USER:-root}" "$BUILD_DIR"

# Run as the original user to build
sudo -u "${SUDO_USER:-root}" -H bash -c '
  cd "$1"
  export PATH=$PATH:/usr/local/go/bin:$(go env GOPATH)/bin
  go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  $(go env GOPATH)/bin/xcaddy build \
    --with github.com/caddyserver/ntlm-transport \
    --with github.com/mholt/caddy-l4 \
    --with github.com/corazawaf/coraza-caddy/v2
' _ "$BUILD_DIR"

echo "--> Moving Caddy to /usr/local/bin and setting capabilities..."
mv "$BUILD_DIR/caddy" /usr/local/bin/
rm -rf "$BUILD_DIR"
setcap cap_net_bind_service=+ep /usr/local/bin/caddy

echo "--> Starting LocalCaddyHub service..."
if systemctl list-unit-files | grep -q localcaddyhub.service; then
  systemctl start localcaddyhub
fi

echo "======================================================"
echo " Update Complete!"
echo "======================================================"
