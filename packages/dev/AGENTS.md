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
```

## Key Patterns

- **Commands**: `up`, `down` (`--purge` releases the slot), `new`, `init`, `remove`, `list`, `status`, `reset`, `migrate`, `copy` (env sync), `reload` (`crbn reload <service...>` → `docker compose up -d --force-recreate` a subset, applying compose/`.env.local` edits without restarting the app dev servers)
- **Stack boot** (`commands/up.ts`): Docker Compose → wait Postgres → migrations → regen types → spawn apps → portless aliases
- **Provision** (`commands/init.ts`): `crbn init` provisions an already-created worktree (canonical slug + env sync + skills) to match a `crbn checkout`; shared by `new`, the bash `checkout` post-create hook, and Conductor's `setup` (`.conductor/settings.toml`). It does NOT boot the stack — `crbn up` still mints ports/`.env.local`.
- **Worktree** (`worktree.ts`): `resolveSlug()`, `canonicalSlug()` (branch-derived `<repoBase>-<branch>`), `getWorktreeRoot()`, `projectName()`, `ensureSlugAvailable()`
- **Services**: `compose.ts` (Docker), `migrations.ts` (Postgres/Supabase), `portless.ts` (`.dev` URLs), `apps.ts` (dev servers)
- **Env**: `env.ts` — `renderEnv()`, `writeEnv()`, `syncAppPortlessConfigs()`
- **`--run` flag**: scopes stack lifetime to a command (for headless/CI builds); `--volumes` cleans up Docker volumes on teardown

## Cross-References

- `packages/harness/` — uses `crbn up --run` for headless agent builds
- `packages/database/` — migrations applied during `crbn up`
- `docker/` — Compose files consumed by the stack boot
