# Spec: Run the scheduling engine in-process (Node), not via the `schedule` edge function

Date: 2026-08-19
Status: In design → executing
Owner: (agent, on Brad's request)

## Problem

Every schedule regeneration in the app goes through the Supabase **edge function**
`schedule` (`packages/database/supabase/functions/schedule/index.ts`) via
`serviceRole.functions.invoke("schedule", …)`. Observed: clicking the new
**Regenerate** button on the production Forecast takes **>2s even with almost no
data**, and can momentarily show an empty board.

Root cause of the latency is structural, not data volume:

- **Edge cold start + HTTP round-trip.** The app (Node) makes an HTTP call to the
  Deno edge runtime, which cold-starts an isolate and opens its own PG pool.
- **Memory limits.** Edge isolates are memory-constrained; a whole-location
  finite-scheduling pass is the wrong workload for that runtime.

The empty-board flash is a *consequence* of the same design: the caller fires the
invoke and revalidates the loader; when the invoke is slow/errors, the page reads
mid/post-regen state and the error is swallowed by the fetcher.

## Goal

Run the scheduling engine **in-process in Node** wherever the app or background
jobs trigger it, eliminating the edge cold-start + HTTP hop. Same engine, same
determinism, same outputs — just executed locally.

## Key discovery (why this is low-risk)

The engine and its whole transitive import graph are **already Node-compatible**:

- `packages/database/supabase/functions/lib/postgres/index.ts` is **explicitly
  dual-runtime** (branches on `typeof Deno !== "undefined"`; Node uses
  node-`pg`, Deno uses deno-postgres).
- `…/lib/database.ts` imports `pg` "so it can be imported as-is in Node".
- `@carbon/database` **already re-exports** scheduling-lib files into Node with
  **no build step** (`packages/database/src/scheduling.ts` →
  `../supabase/functions/lib/scheduling/*.ts`), consumed today by
  `apps/erp/app/modules/production/forecastCalendar.server.ts`. The `.ts`
  extension deep-imports resolve fine under Vite/esbuild.
- The engine constructor takes `client` (SupabaseClient) and `db`
  (`Kysely<DB>`) as **parameters** — it does not import the pool factory, so
  `pg` never enters the engine's value-import graph.

The **only** Node blocker in the entire graph is one line:
`…/lib/logging.ts` calls `Deno.env.get("LOG_LEVEL")` unguarded (imported solely
by `scheduling-engine.ts`). `@logtape/*` (which `logging.ts` uses) is
runtime-agnostic and already in the pnpm catalog (`@carbon/logger` uses it in
Node); it is simply not yet a declared dependency of `packages/database`.

## Approach

1. **Extract the orchestration** currently inside the edge function's `serve()`
   handler (job query + deterministic sort + expedite handling + sequential
   per-job engine loop + result aggregation) into a shared, runtime-neutral
   function `runLocationSchedule(opts)` in
   `…/lib/scheduling/run-schedule.ts`. It takes `{ db, client, locationId,
   companyId, userId, expediteJobId? }` and returns the same shape the edge
   function returns (`{ locationId, jobsScheduled, conflictsDetected, newlyLate }`
   or `{ expedite }`).

2. **Make `logging.ts` dual-runtime** — guard the `Deno.env` read, fall back to
   `process.env.LOG_LEVEL` in Node. Add `@logtape/logtape` + `@logtape/redaction`
   to `packages/database` dependencies (catalog).

3. **Node bridge** — re-export `runLocationSchedule` (+ result types) from
   `@carbon/database/scheduling`.

4. **Edge function becomes a thin wrapper** — `schedule/index.ts` keeps its
   `serve` + `requirePermissions` + CORS, and delegates to
   `runLocationSchedule`. One orchestration, zero drift. The function stays
   deployed (config.toml unchanged) so nothing external breaks and self-hosted
   deploys are unaffected — but the app/jobs no longer call it.

5. **Repoint every in-app caller** from `invoke("schedule", …)` to a direct
   `runLocationSchedule` call, passing the Node Kysely client
   (`getDatabaseClient()` in ERP, `getJobDatabaseClient()` in jobs) and a
   service-role SupabaseClient (`getCarbonServiceRole()` — matches the privileged
   execution the edge function did internally). Call sites:
   - `apps/erp/app/routes/api+/schedule.ts` (the Regenerate button)
   - `apps/erp/app/modules/production/production.service.ts`
     (`recalculateJobOperationDependencies`)
   - `apps/erp/app/routes/x+/job+/$jobId.status.tsx`
   - `apps/erp/app/routes/api+/kanban.$id.tsx`
   - `packages/jobs/src/inngest/functions/tasks/recalculate.ts`
   - `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts`
     (the debounced replan wave)

6. **Regenerate button correctness + UX** — surface the `{ success, error }`
   result with a toast (flash) so a failed regen is never silent, and the empty
   flash no longer reads as "no jobs". Because the call is now synchronous
   in-process and awaited before the action returns, the fetcher revalidation
   reads fully-committed state.

## Non-goals

- Changing the scheduling algorithm, determinism, or outputs.
- Deleting the edge function or its `config.toml` entry (kept as a thin wrapper
  for compatibility / self-hosted / any external caller).
- Changing the debounce/marking semantics of the reactive replan wave (only the
  per-location execution swaps HTTP-invoke → in-process call).
- Parallelizing locations in the wave (still sequential; out of scope).

## Risks & mitigations

- **A client bundle accidentally pulls in `pg`/@logtape.** Mitigated: every new
  importer is server-only (route actions, `*.service.ts`, `*.server.ts`, jobs).
  `production.service.ts` already imports `.server` modules, so it is already
  excluded from client bundles; adding another server-only import is consistent.
  Verified by a full `erp` build.
- **`@logtape` not resolvable from `packages/database` at runtime.** Mitigated by
  adding it to that package's dependencies (catalog-pinned).
- **Behavioral drift between edge and Node paths.** Mitigated by extracting ONE
  `runLocationSchedule` both call.
- **Auth.** The edge function's `requirePermissions` is preserved for the edge
  path; the Node path is gated by the route's own `requirePermissions` (ERP) or
  runs as `system` (jobs) — identical to how MRP's manual trigger already works.

## Verification

- `turbo typecheck` for `erp`, `@carbon/jobs`, `@carbon/database`.
- Full `erp` **build** (proves the engine imports resolve through the
  server/client split and no Node lib leaks into the client bundle).
- Existing Deno scheduling unit tests remain valid (engine files untouched;
  only orchestration extracted and one logging line guarded).
- Manual: Regenerate button returns quickly and the board repopulates; a forced
  error shows a toast instead of an empty board.
