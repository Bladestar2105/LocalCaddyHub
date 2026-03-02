#!/bin/bash

set -e

echo "======================================================"
echo " LocalCaddyHub Setup for Ubuntu 24.04 / Debian 12+"
echo "======================================================"

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script as root (e.g., sudo ./setup.sh)"
  exit 1
fi

# 1. Install Dependencies
echo "--> Installing dependencies (Go, Node.js, git, libcap2-bin)..."
apt update
apt install -y golang git libcap2-bin curl

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 2. Build Custom Caddy
echo "--> Building custom Caddy binary..."
# Run as the original user to build in their home directory if possible, or build as root
SUDO_USER_HOME=$(eval echo ~${SUDO_USER:-root})

sudo -u ${SUDO_USER:-root} -H bash -c '
  export PATH=$PATH:/usr/local/go/bin:$(go env GOPATH)/bin
  go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  $(go env GOPATH)/bin/xcaddy build \
    --with github.com/caddyserver/ntlm-transport \
    --with github.com/mholt/caddy-l4
'

echo "--> Moving Caddy to /usr/local/bin and setting capabilities..."
mv caddy /usr/local/bin/
setcap cap_net_bind_service=+ep /usr/local/bin/caddy

# 3. Setup LocalCaddyHub
INSTALL_DIR="/opt/localcaddyhub"
echo "--> Setting up LocalCaddyHub in $INSTALL_DIR..."

if [ ! -d "$INSTALL_DIR" ]; then
  git clone https://github.com/bladestar2105/localcaddyhub.git "$INSTALL_DIR"
else
  echo "--> Directory $INSTALL_DIR already exists, updating..."
  cd "$INSTALL_DIR"
  git pull
fi

cd "$INSTALL_DIR"
echo "--> Installing npm dependencies..."
npm install

# 4. Create Systemd Service
SERVICE_FILE="/etc/systemd/system/localcaddyhub.service"
echo "--> Creating systemd service at $SERVICE_FILE..."

# Prompt for credentials if not set
read -p "Enter ADMIN_USER [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}

read -p "Enter ADMIN_PASS [admin]: " ADMIN_PASS
ADMIN_PASS=${ADMIN_PASS:-admin}

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=LocalCaddyHub Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/npm start
Environment=NODE_ENV=production
Environment=ADMIN_USER=$ADMIN_USER
Environment=ADMIN_PASS=$ADMIN_PASS
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 5. Enable and Start the Service
echo "--> Enabling and starting LocalCaddyHub service..."
systemctl daemon-reload
systemctl enable localcaddyhub
systemctl start localcaddyhub

echo "======================================================"
echo " Setup Complete!"
echo " LocalCaddyHub should now be accessible at http://<your-server-ip>:8090"
echo "======================================================"
