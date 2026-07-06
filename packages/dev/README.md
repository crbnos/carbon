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
| `crbn remove` | Multi-select worktrees to delete (concurrent teardown with progress). |
| `crbn remove --prune` | Also delete the git branch after removing each worktree. |

### Stack

| Command | Description |
|---|---|
| `crbn up` | Boot compose stack + apps. |
| `crbn up --no-portless` | Localhost mode: fixed ports (API `:54321`, ERP `:3000`, MES `:3001`). |
| `crbn up --borrow` | Reuse another worktree's running containers (DB, API, etc). |
| `crbn up --no-apps` | Services only (postgres, kong, supabase, inngest, mail). |
| `crbn up --no-migrate` | Skip database migrations. |
| `crbn up --no-regen` | Skip type/swagger regeneration. |
| `crbn up --pull` | Force `docker compose pull` even if images exist locally. |
| `crbn down` | Stop stack (volumes preserved). |
| `crbn reset` | Wipe volumes + flush redis db, then `up`. |
| `crbn status` | Port assignment + container health. |
| `crbn migrate` | Apply DB migrations against the running stack. |

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
