# Slow request fixes: scheduler writes, maintenance dispatch, webhook timeout

## Context

Axiom traces for 2026-10-05 showed three avoidable costs. None is a slow query; each is too many sequential round trips.

- **Reschedule (4.9 s of a 6.7 s job release, also operation delete).** `runLocationSchedule` re-plans every open job at the location. Each job costs about 17 statements in two transactions, so 28 jobs is about 500 statements. In prod 88% of jobs get new operation dates on every run, so skipping unchanged writes would not help. The fix is to compute every job in memory and write the location once.
- **`carbon-dispatch` (40.7 s).** One `maintenanceSchedule` read per company. The company list is read without paging, so it stops at 1,000 of 1,284 companies: 284 companies never get preventive-maintenance dispatches. Only 31 companies have an active schedule.
- **Webhook delivery.** `axios.post` to the customer URL has no timeout, so a hung endpoint holds the step until the platform kills it.

Decisions already made with the user: keep the reschedule inline (no background wave); go the full depth (in-memory compute plus one write); a database error in that write fails the whole location run instead of one job. Inline PDFs are out of scope.

Work on a new branch `perf/slow-request-fixes` off `main`, one commit per part. Copy this plan to `.ai/plans/2026-10-06-slow-request-fixes.md` first. No push without asking.

---

## Part 1: Maintenance dispatch (smallest, fixes a live bug)

File: `packages/jobs/src/inngest/functions/scheduled/dispatch.ts`, the `dispatchFunction` body (lines 395-459).

1. Replace the company loop with one paged read of every due schedule across companies: `fetchAllFromTable` (`@carbon/database`, same helper `scheduled/mrp.ts` uses) on `maintenanceSchedule`, `active = true` and `nextDueAt is null or <= now`.
2. Read `companySettings (id, maintenanceDispatchNotificationGroup)` only for the companies that have a due schedule, with `.in("id", ids)` in chunks of 200.
3. Loop the due schedules and call the existing `generateDispatchesForSchedule` unchanged (it stays one schedule at a time; that part is inherent and small).
4. A failed read now throws so Inngest retries, instead of silently skipping a company.

`generateMaintenanceForScheduleFunction` (on-demand, one schedule) is untouched.

Expected: about 1,000 reads become 2-3; run time about 40 s to about 10 s; all 1,284 companies covered.

## Part 2: Webhook timeout

File: `packages/jobs/src/inngest/functions/events/webhook.ts:62`.

- Add `timeout: 30_000` to the `axios.post` options.
- 30 s, not 10 s: yesterday's handlers that took 8-14 s ended in `increment_webhook_success`, so a 10 s limit would turn deliveries that succeed today into failures and retries.
- Add one line to `docs/content/docs/building/webhooks.mdx`: an endpoint that does not answer within 30 seconds counts as a failed attempt and is retried.

## Part 3: Scheduler computes in memory, writes once

All under `packages/planning/src/scheduling/`. `SchedulingEngine` is constructed only in `run-schedule.ts`, so the engine's write contract can change without touching callers.

### 3a. Engine stops writing; it returns a write set

`scheduling-engine.ts`, `material-manager.ts`.

The engine has four write sites today. Each one records into a `JobWrites` value instead (`engine.getWrites()`):

| Today | Becomes |
|---|---|
| `materialManager.assignOperationsToMaterials` (one UPDATE per material) and `assignMaterials` | `materialLinks: { materialId, jobOperationId }[]` |
| `createDependencies` transaction (lock, delete, insert) | `dependencies: { reworkOpIds, records } \| null`, null when the computed edges equal the stored non-rework edges (already in memory from `initialize`) |
| `createDependencies` Ready update | `readyOperationIds` |
| `persistChanges` | `placements`, `reservations`, `job: { projectedCompletionAt }`, plus the existing newly-late calculation |

Reads that used to follow the engine's own writes now apply the links in memory:
- `assignMaterials`: unassigned Make to Order materials minus the ones already linked in this run.
- `createDependencies`: `getMaterialsWithMakeMethod` rows with `jobOperationId` filled from the links.

Side effect: the expedite what-if (`persist: false`) now sees the same material links a real run does. Today it skips them. This is the only intended behavior difference inside a run.

### 3b. Provider serves earlier jobs' results from memory

`master-data-provider.ts`. The provider already holds per-run state (`preload`, `companyCache`); add a run overlay next to it.

- **Reservations.** `beginRun(batch)` loads live reservations once (no exclusions) and splits them: rows later jobs always see (non-batch jobs, batch-tagged rows) and each batch job's own old rows. `getLiveReservations` then answers from memory. After a job computes, its planned reservations replace its old rows, keeping today's visibility rules: not a placeholder, `endAt > now`, job status in `capacityHoldingJobStatuses`. A job that fails to compute keeps its old rows visible, as today.
- **Cross-job operations** (`getCrossJobOperationsAtWorkCenters`). Cache the DB rows per work center id; keep a map of operations placed by already-run jobs (row built from the preloaded operation plus the new placement). Answer = cached rows not in that map, plus placed operations at the requested work centers.
- **Materials.** With no mid-run writes, the preloaded rows are always the stored state: serve `getMaterialsWithMakeMethod` and `getUnassignedMakeToOrderMaterials` from the preload for preloaded jobs and delete the `materialsAreLinked` gate (add `methodType` to the `unlinked` preload select).
- **Process requirements.** Cache per process id instead of per id-set.

The overlay rules are pure functions (`visibleReservations`, `mergeCrossJobOperations`, `dependencyEdgesEqual`) so they are unit-tested without a database. Outside a location run (no `beginRun`) every method reads the database as today.

### 3c. One transaction per location

`run-schedule.ts`, new `persist-location.ts`.

`runLocationSchedule`: batch pre-pass (unchanged, keeps its own transaction) → `preloadJobs` → `beginRun` → per job: `engine.run()`, `provider.recordJob(writes)` → `persistLocationWrites(db, writes[], { companyId, userId })`.

`persistLocationWrites` is one transaction, every statement scoped by `companyId`:
1. Material links: one `UPDATE jobMaterial ... FROM (VALUES ...)`.
2. Dependencies, only for jobs whose edges changed: advisory lock, delete, insert (existing logic moved).
3. Ready: one guarded `UPDATE jobOperation SET status = 'Ready'`.
4. Placements: existing `updatePlacements`, one statement per column shape across all jobs.
5. Reservations: one `DELETE ... WHERE jobId IN (...)` (same predicates), one bulk insert.
6. Jobs: one `UPDATE job ... FROM (VALUES ...)` with the existing is-distinct guard.

Bulk VALUES and inserts are chunked at 1,000 rows (Postgres caps a statement at 65,535 parameters).

Failure handling: a job that throws while computing is logged, counted in `jobsFailed`, left out of the write, and stays stamped stale, as today. A database error in the write rolls back the location and `runLocationSchedule` throws. All five callers already catch (`$jobId.status.tsx`, `recalculateJobOperationDependencies`, `api+/schedule.ts`, `api+/kanban.$id.tsx`, the replan wave, `tasks/recalculate.ts`).

`runExpediteWhatIf` uses the same engine and never calls the persist function.

Expected: about 500 statements to about 60; reschedule from 4.9 s to under 1 s. This is an estimate until measured in the check below.

### 3d. Docs

Update `.claude/rules/scheduling-data-structures.md` (sections "Whole-location, deterministic run" and "`persistChanges`") to describe in-memory claiming and the single location transaction, and the comment on `companyCache` in the provider that says reservations are never cached.

---

## Verification

Run typechecks one package at a time (`--concurrency=1`).

**Part 1**
- `pnpm exec turbo run typecheck --filter=@carbon/jobs --concurrency=1`
- Against the running local stack (do not restart it): set one seeded schedule's `nextDueAt` to yesterday, invoke `dispatch` from the Inngest dev UI, confirm one dispatch is created, `nextDueAt` advances, and a second invoke creates nothing.

**Part 2**
- `pnpm --filter @carbon/jobs test` (`webhook.test.ts` pins the body contract).
- `pnpm --filter docs typecheck`.

**Part 3**
- `pnpm --filter @carbon/planning test`: existing determinism, envelope, batch-scheduler and selector suites, plus new tests for the three pure overlay functions.
- **Old-versus-new parity with a fixed clock.** Use the two-stack parity setup at `~/Documents/crbnos/carbon-parity` (main and branch on the same seed; confirm it still runs before relying on it). A temporary script mocks `Date.now`, runs `runLocationSchedule` for every location of the seeded company on each stack, and dumps `jobOperation` placement columns, `capacityReservation` (without id and createdAt), `jobOperationDependency`, `jobMaterial.jobOperationId` and `job.projectedCompletionAt`. The two dumps must be identical. Run it twice: once on a fresh seed (everything gets written) and once again (steady state). Delete the script before committing.
- **Statement count.** The same script builds its Kysely client with a `log` callback and prints the number of statements per location run, before and after.
- `pnpm exec turbo run typecheck --filter=@carbon/planning --concurrency=1`, then `--filter=@carbon/jobs`, then `--filter=erp`.
- `pnpm run lint`.
- Browser check with `/auth`: release a seeded job with "schedule", confirm dates appear on its operations and the Forecast shows it; delete an operation and confirm the job reschedules.

After deploy, recheck in Axiom: `POST /x/job/:jobId/status` p95 and the SQL statement count on its traces, and the `carbon-dispatch` run time and `maintenanceSchedule` call count.
