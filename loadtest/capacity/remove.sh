#!/usr/bin/env bash
# Removes the capacity instance from the production box: its nginx routes
# (then reloads nginx and runs the live smoke test), its PM2 app, its MongoDB
# user and database, its folders, its data and its secrets. Touches nothing of
# the live instance. Asks before it starts.
#
# Run: loadtest/capacity/remove.sh
set -euo pipefail
. "$(dirname "$0")/config.sh"

remove() {
  if [ -f "$CAPACITY_NGINX_CONF" ]; then
    rm "$CAPACITY_NGINX_CONF"
    nginx -t
    systemctl reload nginx
    /opt/smoke.sh
  fi
  if pm2 describe "$CAPACITY_APP" >/dev/null 2>&1; then
    pm2 delete "$CAPACITY_APP" >/dev/null
    pm2 save >/dev/null
  fi
  mongosh_admin "$CAPACITY_DB" --eval "
    if (db.getUser('$CAPACITY_DB_USER')) db.dropUser('$CAPACITY_DB_USER')
    db.dropDatabase()"
  rm -rf "$CAPACITY_DIR" "$CAPACITY_DATA" "$CAPACITY_SECRETS" "$CAPACITY_NGINX_STAGED"
  echo "Removed $CAPACITY_APP."
}

read -r -p "Remove $CAPACITY_APP, database $CAPACITY_DB and everything in $CAPACITY_DATA from $CAPACITY_HOST? [y/N] " answer
[ "$answer" = y ] || exit 1
run_on_box remove
