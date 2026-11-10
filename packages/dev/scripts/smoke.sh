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
# A function call through one worktree's gateway: it reaches the shared edge
# runtime, which must answer with that worktree's keys.
embeds() {
  local env="$1/.env.local" url anon key
  url="$(grep -E '^SUPABASE_URL=' "$env" | cut -d= -f2-)"
  anon="$(grep -E '^SUPABASE_ANON_KEY=' "$env" | cut -d= -f2-)"
  key="$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' "$env" | cut -d= -f2-)"
  curl -sf -m 120 -X POST "$url/functions/v1/embedding" \
    -H "apikey: $anon" -H "Authorization: Bearer $key" \
    -H 'content-type: application/json' -d '{"text":"smoke"}' \
    | json "if (!Array.isArray(d.embedding) || d.embedding.length !== 384) throw new Error('no embedding')"
}
# verify-stack.mjs prints one line per check; show them only when it fails.
verify() {
  local out
  out="$(node "$root/packages/dev/scripts/verify-stack.mjs" "$@" 2>&1)" || { printf '%s\n' "$out" >&2; return 1; }
}

# --- 1. Slot registry under concurrent boots (no Docker) ---------------------
# A scratch HOME keeps the real registry out of it.
scratch="$(mktemp -d)"
booted=0
second=""
second_branch="smoke/second-$$"
cleanup() {
  rm -rf "$scratch"
  if [[ "$booted" == 1 ]]; then "$crbn" down --purge >/dev/null 2>&1 || true; fi
  if [[ -n "$second" && -d "$second" ]]; then
    (cd "$second" && "$second/packages/dev/bin/crbn" down --purge >/dev/null 2>&1) || true
    git -C "$root" worktree remove --force "$second" >/dev/null 2>&1 || true
    git -C "$root" branch -D "$second_branch" >/dev/null 2>&1 || true
  fi
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
slug="$("$crbn" status --json | json "console.log(d.slug)")"
database="$("$tsx" -e "import('$root/packages/dev/src/worktree.ts').then((m) => console.log(m.worktreeDatabaseName('$slug')))")"
# No shared Postgres means no database. A running one that can't answer
# means unknown, and the run must not go on to purge what may be there.
shared_has_db() {
  docker ps -q --filter name=^carbon-postgres$ | grep -q . || return 1
  local found
  found="$(docker exec carbon-postgres psql -U supabase_admin -d postgres -Atc \
    "select count(*) from pg_database where datname = '$1'")" \
    || fail "can't query carbon-postgres to check for $1"
  [[ "$found" != 0 ]]
}
if docker volume ls -q | grep -qx "${project}_pgdata" || shared_has_db "$database"; then
  fail "$project already has a database — this would wipe it. Run from a worktree with no stack."
fi
booted=1

# Standalone migrate on a volume nothing has ever booted: it must start the
# services whose schemas the migrations write into, not Postgres alone.
"$crbn" migrate --no-regen >/dev/null || fail "crbn migrate failed on a fresh volume"
ok "crbn migrate applied every migration to a fresh volume"

"$crbn" up --no-apps --no-portless --no-regen >/dev/null || fail "crbn up failed"
# Shared mode (the default): Postgres, PgBouncer, Storage, Redis and the edge
# runtime run in crbn-shared.
"$crbn" status --json | json "
  const all = [...d.containers, ...d.sharedContainers];
  const down = all.filter((c) => c.State !== 'running').map((c) => c.Service);
  const names = all.map((c) => c.Service);
  for (const s of ['postgres', 'pgbouncer', 'api-gw', 'gotrue', 'storage', 'realtime', 'postgrest', 'inngest'])
    if (!names.includes(s)) throw new Error('status does not list ' + s);
  const shared = d.sharedContainers.map((c) => c.Service);
  for (const s of ['redis', 'edge-runtime'])
    if (!shared.includes(s)) throw new Error('crbn-shared does not run ' + s);
  if (down.length) throw new Error('not running: ' + down.join(', '));
" || fail "crbn status does not show a healthy stack"
ok "crbn up booted the stack and crbn status sees every service running"

verify "$root" || fail "verify-stack.mjs failed for $root"
ok "the stack passes verify-stack.mjs"

for c in carbon-redis carbon-edge-runtime; do
  [[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null)" == crbn-shared ]] \
    || fail "$c is not a crbn-shared container"
done
embeds "$root" || fail "the edge runtime did not answer through $root's gateway"
ok "redis and the edge runtime run in crbn-shared, and functions answer"

# --- 3. A second worktree on the same shared containers ---------------------
# Symlinked deps: without node_modules, bin/crbn would run the main checkout's
# code, not this commit's. The checkout's lockfile is newer than the install
# marker, and `crbn up` would then run `pnpm install` through the symlink, which
# can purge this worktree's node_modules. The lockfile is the same commit's, so
# it takes the marker's mtime.
second="$scratch-second"
git -C "$root" worktree add -q -b "$second_branch" "$second" HEAD
ln -s "$root/node_modules" "$second/node_modules"
ln -s "$root/packages/dev/node_modules" "$second/packages/dev/node_modules"
touch -r "$root/node_modules/.modules.yaml" "$second/pnpm-lock.yaml"
# Portless: localhost mode has fixed ports, so only one worktree can use it.
(cd "$second" && "$second/packages/dev/bin/crbn" up --no-apps --no-regen >/dev/null) \
  || fail "crbn up failed in a second worktree"
verify "$root" "$second" || fail "verify-stack.mjs failed for 2 worktrees"
ok "2 worktrees share the containers and can't see each other's data"
embeds "$second" || fail "the edge runtime did not answer through the second worktree's gateway"
ok "one edge runtime serves both worktrees"

"$crbn" down --purge >/dev/null || fail "crbn down --purge failed"
booted=0
left="$(docker ps -aq --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
vols="$(docker volume ls -q --filter "label=com.docker.compose.project=$project" | wc -l | tr -d ' ')"
[[ "$left" == 0 && "$vols" == 0 ]] || fail "purge left $left container(s) and $vols volume(s)"
! shared_has_db "$database" || fail "purge left $database in the shared Postgres"
ok "crbn down --purge left no containers, volumes or worktree database"
