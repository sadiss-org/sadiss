# Prints one line every few seconds about the process that listens on a TCP
# port and the box it runs on, until the time is up or its output is closed:
#
#   sample <box time in ns> <pid> <CPU ticks> <resident kB> <open sockets> <load over 1 min> <available kB> <ticks per second>
#
# While nothing listens on the port, the four process fields are "-".
# Read from standard input, with the port, the seconds between samples and the
# seconds to sample for at most as arguments: sh -s -- 3006 5 600

port=$1
every=$2
until=$(($(date +%s) + $3))
tck=$(getconf CLK_TCK)

while [ "$(date +%s)" -lt "$until" ]; do
  pid=$(ss -Hltnp "sport = :$port" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n 1)
  ticks=-
  rss=-
  sockets=-
  if [ -n "$pid" ] && [ -r "/proc/$pid/stat" ]; then
    # The process name in stat may hold spaces, so the fields are counted after it:
    # utime and stime are the 14th and 15th fields, the 12th and 13th after the name.
    ticks=$(sed 's/^.*) //' "/proc/$pid/stat" | awk '{ print $12 + $13 }')
    rss=$(awk '/^VmRSS:/ { print $2 }' "/proc/$pid/status")
    sockets=$(ls -l "/proc/$pid/fd" 2>/dev/null | grep -c 'socket:')
  else
    pid=-
  fi
  load=$(cut -d ' ' -f 1 /proc/loadavg)
  available=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
  echo "sample $(date +%s%N) $pid $ticks $rss $sockets $load $available $tck" || exit 0
  sleep "$every"
done
