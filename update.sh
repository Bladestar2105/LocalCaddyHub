#!/bin/bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./update.sh" >&2
  exit 1
fi
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${LCH_INSTALL_DIR:-/opt/localcaddyhub}
CADDY_BIN=${LCH_CADDY_BIN:-/usr/local/bin/caddy}
export PATH="/opt/localcaddyhub-tools/go1.27.4/go/bin:$PATH"
cd "$INSTALL_DIR"
# Refuse to overwrite local source edits; ignored runtime data stays in place.
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Commit or stash local source changes before updating." >&2
  exit 1
fi
OLD_HEAD=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')
git fetch
TARGET=$(git rev-parse "$UPSTREAM")
git merge-base --is-ancestor "$OLD_HEAD" "$TARGET"
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT
STATE_HELPER="$BUILD_DIR/update-state.cjs"
cp "$SCRIPT_DIR/scripts/update-state.cjs" "$STATE_HELPER"
STATE_FILE="$BUILD_DIR/runtime-state.json"
# Install and build before interrupting the running service.
git archive "$TARGET" | tar -x -C "$BUILD_DIR"
(
  cd "$BUILD_DIR"
  npm ci
  go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
  GO_BIN="$(go env GOPATH)/bin"
  export PATH="$GO_BIN:$PATH"
  ./scripts/build-caddy.sh "$BUILD_DIR/caddy"
  CADDY_BIN="$BUILD_DIR/caddy" npm run test:runtime
  CADDY_BIN="$BUILD_DIR/caddy" npm run test:proxy
)
node "$STATE_HELPER" resolve "$STATE_FILE" "$INSTALL_DIR" "$BUILD_DIR/caddy" "$CADDY_BIN"
CADDY_BIN=$(node "$STATE_HELPER" get "$STATE_FILE" binary)
LIVE_PORT=$(node "$STATE_HELPER" get "$STATE_FILE" port)
# Adapt with the actual service environment without provisioning storage.
node "$STATE_HELPER" adapt "$STATE_FILE" "$BUILD_DIR/caddy"
BACKUP_DIR=$(mktemp -d "${INSTALL_DIR}.backup.XXXXXXXX")
chmod 700 "$BACKUP_DIR"
printf '%s\n' "$OLD_HEAD" > "$BACKUP_DIR/revision"
cp -p "$CADDY_BIN" "$BACKUP_DIR/caddy"
cp "$STATE_FILE" "$BACKUP_DIR/runtime-state.json"
WAS_ACTIVE=0
systemctl is-active --quiet localcaddyhub && WAS_ACTIVE=1
STOPPED=0
APPLIED=0
rollback() {
  local status=$?
  trap - ERR INT TERM
  if [ "$STOPPED" -eq 1 ]; then
    echo "Update failed; restoring previous revision. Backup: $BACKUP_DIR" >&2
    if ! systemctl stop localcaddyhub; then
      echo "Cannot stop the failed service; rollback state was not overwritten. Backup: $BACKUP_DIR" >&2
      exit "$status"
    fi
    if [ "$APPLIED" -eq 1 ]; then
      local recovered=1
      git reset --hard "$OLD_HEAD" || recovered=0
      rm -rf node_modules
      mv "$BACKUP_DIR/node_modules" node_modules || recovered=0
      cp -p "$BACKUP_DIR/caddy" "$CADDY_BIN" || recovered=0
      setcap cap_net_bind_service=+ep "$CADDY_BIN" || recovered=0
      node "$STATE_HELPER" restore "$STATE_FILE" "$BACKUP_DIR" || recovered=0
      if [ "$recovered" -eq 0 ]; then
        echo "Rollback incomplete; service left stopped. Restore the retained backup at $BACKUP_DIR before restarting." >&2
        exit "$status"
      fi
    fi
    if [ "$WAS_ACTIVE" -eq 1 ]; then systemctl start localcaddyhub || true; fi
  fi
  exit "$status"
}
trap rollback ERR
trap 'false' INT TERM
systemctl stop localcaddyhub
STOPPED=1
# Snapshot the resolved app files and Caddy storage only after all writers stop.
node "$STATE_HELPER" snapshot "$STATE_FILE" "$BACKUP_DIR"
mv node_modules "$BACKUP_DIR/node_modules"
APPLIED=1
git merge --ff-only "$TARGET"
mv "$BUILD_DIR/node_modules" node_modules
install -m 755 "$BUILD_DIR/caddy" "$CADDY_BIN"
setcap cap_net_bind_service=+ep "$CADDY_BIN"
if [ "$WAS_ACTIVE" -eq 1 ]; then
  systemctl start localcaddyhub
  for _ in $(seq 1 30); do
    if systemctl is-active --quiet localcaddyhub && curl -fsS "http://127.0.0.1:${LIVE_PORT}/login.html" >/dev/null && \
       curl -fsS -H "Origin: http://localhost:2019" http://127.0.0.1:2019/config/ >/dev/null; then
      trap - ERR INT TERM
      echo "Update complete. Backup retained at $BACKUP_DIR"
      exit 0
    fi
    sleep 1
  done
  echo "Updated service failed its startup check." >&2
  false
fi
trap - ERR INT TERM
echo "Update complete; previously inactive service remains stopped. Backup: $BACKUP_DIR"
