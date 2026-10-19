#!/usr/bin/env bash
# Checks the unit tests cannot make: they need real containers and real
# processes. Run it from a worktree that has NO stack — it builds one from an
# empty volume and destroys it again. Needs Docker; takes under a minute.
#
#   pnpm --filter @carbon/dev smoke
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
crbn="$root/packages/dev/bin/crbn"
tsx="$root/node_modules/.bin/tsx"
export CARBON_DEV_YES=1

ok() { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
json() { node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }

# --- 1. Slot registry under concurrent boots (no Docker) ---------------------
# A scratch HOME keeps the real registry out of it.
scratch="$(mktemp -d)"
booted=0
cleanup() {
  rm -rf "$scratch"
  if [[ "$booted" == 1 ]]; then "$crbn" down --purge >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

for i in 1 2 3 4 5 6 7 8; do
  mkdir -p "$scratch/wt-$i"
  HOME="$scratch" "$tsx" -e "import('$root/packages/dev/src/worktree.ts').then((m) => m.resolveSlot('smoke-$i', '$scratch/wt-$i'))" &
done
wait
json "
  const slots = Object.values(d);
  const ports = slots.flatMap((s) => Object.values(s.ports));
  const dbs = slots.map((s) => s.redisDb);
  if (slots.length !== 8) throw new Error('expected 8 slots, got ' + slots.length);
  if (new Set(ports).size !== ports.length) throw new Error('two slots share a port');
  if (new Set(dbs).size !== dbs.length) throw new Error('two slots share a redis db');
" <"$scratch/.carbon/dev-ports.json" || fail "concurrent slot allocation collided"
ok "8 concurrent boots got 8 slots with no shared port or redis db"

# --- 2. A stack from an empty volume ----------------------------------------
project="$("$crbn" status --json | json "console.log(d.project)")"
if docker volume ls -q | grep -qx "${project}_pgdata"; then
  fail "$project already has a database volume — this would wipe it. Run from a worktree with no stack."
fi
booted=1

# Standalone migrate on a volume nothing has ever booted: it must start the
# services whose schemas the migrations write into, not Postgres alone.
"$crbn" migrate --no-regen >/dev/null || fail "crbn migrate failed on a fresh volume"
ok "crbn migrate applied every migration to a fresh volume"

"$crbn" up --no-apps --no-portless --no-regen >/dev/null || fail "crbn up failed"
"$crbn" status --json | json "
  const down = d.containers.filter((c) => c.State !== 'running').map((c) => c.Service);
  const names = d.containers.map((c) => c.Service);
  for (const s of ['postgres', 'kong', 'gotrue', 'storage', 'realtime', 'postgrest', 'inngest'])
    if (!names.includes(s)) throw new Error('status does not list ' + s);
  if (down.length) throw new Error('not running: ' + down.join(', '));
" || fail "crbn status does not show a healthy stack"
ok "crbn up booted the stack and crbn status sees every service running"

"$crbn" down --purge >/dev/null || fail "crbn down --purge failed"
booted=0
left="$(docker ps -aq --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
vols="$(docker volume ls -q --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
[[ "$left" == 0 && "$vols" == 0 ]] || fail "purge left $left container(s) and $vols volume(s)"
ok "crbn down --purge left no containers or volumes"
