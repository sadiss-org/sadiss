#!/usr/bin/env bash
# Prepares the capacity instance on the production box: its folders, its
# secrets, its MongoDB user and its .env. Touches nothing of the live
# instance. Safe to run again: secrets and the database user are kept, the
# .env is written anew from config.sh and the secrets. Stops if the database
# user exists but its secrets file is gone, since new secrets would not match
# the user's password.
#
# Run from anywhere: loadtest/capacity/setup.sh
set -euo pipefail
. "$(dirname "$0")/config.sh"

setup() {
  if ! pm2 describe "$CAPACITY_APP" >/dev/null 2>&1 &&
    ss -ltnH | awk '{print $4}' | grep -qE ":($CAPACITY_HTTP_PORT|$CAPACITY_WS_PORT)\$"; then
    echo "Port $CAPACITY_HTTP_PORT or $CAPACITY_WS_PORT is taken by something other than $CAPACITY_APP." >&2
    exit 1
  fi

  local user_exists
  user_exists=$(mongosh_admin "$CAPACITY_DB" --eval "print(db.getUser('$CAPACITY_DB_USER') ? 'yes' : 'no')")

  if [ ! -f "$CAPACITY_SECRETS" ]; then
    if [ "$user_exists" = yes ]; then
      echo "MongoDB user $CAPACITY_DB_USER exists but $CAPACITY_SECRETS is gone, so new secrets would not match its password." >&2
      echo "Restore the file, or remove the instance with loadtest/capacity/remove.sh and set it up again." >&2
      exit 1
    fi
    (
      umask 077
      {
        echo "MONGO_PW=$(openssl rand -hex 24)"
        echo "SESSION_SECRET=$(openssl rand -hex 32)"
        echo "JWT_SECRET=$(openssl rand -hex 32)"
        echo "ADMIN_EMAIL=loadtest@sadiss.net"
        echo "ADMIN_PASSWORD=$(openssl rand -hex 16)"
      } >"$CAPACITY_SECRETS"
    )
    echo "Generated secrets in $CAPACITY_SECRETS."
  fi
  . "$CAPACITY_SECRETS"

  if [ "$user_exists" = yes ]; then
    echo "MongoDB user $CAPACITY_DB_USER exists already; left unchanged."
  else
    CAPACITY_MONGO_PW=$MONGO_PW mongosh_admin "$CAPACITY_DB" --eval "
      db.createUser({ user: '$CAPACITY_DB_USER', pwd: process.env.CAPACITY_MONGO_PW, roles: [{ role: 'readWrite', db: '$CAPACITY_DB' }] })"
    echo "Created MongoDB user $CAPACITY_DB_USER for $CAPACITY_DB."
  fi

  # The server joins UPLOADS_DIR onto its own folder in places, so the data
  # folders are reached through links there, as on the live instance.
  # public is where the server builds track zips for download and unpacks
  # uploaded ones; it is not in git, so the live instance's was made by hand.
  mkdir -p "$CAPACITY_DIR/server/public" "$CAPACITY_DATA/chunks" "$CAPACITY_DATA/uploads"
  local dir link
  for dir in uploads chunks; do
    link=$CAPACITY_DIR/server/$dir
    if [ -e "$link" ] && [ ! -L "$link" ]; then
      echo "$link is a real folder, not a link to $CAPACITY_DATA/$dir; move its contents there and remove it." >&2
      exit 1
    fi
    ln -sfn "$CAPACITY_DATA/$dir" "$link"
  done

  (
    umask 077
    cat >"$CAPACITY_DIR/server/.env" <<ENV
NODE_ENV='production'
API_BASE_URL='http://localhost:$CAPACITY_HTTP_PORT'
BASE_PORT='$CAPACITY_HTTP_PORT'
MONGO_HOST='127.0.0.1:27017'
MONGO_USER='$CAPACITY_DB_USER'
MONGO_PW='$MONGO_PW'
MONGO_DB_NAME='$CAPACITY_DB'
WS_SERVER_URL='localhost'
WS_SERVER_PORT='$CAPACITY_WS_PORT'
SESSION_SECRET='$SESSION_SECRET'
JWT_SECRET='$JWT_SECRET'
UPLOADS_DIR='uploads'
CHUNKS_DIR='chunks'
ENV
  )
  echo "Wrote $CAPACITY_DIR/server/.env."
}

run_on_box setup
echo "Next: loadtest/capacity/deploy.sh <commit>"
