# The capacity instance's place on the production box, read by the scripts in
# this folder. nginx.conf repeats the two ports, since nginx cannot read this file.

CAPACITY_HOST=root@sadiss.net
CAPACITY_APP=sadiss-capacity
CAPACITY_DIR=/opt/sadiss-capacity
# Uploaded track files and the chunks the server cuts from them, on the data
# volume like the live instance's.
CAPACITY_DATA=/mnt/HC_Volume_33896583/capacity
CAPACITY_HTTP_PORT=3006
CAPACITY_WS_PORT=40001
CAPACITY_DB=sadiss_capacity
CAPACITY_DB_USER=capacity
# The database password, the server's session and JWT secrets and the load
# test's admin account, generated on the box once and kept there, mode 600.
CAPACITY_SECRETS=/root/.sadiss-capacity
CAPACITY_NGINX_CONF=/etc/nginx/forge-conf/sadiss.org/server/capacity.conf
CAPACITY_URL=https://sadiss.net/capacity

capacity_vars() {
  declare -p CAPACITY_APP CAPACITY_DIR CAPACITY_DATA CAPACITY_HTTP_PORT CAPACITY_WS_PORT \
    CAPACITY_DB CAPACITY_DB_USER CAPACITY_SECRETS CAPACITY_NGINX_CONF CAPACITY_URL
}

# Runs a function of the calling script on the box, with these settings and
# any arguments given after the function's name.
run_on_box() {
  local fn=$1
  shift
  ssh -o BatchMode=yes "$CAPACITY_HOST" 'bash -s' < <(
    echo 'set -euo pipefail'
    capacity_vars
    declare -f "$fn"
    printf '%q ' "$fn" "$@"
    echo
  )
}
