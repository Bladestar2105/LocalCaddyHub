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

1.  **Build the Image:**

    ```bash
    docker build -t caddy-manager .
    ```

2.  **Run the Container:**

    ```bash
    docker run -p 8090:8090 -p 8080:8080 caddy-manager
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
