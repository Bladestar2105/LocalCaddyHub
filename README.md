# Caddy Manager with NTLM Support

This is a simple web interface to manage a Caddy server instance with NTLM authentication support.

## Prerequisites

*   Go (1.20 or later)
*   `xcaddy` (for building the custom Caddy binary)
*   Docker (optional, for containerized deployment)

## Building Caddy with NTLM Support

To use the NTLM transport in your `Caddyfile`, you need a custom Caddy build that includes the `github.com/caddyserver/ntlm-transport` module.

1.  **Install xcaddy:**

    ```bash
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
    ```

2.  **Build Caddy:**

    Run the following command in the project root (or anywhere you want the binary to be):

    ```bash
    xcaddy build --with github.com/caddyserver/ntlm-transport
    ```

    This will produce a `caddy` binary in your current directory.

## Running the Manager Locally

1.  **Build the Manager:**

    ```bash
    go build -o server main.go
    ```

2.  **Run:**

    Ensure the `caddy` binary you built in the previous step is in the same directory as the `server` binary or in your system PATH.

    ```bash
    ./server
    ```

3.  **Access:**

    Open your browser and navigate to `http://localhost:8090`.

## Docker Deployment

A `Dockerfile` is provided to build a container image with the custom Caddy binary and the manager application.

### Using Docker Compose (Compatible with Portainer)

1.  **Prepare Environment (Required):**
    Before running the container, create the necessary files and directories on your host to persist your configuration and certificates. If you don't create the files beforehand, Docker might create directories instead of files.

    ```bash
    touch config.json Caddyfile
    mkdir certs
    ```

2.  Create `docker-compose.yml`:

    ```yaml
    services:
      caddy-manager:
        image: caddy-manager:latest
        container_name: caddy-manager
        restart: unless-stopped
        ports:
          - "8090:8090"
          - "80:80"
          - "443:443"
        volumes:
          - ./config.json:/app/config.json
          - ./Caddyfile:/app/Caddyfile
          - ./certs:/app/certs
    ```

3.  Run `docker-compose up -d`.

4.  Access at `http://localhost:8090`.

### Using Pre-built Image from GitHub Actions

1.  **Download the Artifact:**
    Go to the "Actions" tab in your GitHub repository, click on the latest successful build, and download the Docker image artifact (usually a `.tar` file).

2.  **Load the Image:**

    ```bash
    docker load -i <path_to_downloaded_tar_file>
    ```

3.  **Prepare Environment (Required):**
    Before running the container, create the necessary files and directories on your host to persist your configuration and certificates. If you don't create the files beforehand, Docker might create directories instead of files.

    ```bash
    touch config.json Caddyfile
    mkdir certs
    ```

4.  **Run the Container:**
    Run the container, mapping the necessary ports and volumes.

    ```bash
    docker run -d \
      --name caddy-manager \
      -p 8090:8090 \
      -p 80:80 \
      -p 443:443 \
      -v $(pwd)/config.json:/app/config.json \
      -v $(pwd)/Caddyfile:/app/Caddyfile \
      -v $(pwd)/certs:/app/certs \
      caddy-manager:latest
    ```

### Building the Image Locally

1.  **Build the Image:**

    ```bash
    docker build -t caddy-manager .
    ```

2.  **Prepare Environment (Required):**
    Before running the container, create the necessary files and directories on your host to persist your configuration and certificates. If you don't create the files beforehand, Docker might create directories instead of files.

    ```bash
    touch config.json Caddyfile
    mkdir certs
    ```

3.  **Run the Container:**
    Run the container, mapping the necessary ports and volumes.

    ```bash
    docker run -d \
      --name caddy-manager \
      -p 8090:8090 \
      -p 80:80 \
      -p 443:443 \
      -v $(pwd)/config.json:/app/config.json \
      -v $(pwd)/Caddyfile:/app/Caddyfile \
      -v $(pwd)/certs:/app/certs \
      caddy-manager:latest
    ```

## Configuration

The web interface allows you to edit the `Caddyfile`. An example configuration using NTLM:

```caddy
:8080 {
    reverse_proxy localhost:9090 {
        transport http_ntlm
    }
}
```

## Features

*   **Edit Configuration**: Modify and save your `Caddyfile`.
*   **Validate**: Check the configuration syntax using `caddy validate`.
*   **Control**: Start, Stop, and Reload the Caddy process.
*   **Stats**: View runtime metrics from Caddy.
