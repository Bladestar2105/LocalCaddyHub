# LocalCaddyHub

LocalCaddyHub manages one custom Caddy reverse proxy through an Express web interface and a local SQLite database. It supports HTTP upstream pools, NTLM transport, Layer 4 proxying, SMTP STARTTLS handlers, Coraza WAF, access lists and certificate management.

## Runtime and verification

Use Node **24.22.3** (see `.nvmrc`) and npm. Native `better-sqlite3` must be installed using the same Node major that runs the application; after switching Node versions, run `npm ci` again. Node 24 is a [supported LTS release](https://nodejs.org/en/about/previous-releases).

```sh
npm ci
npm test
npm audit --omit=dev
```

`npm test` includes real SQLite/HTTP bootstrap, setup and restart tests in isolated temporary directories. `npm run dev` uses Node's built-in watch mode. The separate `npm run test:proxy` gate requires the real custom Caddy binary (no skip/fallback). It checks WAF block/pass behavior, TLS trust/name failures, per-service health and failover, and NTLM backend/socket affinity using synthetic Exchange-like traffic. CI runs this gate inside the built image. Browser checks use the development-only Playwright package; install a browser with `npx playwright install chromium`.

For a native custom Caddy build, install **Go 1.26.9 or newer** and run:

```sh
go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
export PATH="$(go env GOPATH)/bin:$PATH"
./scripts/build-caddy.sh ./caddy
./caddy version
export CADDY_BIN="$PWD/caddy"
npm run test:proxy
(cd src/modules/caddystarttls && go test -mod=readonly -race ./... && go vet -mod=readonly ./...)
```

The shared build script pins Caddy 2.11.9, the local NTLM transport, caddy-l4 0.1.3 and Coraza-Caddy 2.6.2, and includes this repository's SMTP modules. The NTLM transport is derived from Apache-2.0-licensed caddyserver/ntlm-transport v0.1.2, with local fixes for authenticated connection cleanup, reload safety and client connection isolation. Docker and the native installer use the same script. Set `CADDY_BIN` to an absolute path when the binary is outside PATH.

## First run

There is **no default login**. With an empty database, both `ADMIN_USER` and `ADMIN_PASS` must be explicitly set. For example, set `ADMIN_USER=bootstrap-admin` and supply `ADMIN_PASS` through your service environment or secret manager before running:

```sh
npm start
```

Open [http://localhost:8090](http://localhost:8090), sign in using those bootstrap credentials, then complete account setup. The saved database account replaces the bootstrap credentials on subsequent logins. Preserve the database to preserve that account and any TOTP configuration. Management port 8090 should be reachable only through a trusted management network, SSH tunnel, or authenticated HTTPS gateway; the default listener is plain HTTP.

## Docker

Use the provided [compose.yaml](compose.yaml). Set `ADMIN_USER` and `ADMIN_PASS` in your environment or a protected `.env` file, then run:

```sh
docker compose up -d
```

To build the current checkout instead of using a published image:

```sh
docker build -t localcaddyhub:local .
docker run -d --name localcaddyhub \
  -e ADMIN_USER -e ADMIN_PASS \
  -p 127.0.0.1:8090:8090 -p 80:80 -p 443:443 -p 443:443/udp \
  -v "$PWD/data:/app/data" \
  -v localcaddyhub_caddy_data:/data \
  -v localcaddyhub_caddy_config:/config \
  localcaddyhub:local
```

Persist **all three** locations:

| Location | Contents |
| --- | --- |
| `/app/data` | SQLite database, generated Caddyfile, app configuration, uploaded certificates, logs |
| `/data` | Caddy ACME accounts, certificates, private keys and local CA storage |
| `/config` | Caddy autosaved configuration |

Back up the database and its WAL consistently by stopping the container before taking a filesystem backup (or use SQLite's online backup API). Back up all three volumes and protect their private keys. Do not use `docker compose down -v` when retaining certificates/accounts. Restore matching app configuration and certificate storage together.

The image exposes 80/TCP, 443/TCP and 443/UDP. Publish additional ports explicitly for configured Layer 4/SMTP listeners. Caddy's admin API on 2019 stays internal; never expose it publicly.

## Native Linux service

On Ubuntu 24.04 or Debian 12+, run the installer from a reviewed checkout:

```sh
sudo ./setup.sh
```

It installs Node 24, a checksum-verified private Go 1.27.4 toolchain under `/opt/localcaddyhub-tools`, locked npm dependencies and the custom Caddy binary. It prompts for bootstrap credentials without a default password, stores them in root-readable `/etc/localcaddyhub.env`, and creates a systemd service. Existing installations must use the updater; setup refuses to replace an existing service.

Native service persistence is `/opt/localcaddyhub/data`, `/var/lib/localcaddyhub/caddy-data` and `/var/lib/localcaddyhub/caddy-config`. Preserve all of them plus `/etc/localcaddyhub.env`. Older installations with `caddyhub.db` in the application root retain their legacy paths unless `LCH_DATA_DIR` explicitly selects a data directory. Move legacy state deliberately before enabling a new data directory.

For updates, keep the checkout clean and tracking its upstream branch:

```sh
sudo ./update.sh
```

The updater reads the running service environment (or delegates EnvironmentFiles to systemd when stopped), so service-only data directories and management ports are honored. It aborts before downtime if these settings cannot be resolved safely or if the running and configured service use different state paths/ports. The updater fetches a fast-forward revision, installs dependencies, builds Caddy and runs the real SQLite/HTTP and proxy/WAF runtime checks in a temporary staging directory while the existing service continues running. It then stops the service, resolves the service environment and saves a private rollback backup of the old runtime, actual app state and Caddy storage, activates the new revision and checks both management HTTP and the Caddy admin API startup. Failed activation restores the old revision, dependencies, Caddy binary and saved application state and restarts a previously active service. If a failed service cannot be stopped or its backup cannot be restored, the updater reports the retained backup and avoids restarting against uncertain state. Backups remain next to the install directory; remove old backups only after verifying recovery. Keep an independent backup of certificate storage. Updates have a short service interruption and are not a substitute for a tested full-host restore. Existing service units retain their configured environment; upgrade old Node runtimes before updating.

## Exchange and redundant proxies

For a KEMP replacement in front of Exchange mailbox servers, read the [Exchange deployment guide](docs/exchange.md) before configuring upstreams. It covers virtual-directory health checks, NTLM, HTTPS bridging and Extended Protection prerequisites.

A single LocalCaddyHub instance is one proxy/control-plane node. A redundant pair needs an external VIP/failover mechanism or a load balancer that checks both proxies. Give each node **independent local SQLite and Caddy storage**. Apply and validate equivalent configuration and secrets on each node, keep certificates synchronized using a controlled deployment process, and test both nodes directly before changing the VIP. Exchange's DAG replicates mailbox databases; it does not replicate LocalCaddyHub configuration or elect a proxy leader. Do not put SQLite on shared network storage or mount one live database into multiple nodes.

Independent ACME clients may coordinate poorly with HTTP challenges through a VIP. Choose one certificate issuance/distribution owner, or deliberately configure shared Caddy certificate storage using a supported external storage module and appropriate distributed locking (not included in the default build). For Exchange Extended Protection with HTTPS bridging, the front-end and Exchange IIS certificate must match; independent automatic certificate issuance on each proxy does not satisfy this requirement.

## Configuration and troubleshooting

- `PORT`: management listener, default `8090`.
- `LCH_DATA_DIR`: explicit app state directory; overrides legacy detection.
- `CADDY_BIN`: custom Caddy executable path.
- `CADDY_AUTOSTART=0`: disable Caddy startup for isolated checks or an externally managed Caddy process.
- `XDG_DATA_HOME` / `XDG_CONFIG_HOME`: Caddy's persistent data/config roots.

Saving configuration requires a working custom Caddy binary; invalid changes preserve the previous database and Caddyfile. State directories and private files are restricted to the application account; run the application and its Caddy process as the same OS user (including externally managed Caddy). Changes saved in the UI generate/validate configuration; apply/reload it through the process controls. Coraza WAF rules require application-specific acceptance testing, especially for Exchange request bodies and long-lived connections. A healthy HTTP process or a successful generic proxy smoke test does not demonstrate Outlook, Extended Protection or DAG failover compatibility.
