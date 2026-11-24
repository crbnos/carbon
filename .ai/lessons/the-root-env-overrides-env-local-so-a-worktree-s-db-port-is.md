---
paths: ["apps/erp/test/database/fixtures/**"]
triggers: ["SUPABASE_DB_URL", "databaseTest"]
promoted: null
---
# The root `.env` overrides `.env.local`, so a worktree's DB port is not the default

**Context:** Running the `post-reimbursement` Deno tests with the
`SUPABASE_DB_URL` I found first gave `16 passed | 12 failed`. Re-running the
UNTOUCHED `post-charge` suite gave `19 passed | 16 failed` — the same shape,
failing at the same fixture line. The connection string was wrong, not the code.

**Problem:** Each `crbn` worktree gets its OWN Postgres container on a random
host port (`docker ps` showed `0.0.0.0:49921->5432`), written to `.env.local`.
The root `.env` still carries the stock `54322`, and it WINS — the same
precedence trap that produced the `db:check:backups` fix in `c1c5e7c138`. Port
54322 is often another worktree's live stack, so you don't get "connection
refused"; you connect to a real database with the wrong schema and read the
failures as a bug in your own change.

**Rule:** Get the port from `docker ps --format '{{.Names}}\t{{.Ports}}' | grep
postgres` (or this worktree's `.env.local`) and pass it explicitly. Before
believing a Deno/DB test failure is yours, run a NEIGHBOURING suite you did not
touch — `post-charge` next to `post-reimbursement`. Identical failure counts in
untouched code means the environment, not the diff.

Vitest reads `SUPABASE_DB_URL` from the root `.env` too, so DB-backed vitest suites
(`databaseTest` in `apps/erp/test/database/fixtures/local-database.ts`) connect to the stale port: they do not skip, because the host is still local. Export the
worktree's URL before you run them:
`export SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' .env.local | cut -d= -f2- | tr -d '"')"`.

**Applies to:** DB-backed tests (`apps/erp/test/database/fixtures/`, vitest `databaseTest`); any `pnpm db:check:*` or psql work inside
a Conductor worktree.
