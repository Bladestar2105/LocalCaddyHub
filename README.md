# LocalCaddyHub with NTLM Support

This is a web interface to manage a Caddy server instance with NTLM authentication support and layer4 proxying.
It features a relational UI to manage Caddy configurations (Domains, Subdomains, Handlers, Access Lists, etc.), stores configuration in a SQLite database (`caddyhub.db`), and dynamically generates your `Caddyfile`.

## Prerequisites

*   Node.js (v22 or later recommended)
*   npm
*   Go (1.20 or later) and `xcaddy` (if building the custom Caddy binary manually)
*   Docker (optional, for containerized deployment)

## Building Caddy with NTLM and Layer4 Support

To use the NTLM transport and layer4 proxying in your `Caddyfile`, you need a custom Caddy build that includes the `github.com/caddyserver/ntlm-transport` and `github.com/mholt/caddy-l4` modules.

1.  **Install xcaddy:**

    ```bash
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
    ```

2.  **Build Caddy:**

    Run the following command anywhere you want the binary to be:

    ```bash
    xcaddy build \
      --with github.com/caddyserver/ntlm-transport \
      --with github.com/mholt/caddy-l4
    ```

    This will produce a `caddy` binary in your current directory. Make sure to place it in your system PATH or in the same directory where you run LocalCaddyHub.

## Running Locally

1.  **Install Dependencies:**

    ```bash
    npm install
    ```

2.  **Run:**

    Ensure the `caddy` binary you built in the previous step is in your system PATH.

    ```bash
    npm start
    ```

    For development with auto-restart, use `npm run dev`.

3.  **Access:**

    Open your browser and navigate to `http://localhost:8090`.

    **Default Login:**
    *   **Username:** `admin`
    *   **Password:** `admin`

    (You can override these by setting `ADMIN_USER` and `ADMIN_PASS` environment variables).

## Docker Deployment

A `Dockerfile` is provided to build a multi-stage container image that compiles the custom Caddy binary and runs the Node.js application.

### Using Docker Compose (Recommended)

1.  Create `docker-compose.yml`:

    ```yaml
    services:
      localcaddyhub:
        image: ghcr.io/bladestar2105/localcaddyhub:latest
        container_name: localcaddyhub
        restart: unless-stopped
        ports:
          - "8090:8090"
          - "80:80"
          - "443:443"
        volumes:
          - ./data:/app/data
    ```

2.  Run `docker-compose up -d`.

3.  Access at `http://localhost:8090` (Login: `admin` / `admin`).


### Using Pre-built Image from GitHub Actions or Building Locally

If using `docker run` directly:

1.  **Run the Container:**

    ```bash
    docker run -d \
      --name localcaddyhub \
      -p 8090:8090 \
      -p 80:80 \
      -p 443:443 \
      -v $(pwd)/data:/app/data \
      ghcr.io/bladestar2105/localcaddyhub:latest
    ```
    *(Replace the image tag with `localcaddyhub` if you built the image locally via `docker build -t localcaddyhub .`)*

## Native Setup on Ubuntu 24.04 / Debian 12+

For a native production-like deployment on a modern Linux system without Docker, follow these steps to install LocalCaddyHub and configure it to run as a system service.

### 1. Install Dependencies

Install Go (for building Caddy) and Node.js 22 (for running the backend):

```bash
# Install Go and build dependencies
sudo apt update
sudo apt install -y golang git libcap2-bin

# Install Node.js 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Build Custom Caddy

Build the custom Caddy binary with NTLM and Layer4 support, and move it to your system PATH:

```bash
# Install xcaddy
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

# Build the custom Caddy binary
~/go/bin/xcaddy build \
  --with github.com/caddyserver/ntlm-transport \
  --with github.com/mholt/caddy-l4

# Move to a system-wide location and grant privileges to bind to low ports (80/443)
sudo mv caddy /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/caddy
```

### 3. Setup LocalCaddyHub

Clone the repository and install the application dependencies:

```bash
# Clone the repository to /opt
sudo git clone https://github.com/bladestar2105/localcaddyhub.git /opt/localcaddyhub
cd /opt/localcaddyhub

# Install npm dependencies
sudo npm install
```

### 4. Create a Systemd Service

Create a new service file to manage LocalCaddyHub automatically:

```bash
sudo nano /etc/systemd/system/localcaddyhub.service
```

Add the following configuration, replacing `admin` and `admin` with your desired secure credentials:

```ini
[Unit]
Description=LocalCaddyHub Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/localcaddyhub
ExecStart=/usr/bin/npm start
Environment=NODE_ENV=production
Environment=ADMIN_USER=admin
Environment=ADMIN_PASS=admin
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 5. Enable and Start the Service

Reload the systemd daemon, enable the service to start on boot, and start it immediately:

```bash
sudo systemctl daemon-reload
sudo systemctl enable localcaddyhub
sudo systemctl start localcaddyhub
```

You can now access LocalCaddyHub at `http://<your-server-ip>:8090`.

## Features

*   **Relational UI**: Manage your Caddy reverse proxies using an intuitive web interface instead of writing a Caddyfile by hand. It supports Domains, Subdomains, Handlers, Headers, Access Lists, Layer 4 proxying, and Basic Auth.
*   **Database Storage**: Configurations are persistently stored in a local SQLite database (`caddyhub.db`).
*   **Dynamic Caddyfile Generation**: LocalCaddyHub automatically generates your `Caddyfile` based on the configuration in the database.
*   **Custom SSL Certificates**: Securely upload and manage your own custom certificates instead of relying solely on ACME/SSL automation.
*   **Control & Validate**: Validate your configuration syntax, and Start, Stop, or Reload the Caddy process directly from the UI.
*   **Stats**: View runtime metrics from Caddy's admin API.
