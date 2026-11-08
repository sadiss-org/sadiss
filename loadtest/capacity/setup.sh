#!/usr/bin/env bash
# Prepares the capacity instance on the production box: its folders, its
# secrets, its MongoDB user and its .env. Touches nothing of the live
# instance. Safe to run again: secrets and the database user are kept, the
# .env is written anew from config.sh and the secrets.
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

  mkdir -p "$CAPACITY_DIR/server" "$CAPACITY_DATA/chunks" "$CAPACITY_DATA/uploads"

  if [ ! -f "$CAPACITY_SECRETS" ]; then
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

  local admin_user admin_pw
  admin_user=$(sed -n 's/^admin user: *//p' /root/.mongo-admin)
  admin_pw=$(sed -n 's/^password: *//p' /root/.mongo-admin)
  CAPACITY_MONGO_PW=$MONGO_PW mongosh --quiet -u "$admin_user" -p "$admin_pw" --authenticationDatabase admin "$CAPACITY_DB" --eval "
    if (db.getUser('$CAPACITY_DB_USER')) {
      print('MongoDB user $CAPACITY_DB_USER exists already; left unchanged.')
    } else {
      db.createUser({ user: '$CAPACITY_DB_USER', pwd: process.env.CAPACITY_MONGO_PW, roles: [{ role: 'readWrite', db: '$CAPACITY_DB' }] })
      print('Created MongoDB user $CAPACITY_DB_USER for $CAPACITY_DB.')
    }"

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
UPLOADS_DIR='$CAPACITY_DATA/uploads'
CHUNKS_DIR='$CAPACITY_DATA/chunks'
ENV
  )
  echo "Wrote $CAPACITY_DIR/server/.env."
}

run_on_box setup
echo "Next: loadtest/capacity/deploy.sh <commit>"
