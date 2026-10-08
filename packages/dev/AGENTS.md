# @carbon/dev

Developer CLI (`crbn` command) — worktree management, Docker Compose stacks, migrations, portless dev URLs, and app lifecycle.

## Always

- **Use the `crbn` CLI for stack operations** — `crbn up` boots Docker + apps, `crbn down` tears down, `crbn new` creates worktrees, `crbn status` shows state
- **Bash router handles `checkout`** — the `bin/crbn` shell script routes lightweight commands; heavy commands delegate to `tsx packages/dev/src/main.ts` (citty)
- **Respect the slot system** — `resolveSlot()` / `getSlot()` manage port allocation per worktree to avoid conflicts
- **Guard platform compatibility** — `bin/crbn` validates OS (POSIX only: Linux, macOS, WSL, Git Bash) and Node 22+

## Ask First

- Changing Docker Compose service definitions or port mappings
- Modifying the portless proxy setup (`services/portless.ts`)
- Adding new `crbn` subcommands (register in `src/main.ts` `subCommands`)

## Never

- Run `crbn up` without Docker running — it calls `ensureDockerRunning()` first
- Hardcode ports — use the slot/worktree resolution system
- Skip migrations on stack boot unless explicitly passing `--no-migrate`

## Validation Commands

```bash
pnpm --filter @carbon/dev test        # vitest
pnpm --filter @carbon/dev typecheck   # tsgo --noEmit
pnpm --filter @carbon/dev smoke       # real containers: slots, fresh migrate, up, status, purge (~40 s, needs Docker; run from a worktree with no stack)
```

## Key Patterns

- **Commands**: `up`, `down` (`--purge` releases the slot), `new`, `init`, `remove`, `prune` (destroys stacks whose worktree directory is gone or that have no slot — the cleanup for worktrees deleted without `crbn remove`; `--all` destroys every stack on the machine and keeps worktrees and live slots; `--tree` also runs `git worktree prune`, and with `--all` removes this repo's linked worktrees — never the main checkout, the current one, or one with uncommitted changes or a detached HEAD; branches are kept), `list`, `status`, `reset`, `migrate`, `restore`, `copy` (env sync), `reload` (`crbn reload <service...>` → `docker compose up -d --force-recreate` a subset, applying compose/`.env.local` edits without restarting the app dev servers)
- **Restore** (`commands/restore.ts`): `crbn restore <file>` wraps `scripts/restore-database.sh` (the SQL is deliberately NOT ported) and adds worktree/`PORT_DB` resolution, a confirmation gate, and the trailing `applyMigrations` + `db:types`. The script truncates the local `supabase_migrations` ledger before restoring so the dump's own ledger lands — the ledger must travel WITH the schema, else the dump's older schema pairs with the local newer ledger and the trailing migrate step silently no-ops (leaving weeks of migrations missing while the ledger claims them applied). It deliberately does NOT boot a partial stack the way `crbn migrate` does — a restore rewrites `auth`/`storage`, whose schemas GoTrue and Storage build via their own migrations, so it requires a fully booted stack (`serviceSchemasReady` probes for GoTrue's `auth.users.email_confirmed_at`, `storage.objects`/`storage.buckets` AND Realtime's `realtime.messages` — the restore script's `to_regclass` guards mean a missing Storage schema would otherwise let the restore finish with no buckets seeded) and refuses otherwise — the backup carries the SOURCE schema, which is usually behind the branch. **`--scrub-emails` defaults ON here, inverting the script's opt-in default**, so a restore cannot drop real customer addresses into a local DB unless asked. By default the script truncates `storage.objects` (kept rows would point at files that live only in the source environment's backend, so downloads 404); pass `--keep-storage-objects` to retain them and the dump's buckets when you need realistic storage metadata, e.g. profiling storage RLS.
- **Stack boot** (`commands/up.ts`): Docker Compose → wait Postgres → wait service schemas → migrations → regen types → spawn apps → portless aliases
- **Migrations need three services, not just Postgres**: they write into `storage.buckets`, GoTrue's `auth` columns and `realtime.messages`, which Storage, GoTrue and Realtime build on first boot. `waitForServiceSchemas` gates every migrate on a fresh volume; standalone `crbn migrate` boots `postgres` + `gotrue` + `storage` + `realtime` for the same reason. A from-zero migrate takes about 5 s once they are up, so there is nothing to gain from caching a migrated volume.
- **Stack size** (`StackSize` / `profileArgs` in `services/compose.ts`): `crbn up` starts the eight services the apps need (Inbucket included, for login emails). `--full` adds Studio, Postgres-Meta, the edge runtime and imgproxy (compose profile `full`). Nothing in the apps calls the first three, and they were ~40% of a stack's memory; imgproxy only converts HEIC and images the wasm pipeline refuses, and a transform attempted without it logs `imageTransformErrorMessage` (`@carbon/files`), which says to run `crbn reload imgproxy`. `--minimal` also drops Inbucket (profile `mail`). Picking **Studio** in the `crbn up` app picker (or `studio` in `CARBON_DEV_APPS`) enables profile `studio` instead, which holds only Studio and Postgres-Meta; it is a compose service, so a pick of Studio alone is still services-only mode. `crbn reload studio` starts Studio on a running stack. `generate:swagger` reads PostgREST through Kong with the anon key (byte-identical to what Studio served), so it works at every size.
- **Provision** (`commands/init.ts`): `crbn init` provisions an already-created worktree (canonical slug + env sync + skills) to match a `crbn checkout`; shared by `new`, the bash `checkout` post-create hook, and Conductor's `setup` (`.conductor/settings.toml`). It does NOT boot the stack — `crbn up` still mints ports/`.env.local`.
- **Worktree** (`worktree.ts`): `resolveSlug()`, `canonicalSlug()` (branch-derived `<repoBase>-<branch>`), `getWorktreeRoot()`, `projectName()`, `ensureSlugAvailable()`
- **Services**: `compose.ts` (Docker), `migrations.ts` (Postgres/Supabase), `portless.ts` (`.dev` URLs), `apps.ts` (dev servers)
- **Aux spawners** (`services/apps.ts`): `spawnAssembler` (cargo) and `spawnEmailPreview` (`@carbon/documents` `email:previews` on `PORT_EMAIL` — the react-email server over `src/email/previews`, one fixture per email) — opt-in picker apps with their own spawners, not react-router dev servers
- **Vite helpers** (`vite.js`, exported as `@carbon/dev/vite`, typed by `vite.d.ts`): `applyDotenvToProcessEnv`, `clientOnlyAlias` (stub a module in the browser build only), `linguiWithoutIdQuery` (works around Lingui 6.9.0 parsing React Router's `?query`-suffixed route ids as plain JS)
- **Spinners come from `ui.ts`, not `@clack/prompts`**: `tasks`, `spinner` and `progress` there print one line per step when stdout is not a terminal (an agent, a pipe, a log file) instead of every animation frame. Importing them from clack directly brings the frame noise back.
- **No command allow-list in `bin/crbn`**: the bash router runs from the main checkout while the TypeScript CLI runs from the current worktree, so the router passes anything it doesn't own (`checkout`, help, version) straight through. Register a subcommand in `src/main.ts` only.
- **Prompts need a terminal — say so**: a clack prompt with no TTY ends the process without a word. Every prompt calls `requireTerminal(what, instead)` (`prompts.ts`) first, which throws a one-line error naming the non-interactive route: `CARBON_DEV_YES=1` for the confirms, `crbn remove <branch-or-path...>`, `crbn new --yes <branch>`.
- **`--json`** on `status` and `list` prints machine-readable output (ports, redis db, containers; never the JWT secret).
- **Read-only compose calls pass `--env-file`** (`envFileArgs`): compose interpolates the whole file before `ps`/`logs`, and it has values with no default, so without `.env.local` those calls fail and report an empty stack.
- **`restart: on-failure`** on every compose service: a crash restarts the container, a Docker daemon start does not. A stack only comes up through `crbn up`.
- **The slot registry is locked** (`lockRegistry` in `worktree.ts`): every change to `~/.carbon/dev-ports.json` is read → decide → write under a `mkdir` lock, written through a temp file + rename. Conductor boots workspaces concurrently; without the lock eight simultaneous `crbn up` left one slot in the file. Any new writer must take the lock.
- **Compose reads throw** (`composeRead` in `services/compose.ts`): `listContainers` and `listComposeServices` raise compose's own error instead of returning an empty list, which used to pass for "no stack".
- **Hibernation** (`services/hibernate.ts` + `stackActivity()` in `vite.js`), two stages while `crbn up` runs ERP/MES:
  - **Stack** — the dev servers touch `~/.carbon/stacks/<slug>/activity` on each request (`/api/inngest` excluded: Inngest polls it every 5 s). After `CRBN_IDLE_MINUTES` (default 30) without one, `crbn up` writes an `asleep` marker holding its pid and runs `docker compose stop`. The next request is held by the plugin while `crbn up` runs `bootStack` and waits for Postgres and the API — about 8 s.
  - **Dev servers** — they hold more than the containers (roughly 1 GB each). After `CRBN_APPS_IDLE_MINUTES` (default 120) `crbn up` aborts them (`spawnApps`' `signal`) and listens on their ports itself (`startWaker`). A request there cannot be handed over — the dev server needs that port — so a browser gets a page that polls and reloads, anything else a 503 with `x-crbn-waking`. Inngest polls and WebSocket upgrades (an open tab's Vite client probing for its server) do not wake it. That wake is about 40 s: the dev servers boot from cold.
  - Off for `--no-apps`, `--run`, `--borrow` (the owning `crbn up` does it) and `--no-hibernate`. Traffic that never reaches ERP/MES (`psql`, scripts on the API) does not count; `crbn migrate` and `crbn restore` wake a sleeping stack themselves (`wakeIfAsleep`). `crbn list` and `crbn status` show a hibernated stack.
- **`crbn prune` also clears stale portless routes** (`findStaleAliases`): static aliases crbn registered whose port no live slot owns. `portless prune` only reaps routes that have a process.
- **Env**: `env.ts` — `renderEnv()`, `writeEnv()`, `syncAppPortlessConfigs()`
- **`--run` flag**: scopes stack lifetime to a command (for headless/CI builds); `--volumes` cleans up Docker volumes on teardown

## Cross-References

- `packages/harness/` — uses `crbn up --run` for headless agent builds
- `packages/database/` — migrations applied during `crbn up`
- `docker/` — Compose files consumed by the stack boot
