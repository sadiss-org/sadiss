#!/usr/bin/env bash
# Builds the server at a given commit on this machine and runs it as the
# capacity instance on the production box. Touches nothing of the live
# instance. The box installs the commit's production dependencies itself, so
# they are built for the box's Node, which the live instance also runs on.
#
# Run: loadtest/capacity/deploy.sh <commit>   (setup.sh first, once)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/config.sh"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <commit>" >&2
  exit 2
fi
sha=$(git -C "$here" rev-parse --verify "$1^{commit}")

work=$(mktemp -d)
cleanup() { git -C "$here" worktree remove --force "$work"; }
git -C "$here" worktree add --detach --quiet "$work" "$sha"
trap cleanup EXIT

echo "Building the server at $sha."
(
  cd "$work/server"
  # The in-memory MongoDB is for tests only; skip downloading its binary.
  MONGOMS_DISABLE_POSTINSTALL=1 npm ci --legacy-peer-deps --no-audit --no-fund --loglevel=error
  npx tsc
)

rsync -az --delete "$work/server/dist/" "$CAPACITY_HOST:$CAPACITY_DIR/server/dist/"
rsync -az "$work/server/package.json" "$work/server/package-lock.json" "$CAPACITY_HOST:$CAPACITY_DIR/server/"

start() {
  local sha=$1
  cd "$CAPACITY_DIR/server"
  if [ ! -f .env ]; then
    echo "No .env in $CAPACITY_DIR/server; run loadtest/capacity/setup.sh first." >&2
    exit 1
  fi
  MONGOMS_DISABLE_POSTINSTALL=1 npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --loglevel=error

  # Started the way PM2 starts the live instance: yarn start in the server folder.
  if pm2 describe "$CAPACITY_APP" >/dev/null 2>&1; then
    pm2 restart "$CAPACITY_APP" >/dev/null
  else
    pm2 start "yarn start" --name "$CAPACITY_APP" --cwd "$CAPACITY_DIR/server" >/dev/null
    pm2 save >/dev/null
  fi

  local status=''
  for _ in $(seq 30); do
    status=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$CAPACITY_HTTP_PORT/api/tracks" || true)
    [ "$status" = 200 ] && break
    sleep 1
  done
  if [ "$status" != 200 ]; then
    echo "$CAPACITY_APP does not answer on port $CAPACITY_HTTP_PORT (last HTTP status: ${status:-none}). See pm2 logs $CAPACITY_APP --lines 50." >&2
    exit 1
  fi

  # An admin account for the load test; one that exists is left unchanged.
  (
    . "$CAPACITY_SECRETS"
    ADMIN_EMAIL=$ADMIN_EMAIL ADMIN_PASSWORD=$ADMIN_PASSWORD node dist/scripts/createAdmin.js
  )

  printf '%s\ndeployed %s\n' "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$CAPACITY_DIR/DEPLOYED.txt"
  echo "$CAPACITY_APP runs $sha."
}

run_on_box start "$sha"
