#!/usr/bin/env bash
# Puts the capacity instance's routes into the production nginx and reloads it.
# A reload keeps open connections, including live phones' WebSockets. If the
# new config does not pass nginx -t, it is removed again and nginx is not
# reloaded; if the live smoke test fails after the reload, it is removed and
# nginx reloaded without it. Then the capacity instance's own routes are
# checked through nginx.
#
# Run: loadtest/capacity/install-nginx.sh   (after the first deploy.sh)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/config.sh"

scp -q "$here/nginx.conf" "$CAPACITY_HOST:$CAPACITY_NGINX_CONF"

install_routes() {
  if ! nginx -t 2>&1; then
    rm "$CAPACITY_NGINX_CONF"
    echo "nginx -t failed; removed $CAPACITY_NGINX_CONF and did not reload." >&2
    exit 1
  fi
  systemctl reload nginx
  sleep 1
  if ! /opt/smoke.sh; then
    rm "$CAPACITY_NGINX_CONF"
    systemctl reload nginx
    echo "The live smoke test failed; removed $CAPACITY_NGINX_CONF and reloaded nginx without it." >&2
    exit 1
  fi

  local fail=0 got
  got=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$CAPACITY_URL/server/api/tracks" || true)
  echo "$got $CAPACITY_URL/server/api/tracks (want 200)"
  [ "$got" = 200 ] || fail=1
  got=$(curl -s -o /dev/null -m 3 -w '%{http_code}' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$CAPACITY_URL/ws/" || true)
  echo "$got $CAPACITY_URL/ws/ (want 101)"
  [ "$got" = 101 ] || fail=1
  return $fail
}

run_on_box install_routes
