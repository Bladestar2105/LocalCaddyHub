#!/bin/bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./setup.sh" >&2
  exit 1
fi
INSTALL_DIR=${LCH_INSTALL_DIR:-/opt/localcaddyhub}
if [ -e /etc/systemd/system/localcaddyhub.service ]; then
  echo "Service already installed. Use update.sh to preserve credentials and recover failed updates." >&2
  exit 1
fi
apt-get update
apt-get install -y git libcap2-bin curl ca-certificates openssl xz-utils build-essential python3
# NodeSource's 24.x channel follows the supported Node 24 LTS patch releases.
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)'

# Install a private Go toolchain without replacing an existing system Go.
GO_ROOT=/opt/localcaddyhub-tools/go1.27.4
if [ ! -x "$GO_ROOT/go/bin/go" ]; then
  case "$(uname -m)" in
    x86_64) arch=amd64; checksum=7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840 ;;
    aarch64|arm64) arch=arm64; checksum=3392582988a273a87ab5043ee1b2c9c17a2c3c00580bf9326c47a2e0aaaeac92 ;;
    *) echo "Unsupported architecture; install Go 1.26.9 or newer manually." >&2; exit 1 ;;
  esac
  archive=$(mktemp)
  trap 'rm -f "$archive"' EXIT
  curl -fsSL "https://go.dev/dl/go1.27.4.linux-$arch.tar.gz" -o "$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
  mkdir -p "$GO_ROOT"
  tar -xzf "$archive" -C "$GO_ROOT"
  rm -f "$archive"
  trap - EXIT
fi
export PATH="$GO_ROOT/go/bin:$PATH"
if [ ! -d "$INSTALL_DIR" ]; then
  git clone https://github.com/ssakalis/localcaddyhub.git "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
npm ci
npm run test:runtime
go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
GO_BIN="$(go env GOPATH)/bin"
export PATH="$GO_BIN:$PATH"
./scripts/build-caddy.sh /usr/local/bin/caddy
setcap cap_net_bind_service=+ep /usr/local/bin/caddy
CADDY_BIN=/usr/local/bin/caddy npm run test:proxy

# No default credentials. Keep bootstrap secrets out of the world-readable unit.
ADMIN_USER=${ADMIN_USER:-}
ADMIN_PASS=${ADMIN_PASS:-}
if [ -z "$ADMIN_USER" ]; then read -r -p "Initial admin username: " ADMIN_USER; fi
if [ -z "$ADMIN_PASS" ]; then read -r -s -p "Initial admin password: " ADMIN_PASS; echo; fi
if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
  echo "Both credentials are required." >&2
  exit 1
fi
export ADMIN_USER ADMIN_PASS
umask 077
node - <<'NODE'
const fs = require('fs');
if ([process.env.ADMIN_USER, process.env.ADMIN_PASS].some(value => /[\r\n]/.test(value))) throw new Error('Credentials cannot contain newlines');
const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '') + '"';
fs.writeFileSync('/etc/localcaddyhub.env', `ADMIN_USER=${quote(process.env.ADMIN_USER)}\nADMIN_PASS=${quote(process.env.ADMIN_PASS)}\n`, {mode: 0o600});
NODE
mkdir -p /var/lib/localcaddyhub/caddy-data /var/lib/localcaddyhub/caddy-config
cat > /etc/systemd/system/localcaddyhub.service <<EOF
[Unit]
Description=LocalCaddyHub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/src/index.js
Environment=NODE_ENV=production
Environment=CADDY_BIN=/usr/local/bin/caddy
Environment=XDG_DATA_HOME=/var/lib/localcaddyhub/caddy-data
Environment=XDG_CONFIG_HOME=/var/lib/localcaddyhub/caddy-config
EnvironmentFile=/etc/localcaddyhub.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now localcaddyhub
echo "Open http://127.0.0.1:8090 through a protected management connection and complete account setup."
