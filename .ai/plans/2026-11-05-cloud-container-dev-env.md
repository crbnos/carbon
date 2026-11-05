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

### A. A real off switch for bot protection

- [ ] Add `none` to the `BOT_PROTECTION` enum in `packages/env/src/schema.ts`.
- [ ] Make `resolveBotProtection()` return `null` for `none`.
- [ ] If `IS_LOCAL_DEV` is false, log a warning at boot when the value is `none`.
      Today an unset key pair already turns the check off, so `none` adds no new exposure.
- [ ] Decide where dev gets the value:
      - Option 1 (recommended): `crbn up` writes `BOT_PROTECTION=none` into `.env.local`.
        Every local stack then lets `DEV_BYPASS_EMAIL` and agent logins through. A
        developer who wants the Turnstile widget pins `BOT_PROTECTION=turnstile #force`
        in `.env`.
      - Option 2: keep local Turnstile by default. Only the cloud setup script sets
        `BOT_PROTECTION=none` in `.env`.
- [ ] Update `.env.example`, `environment-configuration.md`, `authentication-system.md`
      and the prerequisites of the `/auth` skill.
- [ ] Add 2 tests to `bot-protection.test.ts`: `none` returns `null`, and a
      `DEV_BYPASS_EMAIL` login succeeds with it.

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

## Verification used

```bash
# bypass login without a Turnstile token → "Bot verification failed"
curl -s -X POST http://localhost:3000/login -d email=test@carbon.ms
# type generation through Docker Hub → "Database types refreshed"
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io pnpm db:types
```
