<div align="center">
  <a href="https://carbon.ms">
    <img width="auto" height="100" alt="Carbon Logo" src="https://github.com/user-attachments/assets/177634ca-5c37-43e2-8d55-1b9f490866d5" />
  </a>

  <h3 align="center">Carbon</h3>

  <p align="center">
    The open core for manufacturing.
    <br />
    ERP · MES · QMS — API-first, extensible, yours.
    <br />
    <br />
    <a href="https://carbon.ms"><strong>Website</strong></a> ·
    <a href="https://docs.carbon.ms"><strong>Documentation</strong></a> ·
    <a href="https://discord.gg/yGUJWhNqzy"><strong>Discord</strong></a> ·
    <a href="https://github.com/orgs/crbnos/projects/1/views/1"><strong>Roadmap</strong></a>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/TypeScript-000000?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/React-000000?style=flat-square&logo=react&logoColor=white" alt="React" />
    <img src="https://img.shields.io/badge/Supabase-000000?style=flat-square&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/License-AGPL--3.0-000000?style=flat-square" alt="License" />
  </p>
</div>

<br />

![ERP Screenshot](https://github.com/user-attachments/assets/2e09b891-d5e2-4f68-b924-a1c8ea42d24d)

![MES Screenshot](https://github.com/user-attachments/assets/b04f3644-91aa-4f74-af8d-6f3e12116a6b)

<br />

## Contents

- [Why Carbon](#why-carbon)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Monorepo](#monorepo)
- [Getting Started](#getting-started)
- [Local Dev CLI (`crbn`)](#local-dev-cli-crbn)
- [Environment Variables](#environment-variables)
- [Logging In](#logging-in)
- [Commands](#commands)
- [API](#api)
- [Migration Notes](#migration-notes)

<br />

## Why Carbon

We built Carbon after years of building end-to-end manufacturing systems with off-the-shelf solutions. We realized that:

- Modern, API-first tooling didn't exist
- Vendor lock-in bordered on extortion
- There is no "perfect ERP" because each company is unique

We built Carbon to solve these problems ☝️

<br />

## Features

|                    |                                                     |
| ------------------ | --------------------------------------------------- |
| **ERP**            | Sales, purchasing, inventory, items, accounting     |
| **MES**            | Shop floor execution and job operations             |
| **QMS**            | Inspections, non-conformances, CAPAs                |
| **MRP**            | Material requirements planning                      |
| **Traceability**   | Full lot and serial tracking                        |
| **Nested BoM**     | Multi-level bills of material                       |
| **Configurator**   | Product configuration                               |
| **Capacity Planning** | Scheduling against real resource capacity       |
| **Custom Fields**  | Extend any record                                   |
| **API & Webhooks** | Build your own apps on top of Carbon                |
| **MCP Client/Server** | AI-native integration surface                   |
| **Accounting**     | GL, journals, and third-party sync                  |

See the [full roadmap](https://github.com/orgs/crbnos/projects/1/views/1) for what's next (up next: Simulation).

**Technical highlights**

- Unified auth and permissions across apps
- Full-stack type safety (Database → UI)
- Realtime database subscriptions
- Attribute-based access control (ABAC)
- Role-based access control (Customer, Supplier, Employee)
- Row-level security (RLS)
- Composable user groups
- Dependency graph for operations
- Third-party integrations

<br />

## Architecture

Carbon is designed to make it easy for you to extend the platform by building your own apps through our API. We provide some examples to get you started in the [examples](https://github.com/crbnos/carbon/blob/main/examples) folder.

![Carbon Functionality](https://github.com/user-attachments/assets/d73b3297-afb4-4bd4-a381-61b31a78aa38)

![Carbon Architecture](https://github.com/user-attachments/assets/e5532a5f-609c-4404-8706-aa9bd59e180b)

<br />

## Tech Stack

| Layer      | Technology                                                            |
| ---------- | --------------------------------------------------------------------- |
| Framework  | [React Router](https://reactrouter.com)                               |
| Language   | [TypeScript](https://www.typescriptlang.org/)                         |
| Styling    | [Tailwind](https://tailwindcss.com)                                   |
| Behavior   | [Radix UI](https://radix-ui.com)                                      |
| Database   | [Supabase](https://supabase.com) (Postgres + RLS)                     |
| Auth       | [Supabase](https://supabase.com)                                      |
| Cache      | [Redis](https://redis.io)                                             |
| Jobs       | [Inngest](https://inngest.com)                                        |
| Email      | [Resend](https://resend.com)                                          |
| i18n       | [Lingui](https://lingui.dev)                                          |
| Hosting    | [Vercel](https://vercel.com)                                          |
| Billing    | [Stripe](https://stripe.com)                                          |
| Geometry   | [Rust](https://www.rust-lang.org) (FCL collision + OpenCASCADE CAD)   |

<br />

## Monorepo

The monorepo follows the Turborepo convention of grouping packages into two folders:

```
carbon
├── apps         # applications
└── packages     # shared code
```

### `/apps`

| App         | Description                                                    | How to run                                          |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------- |
| `erp`       | ERP application                                                 | `pnpm dev` (boots stack + ERP via `crbn up` picker) |
| `mes`       | MES — shop floor                                                | `pnpm dev` (select MES in picker, or both)          |
| `academy`   | Training                                                        | `pnpm dev:academy`                                  |
| `starter`   | Example app built on the API                                    | `pnpm dev:starter`                                  |
| `assembler` | Geometry service (Rust): STEP → GLB + assembly motion planning | spawned by `crbn up` (needs a release binary — see [Optional: assembler](#optional-the-assembler-geometry-service)) |

`pnpm dev` runs the per-worktree dev CLI (`crbn up`). ERP and MES are first-class — the CLI boots the docker stack, applies migrations, regenerates types/swagger, and spawns the selected apps behind portless. The `assembler` geometry service is spawned too when its release binary is present. Academy and starter are standalone Turborepo entries.

### `/packages`

| Package             | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `@carbon/database`  | Database schema, migrations and types                                       |
| `@carbon/documents` | Transactional PDFs and email templates                                      |
| `@carbon/ee`        | Integration definitions and configurations                                  |
| `@carbon/config`    | Shared configuration (vitest, tsconfig, tailwind) across apps and packages  |
| `@carbon/jobs`      | Background jobs and workers                                                 |
| `@carbon/logger`    | Shared logger used across apps                                              |
| `@carbon/react`     | Shared web-based UI components                                              |
| `@carbon/kv`        | Redis cache client                                                          |
| `@carbon/lib`       | Third-party client libraries (slack, resend)                                |
| `@carbon/stripe`    | Stripe integration                                                          |
| `@carbon/utils`     | Shared utility functions used across apps and packages                      |

<br />

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/desktop/install/mac-install/) — the monorepo uses Docker for local development
- [Node.js](https://nodejs.org) v22 (via `nvm`)
- [pnpm](https://pnpm.io) (via Corepack — see below; never `npm`)

You'll also want accounts with the following external services:

| Service                                              | Purpose                    |
| ---------------------------------------------------- | -------------------------- |
| [Posthog](https://us.posthog.com/signup)             | Product analytics platform |
| [Stripe](https://dashboard.stripe.com/login)         | Payments service           |
| [Resend](https://resend.com)                         | Email service              |

Posthog has a free tier which should be plenty to support local development. If you're self hosting and you don't want to use Posthog, it's pretty easy to remove the analytics.

### Clone

Clone the repo into a public GitHub repository (or fork https://github.com/crbnos/carbon/fork). If you want to make the repo private, you should [acquire a commercial license](https://carbon.ms/sales) to comply with the AGPL license.

```bash
git clone https://github.com/crbnos/carbon.git
cd carbon
```

### Install

This repo uses **pnpm** as its package manager. Enable Corepack so the correct pnpm version (pinned via `packageManager` in `package.json`) is used automatically:

```bash
corepack enable    # one-time: activates pnpm shim from packageManager field
nvm use            # use node v22
pnpm install       # install dependencies
```

The dev stack (Postgres, GoTrue, Kong, Storage, Inngest, Inbucket, Studio, Realtime) is booted later by `crbn up` — see [Local Dev CLI](#local-dev-cli-crbn) below. There is no separate "start the database" step.

<details>
<summary><h3>Optional: the <code>assembler</code> geometry service</h3></summary>

`assembler` is a Rust service (STEP → GLB + assembly motion planning) over C++ FCL and OpenCASCADE. ERP/MES run fine without it — set it up only if you need the 3D `/convert` and `/plan` endpoints.

1. **Toolchain + native build deps** (macOS):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust, if not already installed
   brew install fcl cmake ninja draco                               # collision libs (+ libccd/eigen/octomap), build tools, Draco mesh compression
   ```

   On Linux, install the equivalents from your package manager: `libfcl-dev libccd-dev libeigen3-dev liboctomap-dev libdraco-dev cmake ninja-build` plus a C/C++ toolchain.

   `./setup.sh` already installs Draco on macOS. If yours lives outside the Homebrew keg (`/opt/homebrew/opt/draco` on arm64), point `draco-bridge`'s build at it with `DRACO_PREFIX=/path/to/draco cargo build`.

2. **Build OCCT once** — a patched static OpenCASCADE, cached in `~/.cache/carbon-occt`. Slow (~15–30 min) but one-time per machine; re-running is a no-op once cached:

   ```bash
   ./apps/assembler/scripts/build-occt.sh
   ```

3. **Build the service** — seconds once OCCT is cached (`build.rs` finds it automatically):

   ```bash
   cargo build --release -p assembler
   ```

`crbn up` spawns the binary when it's present. Verify it's up with `curl -sf "$ASSEMBLER_SERVICE_URL/health"` (the URL is in your worktree's `.env.local`) or by watching the `asm |` lines in the `crbn up` output. Without the binary the rest of the stack still runs — only `/convert` and `/plan` are unavailable.

</details>

<br />

## Local Dev CLI (`crbn`)

[![](https://cdn.loom.com/sessions/thumbnails/690e6a4ec1c24216b56a22aa2667ba51-ee9275cabb59a0aa-full-play.gif#t=0.1)](https://www.loom.com/embed/690e6a4ec1c24216b56a22aa2667ba51)

`crbn` is a small CLI at `packages/dev/bin/crbn` that wraps two things:

- **Git worktrees** — every feature branch can live in its own checkout dir, so you can switch branches without stashing.
- **Per-worktree docker compose stack** — each worktree gets its own Postgres / Supabase services on dynamic ports, isolated under a `carbon-<slug>` compose project. Routing is handled by [portless](https://github.com/portless-dev/portless) (a local HTTPS reverse proxy that serves `*.dev` hostnames on `:443` with locally-trusted certs — installed automatically on first `crbn up`).

> **Windows users:** the dev CLI (`crbn`, `setup.sh`) is POSIX-only and expects **WSL or Git Bash**. Native cmd.exe / PowerShell shells are not supported. From a WSL/Git Bash prompt, the standard flow (`./setup.sh`, `pnpm dev`, `crbn checkout …`) works the same as on macOS/Linux.

Run `setup.sh` once to put `crbn` on your `$PATH` and install the `crbn` shell function (so `crbn checkout` can change cwd):

```bash
./setup.sh                   # writes a sentinel block to ~/.zshrc or ~/.bashrc
source ~/.zshrc              # or open a new shell
crbn                         # shows commands
```

Common flows:

```bash
crbn checkout sid/cool-thing       # cd into worktree (creates if missing,
                                   # auto-fetches from origin if needed)
crbn checkout -b feat/new-thing    # new branch off origin/main + worktree
crbn checkout sid/cool-thing --up  # …and boot the stack inside it
crbn checkout 760                  # fetch GitHub PR #760 into a `pr-760`
                                   # branch + worktree (fork PRs work too)
crbn copy                          # re-sync .env from main checkout
crbn up | down | reset | status    # per-worktree compose stack
crbn new | list | remove           # interactive worktree management
```

`crbn up` flags:

- `--no-migrate` — skip `supabase migration up` (use when schema is already current and you just want to re-boot containers fast)
- `--no-regen` — skip regenerating `packages/database/src/types.ts` + `swagger-docs-schema.ts` (auto-skipped when `--no-migrate` is set, since no schema change implies no type drift)

Files synced by `crbn copy` are listed under `package.json#crbn.copy` (defaults to `[".env"]`). To uninstall the rc block: `./setup.sh --uninstall`.

<br />

## Environment Variables

Create an `.env` file and copy the contents of `.env.example` into it:

```bash
cp ./.env.example ./.env
```

Then configure each service:

<details>
<summary><strong>1. Social Sign In</strong></summary>

Signing in requires you to set up one of two methods:

- Email requires a Resend API key (you'll set this up later on)
- Sign-in with Google requires a Google auth client with these variables. [See the Supabase docs for instructions on how to set this up](https://supabase.com/docs/guides/auth/social-login/auth-google):
  - Set `Authorized JavaScript origins` to `https://api.carbon.dev`
  - Set `Authorized redirect URIs` to `https://api.carbon.dev/auth/v1/callback`
  - **About the two API URLs you'll see:** each worktree has its own scoped Supabase URL (`https://<worktree>.api.dev`) for app traffic, **and** there is one stable alias `https://api.carbon.dev` registered on whichever worktree is currently `up`. The stable alias exists only so OAuth callbacks have a single registered redirect URI — one Google Console entry covers every worktree. Day-to-day, your app talks to its worktree-scoped URL; only the OAuth callback hits the stable alias.
- You should set environment variables like the following:
  - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID="******.apps.googleusercontent.com"`
  - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET="GOCSPX-****************"`

</details>

<details>
<summary><strong>2. Supabase</strong></summary>

Backend services run inside the per-worktree docker stack — `crbn up` boots them and writes everything you need into `.env.local` automatically:

- `SUPABASE_URL` — portless alias (e.g. `https://local-dev.api.dev`)
- `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — keys minted per-worktree from a random `SUPABASE_JWT_SECRET`
- `SUPABASE_DB_URL` — direct Postgres URL on a dynamic port

`.env.local` is generated; do not commit it or hand-edit values that came from `crbn up` (they are re-derived on each boot). Put genuine secrets (OAuth client IDs, Stripe keys, Resend) in `.env` only.

Run `crbn status` at any time to see the live port assignment and the URLs portless is serving.

</details>

<details>
<summary><strong>3. Redis (caching)</strong></summary>

No setup needed for local dev — `crbn up` boots a shared Redis container and writes `REDIS_URL` into `.env.local` automatically (each worktree gets its own logical Redis DB). For self-hosted production, set `REDIS_URL` to any Redis-compatible endpoint (Upstash, AWS ElastiCache, etc.) in your prod environment.

</details>

<details>
<summary><strong>4. Posthog (analytics)</strong></summary>

In Posthog go to `https://[region].posthog.com/project/[project-id]/settings/project-details` to find your Project ID and Project API key:

- `POSTHOG_API_HOST=[https://[region].posthog.com]`
- `POSTHOG_PROJECT_PUBLIC_KEY=[Project API Key starting 'phc*']`

</details>

<details>
<summary><strong>5. Stripe (payments)</strong></summary>

[Create a Stripe account](https://dashboard.stripe.com/login), add a `STRIPE_SECRET_KEY` from the Stripe `Settings > Developers` interface:

- `STRIPE_SECRET_KEY="sk_test_*************"`

</details>

<details>
<summary><strong>6. Resend (email)</strong></summary>

[Create a Resend account](https://resend.com) and configure:

- `RESEND_API_KEY="re_**********"`
- `RESEND_DOMAIN="carbon.ms"` (or your domain, no trailing slashes or protocols)
- `RESEND_AUDIENCE_ID="*****"` (Optional — required for contact management in `packages/jobs`)

Resend is used for transactional emails (user invitations, email verification, onboarding). All three variables are stored in `packages/auth/src/config/env.ts`.

</details>

<br />

Finally, boot the stack and the apps:

```bash
pnpm dev                # equivalent to `crbn up` — picker lets you choose ERP/MES
```

`crbn up` prints a summary box with the live URLs once the stack is healthy. Defaults look like:

| Surface         | URL                                                            |
| --------------- | -------------------------------------------------------------- |
| ERP             | `https://<worktree>.erp.dev`                                   |
| MES             | `https://<worktree>.mes.dev`                                   |
| Supabase API    | `https://<worktree>.api.dev`                                   |
| Supabase Studio | `https://<worktree>.studio.dev`                                |
| Inngest         | `https://<worktree>.inngest.dev`                               |
| Mail (Inbucket) | `https://<worktree>.mail.dev`                                  |
| Postgres        | `postgresql://postgres:postgres@localhost:<PORT_DB>/postgres`  |

`<worktree>` is derived from the branch name (e.g. `sid-local-dev` → `local-dev`). The main checkout drops the prefix and just uses `erp.dev`, `mes.dev`, etc. Ports for raw TCP services (Postgres, Inbucket, Inngest) are dynamic per-worktree — `crbn status` is the source of truth.

Academy and starter still run on classic localhost ports via `pnpm dev:academy` / `pnpm dev:starter` (they are not part of the per-worktree stack).

<br />

## Logging In

For local development you don't need email or OAuth configured. `crbn up` seeds a smoke-test user (`test@carbon.ms`) and writes `DEV_BYPASS_EMAIL=test@carbon.ms` into `.env.local` for you. When that bypass email is set, signing in with it skips the magic link and logs you straight into the ERP:

1. Open the ERP at the URL from the `crbn up` summary (e.g. `https://<worktree>.erp.dev/login`).
2. Type `test@carbon.ms` into the email field.
3. Click **Sign in with Email**.

You'll land on the authenticated dashboard (`/x`) — no inbox check required. The same session cookie works for the MES app at `https://<worktree>.mes.dev`.

> The bypass only applies to the exact address in `DEV_BYPASS_EMAIL` and only when that user is active — it's a dev convenience, not present in production. Any other email falls back to the normal magic-link / verification flow (which needs Resend configured). To sign in as your own account instead, use the magic link and read it from the local mail catcher at `https://<worktree>.mail.dev`.

<br />

## Code Formatting

This project uses [Biome](https://biomejs.dev/) for code formatting and linting. To set up automatic formatting on save in VS Code:

1. Install the [Biome VS Code extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)
2. Add the following to your VS Code settings (`.vscode/settings.json` or global settings):

```json
"editor.codeActionsOnSave": {
  "source.organizeImports.biome": "explicit",
  "source.fixAll.biome": "explicit"
},
"editor.defaultFormatter": "biomejs.biome"
```

<br />

## Commands

| Command                        | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `pnpm dev`                     | Boot the stack + apps (`crbn up` picker)                           |
| `pnpm run db:function:new <name>` | Add an edge function                                            |
| `pnpm run db:migrate:new <name>`  | Add a database migration                                        |
| `pnpm run agent:new <name>`    | Add an AI agent                                                    |
| `pnpm run tool:new <name>`     | Add an AI tool                                                     |
| `crbn down`                    | Stop the stack (keeps volumes — data preserved)                    |
| `crbn reset`                   | Wipe the stack and start clean (destroys Postgres volume + flushes the redis db for this worktree) |
| `pnpm db:types`                | Regenerate types → `packages/database/src/types.ts` + `functions/lib/types.ts` (normally `crbn up` does this after applying migrations) |
| `pnpm generate:swagger`        | Regenerate swagger → `packages/database/src/swagger-docs-schema.ts` |
| `pnpm --filter <pkg> <cmd>`    | Run a command against a single workspace, e.g. `pnpm --filter @carbon/react test` |

### Restoring a production snapshot

To restore a production database snapshot locally, use `crbn restore`. It handles both plain-text `.backup` and custom-format `.dump` archives, drops and rebuilds the public schema, realigns internal sequences, resets storage metadata, then applies any migrations the backup predates and regenerates types.

1. Export a backup from your production Supabase project (`pg_dump` or Supabase Dashboard → Database → Backups).
2. Run it from your worktree root:

   ```bash
   crbn restore /path/to/db_cluster.backup
   # …or for .dump archives:
   crbn restore /path/to/postgres_YYYYMMDD.dump
   ```

   It prompts before replacing the database. The stack must already be running (`crbn up`) — a restore rewrites the `auth` and `storage` schemas, which GoTrue and Storage build through their own migrations when those containers boot, so `crbn restore` refuses rather than restore into an uninitialized stack.

   To also get local admin access, pass your production email — your account is upgraded to Admin in the companies it already belongs to and the password is reset locally:

   ```bash
   crbn restore /path/to/backup.backup --admin-email you@example.com
   # Optional: set a custom local password (default: localpass)
   crbn restore /path/to/backup.backup --admin-email you@example.com --admin-password mypass
   ```

   Useful flags: `--no-scrub-emails` keeps real addresses (see the warning below), `--mode prod` restores exactly as-is without localizing config/webhooks/integrations, `--no-migrate` / `--no-regen` skip the trailing steps, `--yes` skips the prompt.

   > **Emails are scrubbed by default** — every address is rewritten to `@example.test` (your `--admin-email` is preserved so you can still log in). If you pass `--no-scrub-emails`, real production addresses will be present in the local DB; ensure local email sending is disabled or pointed at a sandbox (e.g. Mailpit) before triggering any email flows.
   >
   > **Note:** `storage.objects` is truncated by default, so a restore does not populate local file storage — kept rows would reference files that only exist in the source environment's backend. Pass `--keep-storage-objects` to retain the metadata (and the backup's buckets) anyway; downloads will still 404, but the rows are there for work that needs realistic storage volume.

The underlying script, `scripts/restore-database.sh`, can still be invoked directly — it takes the same options as environment variables (`SCRUB_EMAILS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RESTORE_MODE`), but note it defaults to **not** scrubbing emails and leaves the trailing `pnpm db:migrate` / `pnpm db:types` to you.

<br />

## API

The API documentation is located in the ERP app at `${ERP}/x/api/js/intro`. It is auto-generated based on changes to the database.

There are two ways to use the API:

1. From another codebase using a supabase client library — [JavaScript](https://supabase.com/docs/reference/javascript/introduction), [Flutter](https://supabase.com/docs/reference/dart/introduction), [Python](https://supabase.com/docs/reference/python/introduction), [C#](https://supabase.com/docs/reference/csharp/introduction), [Swift](https://supabase.com/docs/reference/swift/introduction), [Kotlin](https://supabase.com/docs/reference/kotlin/introduction)
2. From within the codebase using our packages

### From another codebase

First, set up the necessary credentials in environment variables. For the example below:

1. Navigate to settings in the ERP to generate an API key. Set this in `CARBON_API_KEY`.
2. Get the Supabase URL to call (this is `SUPABASE_URL` in your `.env` if hosting locally, e.g. http://localhost:54321). Set this as `CARBON_API_URL`.
3. Get the `SUPABASE_ANON_KEY` e.g. from your `.env` file. Set this as `CARBON_PUBLIC_KEY`.

If you're self-hosting you can also use the supabase service key instead of the public key for root access. In that case you don't need to include the `carbon-key` header.

```ts
import { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";

const apiKey = process.env.CARBON_API_KEY;
const apiUrl = process.env.CARBON_API_URL;
const publicKey = process.env.CARBON_PUBLIC_KEY;

const carbon = createClient<Database>(apiUrl, publicKey, {
  global: {
    headers: {
      "carbon-key": apiKey,
    },
  },
});

// returns items from the company associated with the api key
const { data, error } = await carbon.from("item").select("*");
```

### From the monorepo

```tsx
import { getCarbonServiceRole } from "@carbon/auth/client.server";
const carbon = getCarbonServiceRole();

// returns all items across companies
const { data, error } = await carbon.from("item").select("*");

// returns items from a specific company
const companyId = "xyz";
const { data, error } = await carbon
  .from("item")
  .select("*")
  .eq("companyId", companyId);
```

<br />

## Migration Notes

<details>
<summary><strong>Trigger.dev → Inngest</strong></summary>

Background jobs have been migrated from [Trigger.dev](https://trigger.dev) to [Inngest](https://inngest.com). Key changes:

- **Job definitions** moved from `packages/jobs/trigger/` to `packages/jobs/src/inngest/functions/`
- **Triggering jobs** from app code uses `trigger()` and `batchTrigger()` from `@carbon/jobs` instead of `tasks.trigger()` from `@trigger.dev/sdk`
- **Inngest dev server** runs via `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
- **Environment variables**: `TRIGGER_SECRET_KEY`, `TRIGGER_API_URL`, and `TRIGGER_PROJECT_ID` are no longer needed. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` instead (not required for local dev).

</details>

<details>
<summary><strong>Upstash → Local Redis</strong></summary>

The caching layer (`@carbon/kv`) no longer depends on Upstash. A standard Redis instance is used instead. The `REDIS_URL` environment variable still applies, but you can point it at any Redis-compatible server (including a local Docker container).

</details>

<details>
<summary><strong>Supabase CLI → docker compose (<code>crbn</code>)</strong></summary>

Local dev no longer relies on `supabase start` / `supabase stop`. The full backend stack (Postgres 15, GoTrue, Kong, Storage, Realtime, Studio, Inngest, Inbucket, edge-runtime) runs from `packages/dev/docker/docker-compose.dev.yml` under a per-worktree compose project (`carbon-<slug>`), managed by `crbn up` / `down` / `reset`. Ports are allocated dynamically per worktree so multiple branches can run side-by-side. Key changes:

- `pnpm db:start` / `db:stop` / `db:kill` / `db:build` are removed — use `crbn up` / `down` / `reset`.
- `.env.local` is generated by `crbn up` (worktree-specific URLs, ports, JWT secret, anon/service keys). Genuine secrets stay in `.env`.
- `pnpm db:migrate` now drives `supabase migration up --db-url $SUPABASE_DB_URL`; it falls back to the CLI's linked-project mode when `SUPABASE_DB_URL` is unset.
- `pnpm db:types` generates types directly from `$SUPABASE_DB_URL` (no `supabase gen types --local`).

</details>

<br />

<div align="center">
  <sub>
    Built by the <a href="https://carbon.ms">Carbon</a> team ·
    <a href="https://discord.gg/yGUJWhNqzy">Join the Discord</a>
  </sub>
</div>
