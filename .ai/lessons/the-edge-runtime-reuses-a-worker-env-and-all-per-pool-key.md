---
paths: []
triggers: []
promoted: null
---
# The edge runtime reuses a worker, env and all, per pool key

**Context:** One shared `supabase/edge-runtime` serving every worktree, with the
dispatcher (`packages/dev/docker/edge-main/index.ts`) passing each request's
worktree API as `SUPABASE_URL` in `EdgeRuntime.userWorkers.create({ envVars })`.

**Problem:** The runtime keeps a live worker per pool key and returns it for the
next `create` with the same key (`crates/base/src/worker/pool.rs`). The key
defaults to the service path, so a worker created with worktree A's env would
serve worktree B's next request with A's `SUPABASE_URL`. Nothing errors.

**Rule:** A dispatcher that varies `envVars` per request must pass `poolKey` that
includes every value that varies (here `${api} ${servicePath}`).

**Applies to:** `packages/dev/docker/edge-main/index.ts` and any other
`--main-service` dispatcher.
