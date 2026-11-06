#!/usr/bin/env bash
# Boots the ERP dev server with a forced dependency re-optimisation (rolldown
# bundles every pre-bundled dependency), waits for it to go idle, and prints the
# footprint and rolldown's mimalloc region (macOS labels it IOAccelerator).
# Pass extra env assignments to compare allocator settings:
#   bash mimalloc-ab.sh                         # default
#   bash mimalloc-ab.sh MIMALLOC_PURGE_DELAY=0  # return freed pages at once
set -euo pipefail
cd "$(dirname "$0")/../../../apps/erp"
port=54692
env DOMAIN=localhost PORT=$port "$@" node ./node_modules/@react-router/dev/bin.js dev --port $port --host 127.0.0.1 --force > /dev/null 2>&1 &
pid=$!
start=$(date +%s)
trap 'kill $pid 2>/dev/null || true' EXIT
until curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/@vite/client"; do sleep 1; done
# The optimizer runs on the first request for a page's dependencies.
curl -s -o /dev/null --max-time 300 "http://127.0.0.1:$port/login"
curl -s -o /dev/null --max-time 300 "http://127.0.0.1:$port/@vite/client"
last=0; quiet=0
while [ $quiet -lt 5 ]; do
  sleep 2
  now=$(ps -o time= -p $pid | awk -F: '{print $1*60+$2}')
  if awk "BEGIN{exit !($now - $last < 0.1)}"; then quiet=$((quiet+1)); else quiet=0; fi
  last=$now
done
echo "env: ${*:-default}  (idle after $(( $(date +%s) - start - 10 )) s)"
vmmap --summary $pid 2>/dev/null | grep -E "^(Physical footprint:|IOAccelerator |Memory Tag 255 )" | awk '{print "  " $0}' | cut -c1-110
