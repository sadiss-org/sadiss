# The capacity instance's place on the production box, read by the scripts in
# this folder. install-nginx.sh fills the two ports into nginx.conf.

CAPACITY_HOST=root@sadiss.net
CAPACITY_APP=sadiss-capacity
CAPACITY_DIR=/opt/sadiss-capacity
# Uploaded track files and the chunks the server cuts from them, on the data
# volume like the live instance's. The server reaches them through the links
# uploads and chunks in its folder.
CAPACITY_DATA=/mnt/HC_Volume_33896583/capacity
CAPACITY_HTTP_PORT=3006
CAPACITY_WS_PORT=40001
CAPACITY_DB=sadiss_capacity
CAPACITY_DB_USER=capacity
# The database password, the server's session and JWT secrets and the load
# test's admin account, generated on the box once and kept there, mode 600.
CAPACITY_SECRETS=/root/.sadiss-capacity
CAPACITY_NGINX_CONF=/etc/nginx/forge-conf/sadiss.org/server/capacity.conf
# Where install-nginx.sh puts nginx.conf before it is checked, outside every
# folder nginx includes.
CAPACITY_NGINX_STAGED=/root/sadiss-capacity-nginx.conf
CAPACITY_URL=https://sadiss.net/capacity

# mongosh as the box's MongoDB admin, whose login is kept in /root/.mongo-admin.
mongosh_admin() {
  local user pw
  user=$(sed -n 's/^admin user: *//p' /root/.mongo-admin)
  pw=$(sed -n 's/^password: *//p' /root/.mongo-admin)
  mongosh --quiet -u "$user" -p "$pw" --authenticationDatabase admin "$@"
}

# Runs a function of the calling script on the box, with these settings, the
# helpers above and any arguments given after the function's name.
run_on_box() {
  local fn=$1
  shift
  ssh -o BatchMode=yes "$CAPACITY_HOST" 'bash -s' < <(
    echo 'set -euo pipefail'
    declare -p "${!CAPACITY_@}"
    declare -f
    printf '%q ' "$fn" "$@"
    echo
  )
}
