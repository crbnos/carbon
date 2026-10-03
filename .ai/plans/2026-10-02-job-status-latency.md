# Job create and job status latency — follow-up for the edge-function removal branch

Findings from production traces (Axiom, week ending 2026-10-02). Nothing here is
implemented. It is written for the branch that ports the edge functions to Node
(`refactor/remove-edge-functions`), because two of the three causes are edge
function calls that branch already removes, and the third lives in code that
branch's `recalculate` / `get-method` ports will call.

## What is slow

| Route | Median | p95 | Where the time goes |
|---|---|---|---|
| `POST /x/job/new` | 2.3 s | 10.5 s | `get-method` edge fn (median 1.2 s, max 6.1 s), then `recalculate` edge fn (median 0.75 s), one after the other |
| `POST /x/job/:jobId/status` (no scheduling) | 1.2–1.8 s | | `recalculate` edge fn (~0.75 s), job MRP (~0.45 s, 14 calls), sequential reads |
| `POST /x/job/:jobId/status?schedule=1` | 10 s | 19 s | `runLocationSchedule` (5–7 s), `create` (`purchaseOrderFromJob`) edge fn (1.1 s, once 7.5 s), recalculate, MRP |

The 7 s outliers on a single `job` read were PostgREST schema-reload holds, fixed
separately (crbnos/carbon#1814).

## Cause 1 — every edge function call costs 0.7–1.4 s

Median call time over a week, whatever the function does:

| Function | Calls | Median | p90 |
|---|---|---|---|
| `recalculate` | 22 | 0.76 s | 0.92 s |
| `get-method` | 17 | 1.29 s | 6.1 s |
| `create` | 13 | 0.91 s | 1.15 s |
| `post-receipt` | 5 | 1.33 s | 3.2 s |
| `issue` | 4 | 1.38 s | 1.44 s |
| `post-purchase-invoice` | 4 | 1.38 s | 1.48 s |

That floor is the HTTP hop plus function start-up at low traffic. Porting these
to Node removes it.

- [ ] After the port, confirm in Axiom that `POST /x/job/new` no longer has two
      sequential ~1 s spans, and that job status changes drop by ~0.75 s.
- [ ] `job/new` runs `get-method` then `recalculate` back to back. Once both are
      in-process, check whether `recalculate` can reuse what `get-method` just
      loaded instead of reading the job's materials again.

## Cause 2 — the scheduler re-plans the whole location, one job at a time

`runLocationSchedule` (`packages/planning/src/scheduling/run-schedule.ts`) loops
over every job at the location and runs a full `SchedulingEngine` pass for each.
Measured on a location with ~23 jobs, one status change issued 47 transactions,
160 `SELECT jobOperation`, 110 `UPDATE jobOperation`, 91 `SELECT jobMakeMethod`
and 69 calls to the `get_job_methods_by_method_id` RPC (1.9 s on its own).

Per job, inside that loop (`scheduling-engine.ts`, line numbers as of this note):

- [ ] **The assembly tree is built three times** — `buildAssemblyTree` at `:265`,
      `:341` and `:838`. Each build reads the root make method and calls the
      RPC. Build it once per job and pass it down: 69 RPC calls become 23.
- [ ] **The job's operations are read seven times** — `provider.getOperations`
      at `:231`, `:336`, `:833`, plus `assembly-handler.ts:38` (reached three
      times through the tree builds) and the cross-job read at `:744`. Later
      steps read after earlier steps write (`:505` sets status, the persist step
      writes placements), so check each read before reusing an earlier result.
- [ ] **Operations are written one row at a time** — the persist loop issues an
      `UPDATE jobOperation` per operation (`:954`), and a second loop sets each
      dependency-free operation to `Ready` (`:505`) outside any transaction.
      Replace each with one set-based statement per job
      (`UPDATE … FROM (VALUES …)`, as `updateSortOrder` does).
- [ ] **The location's timezone is read for every job** — `getLocationTimeZone`
      at `:218`. Read it once per run.
- [ ] **Work-center availability misses its cache on most jobs** — it is keyed by
      the job's candidate work-center set (`master-data-provider.ts`
      `getWorkCenterAvailability`), about 14 distinct sets for 23 jobs. Load the
      location's work centers, shifts and maintenance once per run and filter in
      memory.
- [ ] **Live capacity reservations are fetched per job** (`getLiveReservations`),
      never cached.

The existing scheduling-engine tests pin the result; these changes must not
alter it.

- [ ] Decide separately whether re-planning the location has to finish before
      the redirect. Running it as a background job would make a status change
      take about 1 s whatever the location's size, at the cost of the job page
      briefly showing the previous schedule dates.

## Cause 3 — job MRP runs inline on every Planned/Ready change

`$jobId.status.tsx` awaits `recalculateJobRequirements` and then
`runMRP({ type: "job" })` before it updates the status (about 1.2 s together).

- [ ] Check whether the job MRP result is needed before the response, or can run
      after it.

## What this branch must reconcile when it merges main

crbnos/carbon#1814 changed code the removal branch also touches:

- [ ] **Event-system functions are files now.**
      `packages/database/src/event-system/functions/` holds
      `util.invoke_edge_function.sql`, `util.process_embeddings.sql` and
      `util.wake_event_queue.sql` with main's definitions. The removal branch
      changes or drops all three: update or delete the files, drop the old
      signatures in a hand-written migration (sync refuses a file that would
      create an overload), then run
      `pnpm --filter @carbon/database authz migration <name>`.
- [ ] **One Postgres pool per Node process.** `getPostgresConnectionPool(n)` now
      throws on Node; use `getProcessPool()`. `getJobDatabaseClient()` takes no
      size. Ported functions that built their own pool at module scope (the
      edge-function pattern) must use the shared one.
- [ ] **Request-bound Supabase clients.** `getCarbonServiceRole()` called while
      handling a request shares a limit of 8 calls in flight with every other
      client of that request. A ported function that fans out more than that in
      parallel will queue; that is intended, but measure the ones that did heavy
      parallel reads as edge functions (`get-method`, MRP).
