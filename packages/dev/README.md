# crbn — Carbon Dev CLI

Per-worktree development environment manager. Each worktree gets its own compose stack (postgres, kong, supabase, inngest, inbucket), port allocation, redis db, and JWT credentials.

## Setup

```bash
source ./setup.sh   # adds crbn to PATH + installs shell wrapper
```

## Commands

### Worktrees

| Command | Description |
|---|---|
| `crbn checkout <branch>` | Switch into worktree for `<branch>`. Creates one if missing (auto-fetches from origin). |
| `crbn checkout -b <branch>` | Create new branch + worktree from `--base` (default HEAD). |
| `crbn checkout <pr-number>` | Fetch PR head from GitHub into `pr-<num>` branch + worktree. |
| `crbn checkout main` | cd into the main checkout (never creates a separate worktree). |
| `crbn new [branch]` | Interactive worktree creation. Optional branch name pre-fills the prompt. |
| `crbn list` | Show all worktrees with stack status. |
| `crbn list --json` | The same list as JSON, for scripts and agents. |
| `crbn remove` | Multi-select worktrees to delete (concurrent teardown with progress). |
| `crbn remove <branch-or-path...>` | Remove the named worktrees without the picker (`CARBON_DEV_YES=1` skips the confirmation). |
| `crbn remove --prune` | Also delete the git branch after removing each worktree. |
| `crbn prune` | Destroy stacks no worktree can reach: slots whose directory is gone, and stacks with no slot. Lists them and confirms first; volumes are wiped. |
| `crbn prune --all` | Destroy every crbn stack on the machine, running ones included. Worktrees, branches and live slots are kept; the next `crbn up` rebuilds the database. |
| `crbn prune --tree` | Also clean up git worktrees: forget ones whose directory is gone. With `--all`, remove this repo's linked worktrees too. The main checkout, the current worktree, and any with uncommitted changes or a detached HEAD are kept; branches are never deleted. |

### Stack

| Command | Description |
|---|---|
| `crbn up` | Boot compose stack + apps. Picker includes opt-in apps: Assembler, Email previews (react-email server for every email template at `email.<branch>.dev`), Studio (the Supabase dashboard at `studio.<branch>.dev`, with the Postgres-Meta it reads through). |
| `crbn up --all` | Launch all apps without the picker (ERP, MES, email previews, Studio; assembler when its OCCT build exists). |
| `crbn up --no-portless` | Localhost mode: fixed ports (API `:54321`, ERP `:3000`, MES `:3001`). |
| `crbn up --borrow` | Reuse another worktree's running containers (DB, API, etc). |
| `crbn up --no-apps` | Services only (postgres, kong, supabase, inngest, mail). |
| `crbn up --full` | Also start Studio, Postgres-Meta, the edge runtime and imgproxy (HEIC conversion). They are off by default; `crbn reload studio` or `crbn reload imgproxy` starts one on a running stack. |
| `crbn up --no-hibernate` | Keep everything up. By default the containers stop after 30 min without ERP/MES traffic (the next request wakes them in about 8 s), and the dev servers stop after 2 h (that wake takes about 40 s). `CRBN_IDLE_MINUTES` and `CRBN_APPS_IDLE_MINUTES` change the waits. |
| `crbn up --no-migrate` | Skip database migrations. |
| `crbn up --no-regen` | Skip type/swagger regeneration. |
| `crbn up --pull` | Force `docker compose pull` even if images exist locally. |
| `crbn down` | Stop stack (volumes preserved). |
| `crbn reset` | Wipe volumes + flush redis db, then `up`. |
| `crbn status` | Port assignment + container health. |
| `crbn status --json` | The slot and containers as JSON, for scripts and agents. |
| `crbn migrate` | Apply DB migrations against the running stack. |

`CARBON_DEV_APPS` skips the picker: `CARBON_DEV_APPS=erp,mes,email crbn up`.
Comma-separated, from `erp`, `mes`, `assembler`, `email`, `studio` — unrecognized names
are dropped silently. Shell-level only; it is not read from `.env.local`.

### Files

| Command | Description |
|---|---|
| `crbn copy <file...>` | Copy file(s) from main checkout into current worktree. |
| `crbn env sync` | Sync files listed in `package.json#crbn.copy` from main checkout. |

## Portless vs Localhost

By default, `crbn up` uses [portless](https://github.com/nicholasgasior/portless) for `.dev` TLS URLs (e.g. `https://erp.dev.dev`). Pass `--no-portless` (or set `CARBON_PORTLESS=0`) for localhost mode with fixed ports:

| Service | Port |
|---|---|
| Supabase API (Kong) | `54321` |
| ERP | `3000` |
| MES | `3001` |

OAuth redirect URIs in localhost mode use `http://localhost:54321/auth/v1/callback`.

`pnpm dev` defaults to `crbn up --no-portless`.

## Project naming

Compose projects are prefixed `carbon-<slug>` (e.g. `carbon-feature-foo`). The slug is derived from the worktree directory name and persisted in `.carbon-worktree`.
