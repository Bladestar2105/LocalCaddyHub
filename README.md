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

1.  **Prepare Environment (Required):**
    Before running the container, create the necessary files and directories on your host to persist your configuration, database, and certificates. If you don't create the files beforehand, Docker might create directories instead of files.

    ```bash
    touch config.json Caddyfile caddyhub.db
    mkdir certs
    ```

2.  Create `docker-compose.yml`:

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
          - ./config.json:/app/config.json
          - ./Caddyfile:/app/Caddyfile
          - ./caddyhub.db:/app/caddyhub.db
          - ./certs:/app/certs
    ```

3.  Run `docker-compose up -d`.

4.  Access at `http://localhost:8090` (Login: `admin` / `admin`).

### Using Pre-built Image from GitHub Actions or Building Locally

If using `docker run` directly:

1.  **Prepare Environment (Required):**

    ```bash
    touch config.json Caddyfile caddyhub.db
    mkdir certs
    ```

2.  **Run the Container:**

    ```bash
    docker run -d \
      --name localcaddyhub \
      -p 8090:8090 \
      -p 80:80 \
      -p 443:443 \
      -v $(pwd)/config.json:/app/config.json \
      -v $(pwd)/Caddyfile:/app/Caddyfile \
      -v $(pwd)/caddyhub.db:/app/caddyhub.db \
      -v $(pwd)/certs:/app/certs \
      ghcr.io/bladestar2105/localcaddyhub:latest
    ```
    *(Replace the image tag with `localcaddyhub` if you built the image locally via `docker build -t localcaddyhub .`)*

## Features

*   **Relational UI**: Manage your Caddy reverse proxies using an intuitive web interface instead of writing a Caddyfile by hand. It supports Domains, Subdomains, Handlers, Headers, Access Lists, Layer 4 proxying, and Basic Auth.
*   **Database Storage**: Configurations are persistently stored in a local SQLite database (`caddyhub.db`).
*   **Dynamic Caddyfile Generation**: LocalCaddyHub automatically generates your `Caddyfile` based on the configuration in the database.
*   **Custom SSL Certificates**: Securely upload and manage your own custom certificates instead of relying solely on ACME/SSL automation.
*   **Control & Validate**: Validate your configuration syntax, and Start, Stop, or Reload the Caddy process directly from the UI.
*   **Stats**: View runtime metrics from Caddy's admin API.
