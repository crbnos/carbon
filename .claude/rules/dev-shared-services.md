---
description: The shared dev containers (crbn-shared), the database per worktree, pg_cron and pg_net forwarding, and --isolated
paths:
  - packages/dev/**
  - scripts/restore-database.sh
  - scripts/lib/generate-db-types.ts
---

# Dev shared services

Redis is one of the shared containers too (`carbon-redis`, in isolated mode as
well): see [dev-shared-redis.md](dev-shared-redis.md).

## Two modes

| Mode | Command | Containers |
|------|---------|------------|
| Shared (default) | `crbn up` | 5 per worktree, plus the 7 in `crbn-shared` |
| Isolated | `crbn up --isolated` | 9 per worktree, all in the worktree's project |

- `crbn up` writes the mode to `~/.carbon/stacks/<slug>/mode`. `stackAt`
  (`stack.ts`) reads it. Without the file, a `.env.local` that names the
  `postgres` database reads as `isolated`, anything else as `shared`.
- `recordedStackMode` returns `null` for a missing file. A missing file means no
  `crbn` with modes ran `up` there, so the worktree has no `wt_` database and its
  volumes are live. Every command that deletes data checks `recordedStackMode`.
- Plain `crbn up` is shared mode. `crbn reset` passes the recorded mode to `up`,
  so a reset keeps an isolated stack isolated.
- Use `--isolated` on a branch that changes the Postgres, Realtime or Storage
  image.

## The shared containers

`packages/dev/docker/docker-compose.shared.yml`, compose project `crbn-shared`.
`bootSharedServices` (`services/compose.ts`) copies it, `init.sql`,
and `shared-init.sql` to `~/.carbon/shared/` and runs it from there.
The containers then outlive any worktree.

| Container | Host port | What it serves |
|-----------|-----------|----------------|
| `carbon-postgres` | `54322` | One database per worktree, `wt_<slug>` |
| `carbon-pgbouncer` | `54329` | Transaction mode. The `*` entry routes every `wt_` database. |
| `carbon-storage` | `54326` (admin API) | One Storage tenant per worktree |
| `carbon-imgproxy` | none | Image transforms for `carbon-storage` |
| `carbon-inbucket` | `54324` | One mail server for every worktree |
| `carbon-redis` | `6379` | One logical database per worktree slot. Isolated worktrees use it too: `bootSharedForIsolated` starts it and the edge runtime alone (`up --no-deps`). |
| `carbon-edge-runtime` | none | Every worktree's `/functions/v1/` (see Edge runtime below). Isolated worktrees use it too. |

- The project name must not start with `carbon-`. Every `crbn` version treats a
  `carbon-*` project with no slot as an orphan. `reset` and `prune` force-remove
  it, and older versions in other worktrees can't be changed. `compose.test.ts`
  pins this.
- The network is `carbon-shared` (external). The worktree's `api-gw` and
  `inngest` join it with the aliases `<slug>-api-gw` and `<slug>-inngest`.
  `stackHosts` (`topology.ts`) gives the config row these hosts.
- When the running shared project used other files, `bootSharedServices` returns
  a warning and does not restart it. Another worktree may depend on it. A file
  missing a service added since (`redis`, `edge-runtime`) is the exception: it is
  replaced, and compose creates only the missing ones (`missingSharedServices`).
- The shared compose commands get `sharedComposeEnv()` only: `PATH`, `HOME` and
  `DOCKER_*`. `crbn`'s own environment holds the booting worktree's
  `.env.local`. Passed through, its `PG_MAX_CONNECTIONS=100` replaced the shared
  500, and other `MEM_*` values would recreate the containers every worktree
  uses.

## Edge runtime

One runtime (`carbon-edge-runtime`) serves every worktree's `/functions/v1/`.

- `prepareShared` copies `packages/database/supabase/functions` and
  `packages/dev/docker/edge-main` from the `crbn` code that runs into
  `~/.carbon/shared/`, each into a directory named after its content
  (`functions-<digest>`, `sharedDirName`), and writes the names to `.env`
  (`FUNCTIONS_DIR`, `EDGE_MAIN_DIR`). New code is a new mount path, so compose
  recreates the runtime; the old copy stays mounted until then.
  `pruneSharedDirs` deletes old copies only after a successful `up`, and keeps
  the one `carbon-edge-runtime` mounts.
- The code is that of whichever `crbn` booted last. `bin/crbn` runs the main
  checkout's code in a worktree without `node_modules`, so usually that is
  main's. A worktree with its own `node_modules` runs its own code: two of them
  with different functions recreate the runtime on each other's `crbn up`, and
  a branch that edits a function changes it for every worktree. Use
  `crbn up --full` on such a branch.
- Each worktree's Envoy sets `x-carbon-api: http://<slug>-api-gw:8000`
  (`FUNCTIONS_API_URL`, overwriting any client value). `edge-main` (with
  `API_URL_FROM_HEADER`) gives the function that as `SUPABASE_URL`, and refuses
  a request without it. The `embedding` function uses it to look up a
  `carbon-key`. The JWT secret and keys are machine-wide (`readDevJwt`).
- `edge-main` passes `poolKey` per worktree: the runtime reuses a worker per
  pool key, env included, and the default key is the service path.
- Envoy's `functions` cluster has 2 priorities: the worktree's own runtime
  (`crbn up --full`, this checkout's functions) by its alias
  `local-edge-runtime`, then `carbon-edge-runtime`. Without a private runtime
  the alias does not resolve, priority 0 has no hosts, and traffic goes to
  priority 1. Never the bare `edge-runtime`: on `carbon-shared` it resolves to
  `crbn-shared`'s service, so "private first" would depend on Docker's DNS
  order (see below).

## Older crbn on the same machine

A worktree whose own `crbn` predates Redis and the edge runtime in
`crbn-shared` (an old branch with its own `node_modules`) still runs Redis with
`docker run` and then `compose up --remove-orphans`. When `crbn-shared` is
stopped (a Docker restart, `crbn prune --all`), it copies its own compose file,
which has neither service, and compose removes `carbon-redis` and
`carbon-edge-runtime` as orphans. The apps keep working without Redis
(`@carbon/kv` fails soft), and functions answer 503. The next `crbn up` from
current code adds both again: `planSharedFiles` replaces a file that lacks a
service (`missingSharedServices`), and the Redis volume keeps its keys.

## Hostnames on two networks

Compose gives each service its name as an alias on every network it joins. On
`carbon-shared`, every worktree's `gotrue`, `postgrest` and `meta`, and
`crbn-shared`'s `postgres`, `storage`, `inbucket`, `redis` and `edge-runtime`, answer to the same names.
A container on both networks can resolve a name to another worktree's
container.

- Never use a bare service name from a container that joins `carbon-shared`.
- Envoy reaches `local-gotrue`, `local-postgrest`, `local-meta` and
  `local-edge-runtime`. These aliases exist on the worktree's own network only. `realtime-dev` works the same way.
- In isolated mode, `DB_HOST`, `STORAGE_HOST` and `SMTP_HOST` are
  `local-postgres`, `local-storage` and `local-inbucket`.
- The shared containers are named `carbon-postgres`, `carbon-storage` and
  `carbon-inbucket`. A container name is unique on every network.

## Per worktree

`api-gw` (Envoy), `gotrue`, `postgrest`, `realtime` and `inngest`, from
`docker-compose.dev.yml`. `docker-compose.isolated.yml` holds the private
`postgres`, `pgbouncer`, `storage`, `imgproxy` and `inbucket`. `composeFileArgs`
adds it in isolated mode.

- **Realtime** stays per worktree. Its broadcast slot name has no tenant in it,
  so 2 tenants on one cluster collide. `SLOT_NAME_SUFFIX` is the first 8 hex
  characters of the SHA-1 of the database name, because Postgres caps a slot
  name at 63 characters.
- **Inngest** stays per worktree. A shared dev server lets one worktree trigger
  another worktree's functions.
- **Envoy** sets the Storage tenant in `X-Forwarded-Host` (`<db>.storage`). It
  also sends the worktree's `SUPABASE_URL` in `Forwarded` and
  `X-Forwarded-Port` (`STORAGE_PUBLIC_*` in `.env.local`). Storage builds
  resumable-upload URLs from these 2 headers. Do not take them from the
  request: the portless proxy rewrites the host and port.

## The worktree database

`provisionWorktreeData` (`services/shared-db.ts`) runs three steps, in order,
on every `up`, and on a `migrate` that boots its own services in shared mode:

- `ensureTemplate` builds `carbon_template` once per volume, from `postgres`
  with pg_cron and pg_net. `postgres` can't be cloned while the pg_cron and
  pg_net workers hold connections, so it is closed to new connections for the
  clone.
- `createWorktreeDatabase` clones the template in under a second. It then gives
  the clone the owner and grants of the `postgres` database
  (`databaseGrantsSql`), on every `up`. A clone does not copy `pg_database`'s
  owner or ACL. The Supabase CLI migrates as `postgres`, which is no superuser.
- `registerStorageTenant` registers the tenant through the admin API. Storage
  then runs its own migrations in the database.
- Roles are cluster-wide. A change to a role changes it for every worktree.
  `scripts/restore-database.sh` gives `postgres` superuser, and a dump can carry
  `ALTER ROLE`.

## pg_cron and pg_net forwarding

pg_cron and pg_net each serve one database per cluster, and in this cluster
that database is `postgres`. `docker/worktree-forwarding.sql` adds triggers to
each `wt_` database that hand its work to `postgres` over dblink. `crbn up`
applies it on every boot (`provisionWorktreeData`); it is idempotent. The
objects live in the schema `crbn`, outside what PostgREST and the generated
types read.

- **pg_net**: a trigger on `net.http_request_queue` runs at commit. Its first
  call moves every queued row to the `postgres` queue in one dblink connection
  and wakes the worker. A rolled-back transaction sends nothing. A failed
  forward keeps the rows, and the next commit sends them. The response lands
  in `postgres`; nothing in Carbon reads responses.
- The request leaves during commit processing. If a deferred constraint queued
  after it fails, the transaction rolls back but the request is sent: Postgres
  has no hook that runs after a commit.
- **pg_cron**: a trigger on `cron.job` schedules a copy in `postgres` with
  `cron.schedule_in_database`, named `<db>:<job>`, as the job's owner.
  `cron.unschedule` deletes with `simple_heap_delete`, which fires no trigger,
  and a restore loads `cron.job` with triggers off, so `crbn.sync_cron()` makes
  the copies match. In shared mode `databaseTasks` (`services/migrations.ts`)
  runs it on every `crbn up`, `crbn migrate` and `crbn restore`, also when no
  migration applied. A job unscheduled by hand keeps
  running until then. A failed forward warns and leaves the repair to the
  next sync, so it never fails a migration.
- Dropping a worktree database removes its copies, and those of any database
  dropped by hand (`dropWorktreeDatabase`).
- `crbn status` shows the local pg_net queue length. It is 0 unless forwarding
  failed; the failure is a warning in the Postgres log.

## Lifecycle per command

| Command | Shared mode |
|---------|-------------|
| `crbn up` | Boots `crbn-shared`, creates the database and the tenant, starts the 5 worktree containers. |
| `crbn down` | Stops the worktree containers. Keeps the database and the tenant. |
| `crbn down --volumes` / `--purge` | Also drops the database and deletes the tenant and its files (`dropWorktreeData`). `--purge` releases the slot. |
| `crbn reset` | Boots `crbn-shared`, drops the database, then runs `up` in the recorded mode. Keeps the slot. Orphans of other worktrees are `crbn prune`'s. |
| `crbn remove` | Drops the database and the tenant with the stack. |
| `crbn prune` | Also drops each `wt_` database that no live slot owns, and the old private volumes of worktrees now in shared mode. |
| `crbn prune --all` | Drops every `wt_` database and stops `crbn-shared`. |
| `crbn migrate` | Runs against `wt_<slug>`. Without the service schemas, it boots `gotrue` and `realtime` first. |
| `crbn restore` | Restores into `wt_<slug>`. It passes `PORT_DB` and `DB_NAME` to the script. |
| Hibernation | Stops the worktree containers only. |

- Every command stops and removes a stack through `teardown` (`teardown.ts`).
  It runs each step even when one before it failed, and returns the failures.
  `down`, `remove` and `up --run --volumes` warn when it can't drop the
  database (`down` also exits 1). After `--purge` or `remove`, `prune` drops it
  later, because no slot owns it.
- `reset` fails instead. A reset that keeps the data is wrong.

## Generated types

Multi-tenant Storage skips `iceberg_namespaces` and `iceberg_tables` in a tenant
database. `scripts/lib/generate-db-types.ts` strips them, so both modes generate
the same `types.ts`. Carbon does not use them.

## Verification

- `node packages/dev/scripts/verify-stack.mjs <root> [<second root>]` checks a
  stack through its gateway. With 2 roots it also checks that the worktrees
  can't see each other's data. It drops its probes when it ends, because
  `crbn up`'s authz sync refuses a public table with no rule.
- Realtime checks its publication once a minute and stops streaming when it
  changes. `verify-stack.mjs` inserts until its own event arrives before it
  checks isolation.
- `pnpm --filter @carbon/dev smoke` boots a second worktree on the shared
  containers, with portless: localhost mode has fixed ports, so only one
  worktree can use it. Run the smoke test from a worktree with no stack.
