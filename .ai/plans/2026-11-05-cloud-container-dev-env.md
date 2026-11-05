# Boot the dev stack in a Claude cloud container

Status: findings and proposed changes. Nothing is implemented yet.

## How these findings were made

1. Start from a fresh checkout inside a Claude Code cloud container
   (`CLAUDE_CODE_REMOTE=true`, 4 CPU, 16 GB, an agent proxy with a network allowlist).
2. Run `pnpm dev`.
3. Work around each blocker by hand until the ERP answers on port 3000.
4. Log in as `test@carbon.ms` from a Playwright browser. The login succeeded.

## Blockers, in the order the boot hit them

| # | Blocker | Where | Workaround used |
|---|---------|-------|-----------------|
| 1 | `pnpm dev` fails with `sh: crbn: not found`. `@carbon/dev` is not a root dependency, so pnpm never links `crbn` into `node_modules/.bin`. `crbn` exists only after `source ./setup.sh`. The README promises `pnpm dev` right after `pnpm install`. | root `package.json`, `packages/dev/package.json` | `PATH=packages/dev/bin:$PATH` |
| 2 | Node 22 comes first on the container PATH. `bin/crbn` needs 24.22.1 or later. `/opt/node24` is installed but not selected. The container does not read `.nvmrc`. | container image | `PATH=/opt/node24/bin:$PATH` |
| 3 | The Docker daemon is not running. A stale `/var/run/docker.pid` holds a pid that another process now uses, so `dockerd` refuses to start. `ensureDockerRunning` only says "Start Docker Desktop". | container image, `services/compose.ts` | `rm /var/run/docker.pid; dockerd &` |
| 4 | There is no `.env`. `SESSION_SECRET` is `required: "error"`, so the ERP refuses to boot. `crbn up` generates only `.env.local`. | `packages/env`, `packages/dev/src/env.ts` | `cp .env.example .env` |
| 5 | `crbn up` aborts the whole boot at "Regenerate types & swagger". `supabase gen types --db-url` pulls `public.ecr.aws/supabase/postgres-meta:v0.96.4`. ECR redirects the blob download to `*.cloudfront.net`, and the proxy allowlist refuses that host. `generate-db-types.ts` hides the CLI's stderr, so the log only says "exited 1". | `scripts/lib/generate-db-types.ts`, `commands/up.ts` | `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. Docker Hub serves the same image, and the generator then succeeds. |
| 6 | **Bot protection.** `packages/env/src/index.ts` hardcodes Cloudflare's always-pass Turnstile pair whenever `IS_LOCAL_DEV` is true. So every local stack runs Turnstile. The login action verifies the token before it reaches the `DEV_BYPASS_EMAIL` branch. The form stays disabled until the widget from `challenges.cloudflare.com` returns a token. A POST without the widget answers "Bot verification failed" (`login_failed reason=bot detected`). A browser login worked here only because this proxy allows Cloudflare. A proxy that refuses Cloudflare, or any login without a browser, cannot sign in. `BOT_PROTECTION` has no "off" value. | `packages/env/src/index.ts`, `packages/auth/src/services/bot-protection.server.ts`, `login.tsx` | none |

## Problems that did not block the boot

- **Portless CA bind mount in `--no-portless` mode.** `docker-compose.dev.yml` mounts
  `${HOME}/.portless/ca.pem` into gotrue and inngest in every mode. Without portless
  the file does not exist, so Docker creates a directory at that path. A later
  `portless` install then finds a directory where its CA file belongs.
- **Non-TTY output.** With stdout sent to a file, the compose pull and the task
  spinners still print cursor escape codes (`[?25l`, `[1G[J`) on every line.
  `ui.ts` keys clack's static mode on `CI=true` only.
- **Supabase CLI telemetry.** Each `gen types` posts to `eu.i.posthog.com`. The proxy
  answers 403 and the CLI logs a warning. This is noise only.
- **Preview host (not verified).** `apps/erp/vite.config.ts` limits `server.allowedHosts`
  to `.dev`, `.localhost`, ngrok and trycloudflare. If the cloud preview forwards the
  port with its own `Host` header, Vite answers "Blocked request".
- **`agent-browser` is not installed.** `/auth`, `/test` and `/smoke-test` cannot run as
  written. Playwright and Chromium are preinstalled
  (`/opt/node-tools/node_modules/playwright`, `/opt/pw-browsers/chromium`).
- **Pre-commit hook.** `pnpm prepare` installs `scripts/git-hooks/pre-commit`. A commit
  that touches `packages/database/` runs `db:check:datasets` and `db:check:backups`.
  Both need the live local database. `CARBON_SKIP_DATASET_CHECK=1` and
  `CARBON_SKIP_BACKUP_CHECK=1` skip them.
- **Resources.** Images use 4.8 GB of disk. The containers use about 750 MB of memory.
  The ERP dev server adds about 1 GB. A boot from zero took about 6 minutes. Image
  pulls and the first Vite dependency optimisation took most of that time.
- **Hibernation.** `crbn up` stops the containers after 30 idle minutes and the dev
  servers after 120. That suits a cloud session, as long as `crbn up` itself stays
  alive. This boot started it with `nohup`.

## Proposed changes

### A. Bot protection is off in local dev by default

Decision: change the default in code. No `none` enum value and no line in `.env.local`.

- [ ] In `packages/env/src/index.ts`, delete the `IS_LOCAL_DEV` fallback that fills
      `CLOUDFLARE_TURNSTILE_SITE_KEY` and `CLOUDFLARE_TURNSTILE_SECRET_KEY` with the
      always-pass test pair. Read both keys with `getEnv` in every environment.
      `resolveBotProtection()` then returns `null` on a local stack with no keys, which
      lets `DEV_BYPASS_EMAIL` and agent logins through.
- [ ] A developer who wants the Turnstile widget uncomments the test pair in `.env`.
      It is already there, commented out.
- [ ] `bot-protection.test.ts` mocks the whole env module, so no test changes. Add one
      test: no keys and `BOT_PROTECTION` unset returns `null`.
- [ ] Update the comment in `.env.example`, `environment-configuration.md`,
      `authentication-system.md` and the prerequisites of the `/auth` skill.

### B. `pnpm dev` works right after `pnpm install`

- [ ] Add `"@carbon/dev": "workspace:*"` to the root `devDependencies`, so pnpm links
      `node_modules/.bin/crbn`. The alternative is to point the root `dev` and `db:*`
      scripts at `packages/dev/bin/crbn`. The bash router already runs from the repo root.

### C. A plain local boot needs no `.env`

- [ ] `crbn up` mints a `SESSION_SECRET` per slot. Store it next to the JWT secret in
      `~/.carbon/dev-ports.json`, so it stays stable across boots.
- [ ] Write it to `.env.local` unless `.env` sets one. Every other `required: "error"`
      variable is already in `.env.local`.

### D. Type generation must not need AWS ECR

- [ ] In `scripts/lib/generate-db-types.ts`, spawn the CLI with
      `SUPABASE_INTERNAL_IMAGE_REGISTRY` set to `docker.io` unless the caller set it.
- [ ] Include the CLI's stderr in the thrown error, with the `--db-url` value redacted.
- [ ] In `commands/up.ts`, treat a failed type regen as a warning, not an abort. The
      types are committed and the migrations were already applied. Abort only when the
      committed type file is missing.

### E. Docker in a root Linux container

- [ ] In `ensureDockerRunning()`, if `docker info` fails, `dockerd` is on PATH, the
      process runs as root, and no live pid is in `/var/run/docker.pid`: start `dockerd`
      detached and wait up to 30 s for the socket. Then fall back to the current message.
- [ ] Add `CARBON_DEV_START_DOCKER=0` to opt out.

### F. Cloud session bootstrap

- [ ] Add a `SessionStart` hook or an environment setup script. It must be idempotent
      and do these steps:
      1. Put `/opt/node24/bin` first on PATH, or run `nvm use` from `.nvmrc`.
      2. Start Docker (see E).
      3. Run `cp -n .env.example .env` until C lands.
      4. Run `CARBON_DEV_APPS=erp CARBON_DEV_YES=1 nohup pnpm dev > ~/.carbon/crbn-up.log &`.
      5. Report port 3000 as the preview port.
- [ ] Network policy of the environment: allow `registry-1.docker.io` and
      `production.cloudflare.docker.com` (both reachable today). Allow `public.ecr.aws`
      and `*.cloudfront.net` only if D does not land. `challenges.cloudflare.com` is
      needed only while A keeps Turnstile on.

### G. Small fixes seen on the way

- [ ] Compose: mount the portless CA only when portless is on. Use a variable that
      defaults to `/dev/null`, or a compose profile. Then `--no-portless` never creates
      `~/.portless/ca.pem` as a directory.
- [ ] When stdout is not a TTY, run `docker compose pull` with `--quiet` and print one
      line per task instead of spinner frames.
- [ ] In the ERP and MES `vite.config.ts`, set `allowedHosts: true` when
      `process.env.CLAUDE_CODE_REMOTE` is set. Verify against the real preview URL first.
- [ ] Give the `/auth` skill a Playwright fallback for when `agent-browser` is absent,
      or install `agent-browser` in the setup script with
      `CHROME_PATH=/opt/pw-browsers/chromium`.

## Boot time, measured

Three boots on this container (4 CPU). Times are wall clock from `pnpm dev`.

| Phase | Fresh container | Restart, cold Vite cache | Restart, warm Vite cache |
|-------|-----------------|--------------------------|--------------------------|
| Preflight (`pnpm install` check, skills, env, redis) | 15 s | 15 s | 1 s |
| Image pulls (4.8 GB from Docker Hub) | ~60 s | 0 | 0 |
| Containers up + service schemas | ~60 s (fresh volume) | 11 s | 9 s |
| Migrations | in the 60 s above | 3 s (already up to date) | 0 s |
| Types + swagger regen (CLI pulls and runs `postgres-meta`) | ~35 s | 33 s | 17 s |
| RLS sync + smoke-test user | 7 s | 7 s | 6 s |
| Vite dev server ready | 6 s | 6 s | 4 s |
| First page served (`GET /login`) | 145 s | 130 s | 106 s |
| **Total** | **~6 min** | **3 min 25 s** | **2 min 23 s** |

The first page is the largest cost and does not depend on the Vite dependency cache:
with the cache warm it still took 106 s. The dependency optimizer is 10 to 30 s of it.
The rest is the on-demand SSR transform of the root and login module graph.

### H. Make the boot faster

- [ ] Spawn the ERP and MES dev servers right after "containers up", in parallel with
      migrations, type regen, RLS sync and the seed. The dev server needs the database
      only at request time. The stack activity plugin can hold a request until
      `crbn up` finishes the database phase. Saves about 60 s per boot.
- [ ] Add Vite `server.warmup` for the root, the login route and the app shell in
      both apps, so the SSR transform starts at dev server boot instead of at the
      first request. Together with the step above, the transform overlaps the database
      phase.
- [ ] Skip "Regenerate types & swagger" when the migrate step reports "schema already
      up to date". The types are committed. Saves 17 to 35 s on every warm boot, and
      removes the `postgres-meta` pull from most boots.
- [ ] Cloud setup script: run `docker compose pull` and start `pnpm dev` in the
      background at session start. The setup script runs for every session, so this
      moves the wait before the first prompt instead of removing it.
- [ ] Profile the first-request SSR transform before promising more
      (`DEBUG=vite:transform`, `vite --profile`). Suspects: the Lingui macro
      transform on every module, and the `@carbon/react` barrel pulling the whole
      library into the login route.
- [ ] Not worth it: a pre-migrated Postgres volume. A fresh volume costs about 60 s
      once per container, and most of that is GoTrue, Storage and Realtime building
      their own schemas.

### I. Stale pid files

`dockerd` died once during the session. Its restart then failed on a stale
`/var/run/docker/containerd/containerd.pid` whose pid belonged to another process. The
container image seems to carry pid files from a snapshot.

- [ ] The cloud setup script and `ensureDockerRunning()` (see E) delete
      `/var/run/docker.pid` and `/var/run/docker/containerd/containerd.pid` when their pid
      is not a `dockerd` or `containerd` process, before they start `dockerd`.

## Verification used

```bash
# bypass login without a Turnstile token → "Bot verification failed"
curl -s -X POST http://localhost:3000/login -d email=test@carbon.ms
# type generation through Docker Hub → "Database types refreshed"
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io pnpm db:types
```
