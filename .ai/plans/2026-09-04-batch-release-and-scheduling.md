# Batch Release & Batch-Aware Scheduling — implementation plan

**Spec:** .ai/specs/2026-09-04-batch-release-and-scheduling.md
**Research:** .ai/research/2026-09-04-batch-release-and-scheduling.md (+ .ai/research/job-operation-batching-competitors.md)
**Branch:** feat/job-operation-batching-v2

Core rule being implemented (memorize before any task):

> An operation is floor-visible iff — it belongs to a batch → the batch is
> Released (`Active`/`Completing`); it belongs to no batch → its job is released
> (`Ready`/`In Progress`/`Paused`). Batch lifecycle gains `Planned` before
> `Active`; `Active` is relabelled "Released" in the UI only. A Released batch
> schedules as ONE unit (one tagged `capacityReservation`, members pinned,
> duration `setup(max) + Σ|max(run)` by `process.batchType`).

## Progress
- [x] Task 1: Migration A — `Planned` enum value, `batchType`, reservation tag
- [x] Task 2: Migration B — default flip + both RPC predicate forks
- [x] Task 3: Apply migrations + regenerate types
- [x] Task 4: `batchDuration` in `@carbon/utils` (+ tests)
- [x] Task 5: Model/validator additions (production + resources)
- [x] Task 6: `batch-operations` edge fn — `release`/`unrelease`, Planned-aware guards
- [x] Task 7: ERP service wrappers + `batching.update` intents (recalc + notify)
- [x] Task 8: Scheduler plumbing — snapshot, regen delete, job loading
- [x] Task 9: Scheduler batch pre-pass + pinned members (+ tests)
- [x] Task 10: MES floor guards + `getOpenJobs` widening
- [x] Task 11: Process form — Batch type selector
- [x] Task 12: Batch builder — Create vs Create & Release, job-status chips, duration
- [x] Task 13: Batches list/drawer/board — Planned state, Release/Unrelease actions
- [x] Task 14: Job detail — "operations awaiting batching" notice
- [ ] Task 15: i18n extract + translate
- [x] Task 16: Docs sync (AGENTS.md + rules + spec changelog)
- [ ] Task 17: Validation gates (typecheck, lint, tests, db checks)
- [ ] Task 18: Browser verification via /test

## Dependencies
- Task 2 needs Task 1 (enum value must exist in an earlier file). Task 3 needs 1–2.
- Task 4 is independent (pure TS) — may run in parallel with 1–3.
- Tasks 5–14 need Task 3 (generated types). Task 7 needs 5+6. Task 9 needs 4+8.
- Tasks 10, 11, {12,13,14} are mutually independent after their deps.
- Task 12 needs 4+5+7; Task 13 needs 5+7; Task 14 needs 3 only.
- Tasks 15–18 run last, in order.

---

## Task 1: Migration A — `Planned` enum value, `batchType`, reservation tag

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_batch-planned-state-and-batch-type.sql` (via `pnpm db:migrate:new batch-planned-state-and-batch-type` — never hand-pick the timestamp)
- Copy from (precedent): `packages/database/supabase/migrations/20260901132702_batch-composite-tenant-fks.sql` (guarded composite-FK idiom), `packages/database/supabase/migrations/20260831204743_work-center-batch-capacity.sql` (view recreate idiom)

**Steps:**
1. Run `pnpm db:migrate:new batch-planned-state-and-batch-type`.
2. Find the NEWEST migration defining the `processes` view:
   `grep -rl 'VIEW "processes"' packages/database/supabase/migrations/ | sort | tail -1`
   Open that file and copy its full `processes` view definition verbatim (it must
   already contain `p."batchable"` and `p."batchRules"` — if it does not, you are
   holding a stale definition: STOP and report).
3. Write the migration:

```sql
-- Batch pre-floor state. BEFORE 'Active' keeps enum sort = lifecycle order.
ALTER TYPE "jobOperationBatchStatus" ADD VALUE IF NOT EXISTS 'Planned' BEFORE 'Active';

-- Simultaneous (furnace/oven: parallel load) vs Sequential (saw/laser: serial
-- queue) batch physics. Meaningful only when process.batchable = true.
DO $$ BEGIN
  CREATE TYPE "batchType" AS ENUM ('Sequential', 'Simultaneous');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchType" "batchType" NOT NULL DEFAULT 'Sequential';

DROP VIEW IF EXISTS "processes";
CREATE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  -- <VERBATIM fork of the newest definition from step 2, with p."batchType"
  --  added to the SELECT list immediately after p."batchable">
  ;

-- Coalesced batch reservation tag. operationId/jobId stay NOT NULL — a batch
-- row anchors them on the deterministic first member (min member op id); this
-- tag is the semantic key.
ALTER TABLE "capacityReservation" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
DO $$ BEGIN
  ALTER TABLE "capacityReservation" ADD CONSTRAINT "capacityReservation_jobOperationBatchId_fkey"
    FOREIGN KEY ("jobOperationBatchId", "companyId")
    REFERENCES "jobOperationBatch"("id", "companyId")
    ON DELETE SET NULL ("jobOperationBatchId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "capacityReservation_jobOperationBatchId_idx"
  ON "capacityReservation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;
```

Nothing in this file may reference the literal `'Planned'` other than the
`ADD VALUE` itself (same-transaction enum-use restriction — that is why
Migration B exists).

**Verify:**
```bash
grep -c "ADD VALUE IF NOT EXISTS 'Planned'" packages/database/supabase/migrations/*batch-planned-state*.sql
# Expected: 1
grep -c "Planned" packages/database/supabase/migrations/*batch-planned-state*.sql
# Expected: exactly 2 (the ADD VALUE line + its comment reference, no other use)
```

**Out of scope:** the RPCs, the status default (Migration B); editing
`20260821024449_job-operation-batching.sql` (applied — fix forward only).

## Task 2: Migration B — default flip + both RPC predicate forks

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_batch-release-floor-gate.sql` (via `pnpm db:migrate:new batch-release-floor-gate`)
- Copy from (precedent): `packages/database/supabase/migrations/20260831170323_merge-batching-with-dual-dates.sql` (newest `get_active_job_operations_by_location`), `packages/database/supabase/migrations/20260821024449_job-operation-batching.sql:260-347` (newest `get_batchable_operations`)

**Steps:**
1. Run `pnpm db:migrate:new batch-release-floor-gate`.
2. Confirm the newest definitions (newest-wins rule):
   `grep -rl 'get_active_job_operations_by_location' packages/database/supabase/migrations/ | sort | tail -1` → expect `…20260831170323_merge-batching-with-dual-dates.sql`;
   `grep -rl 'get_batchable_operations' packages/database/supabase/migrations/ | sort | tail -1` → expect `…20260821024449_job-operation-batching.sql`.
   If either differs, fork from whatever IS newest — but STOP and report if the
   newer definition lacks the predicate text quoted below.
3. `ALTER TABLE "jobOperationBatch" ALTER COLUMN "status" SET DEFAULT 'Planned';`
4. **`get_batchable_operations`**: copy the whole function from its newest file.
   `DROP FUNCTION IF EXISTS` with the exact argument list, then `CREATE` the fork
   with exactly three edits (function redefinition lesson — preserve language,
   volatility, `SECURITY`, and grants exactly):
   - In the `WHERE` clause, replace
     `AND j."status" IN ('Ready', 'In Progress', 'Paused')`
     with
     `AND j."status" NOT IN ('Completed', 'Closed', 'Cancelled')`
   - Replace the lane clause
     `OR b."status" IN ('Active', 'Completing')`
     with
     `OR b."status" IN ('Planned', 'Active', 'Completing')`
   - Add `j."status"::text AS "jobStatus"` to the RETURNS TABLE columns and the
     SELECT list (append at the END of both lists so existing consumers'
     positional reads are unaffected).
5. **`get_active_job_operations_by_location`**: copy the whole function from
   `20260831170323…`. `DROP FUNCTION IF EXISTS` + `CREATE` the fork with exactly
   two edits:
   - In the `relevant_jobs` CTE, replace
     `AND ("status" = 'Ready' OR "status" = 'In Progress' OR "status" = 'Paused')`
     with
     ```sql
     AND (
       "status" IN ('Ready', 'In Progress', 'Paused')
       OR "id" IN (
         SELECT jo2."jobId"
         FROM "jobOperation" jo2
         JOIN "jobOperationBatch" b2
           ON b2."id" = jo2."jobOperationBatchId"
          AND b2."companyId" = jo2."companyId"
         WHERE b2."status" IN ('Active', 'Completing')
       )
     )
     ```
   - In the operation-level `WHERE` (currently
     `jo."status" != 'Done' AND jo."status" != 'Canceled'`, both branches of the
     work-center CASE), AND on the membership-handoff predicate. The function
     already LEFT JOINs `jobOperationBatch` (it outputs `batchReadableId`);
     reuse that alias (call it `b` here):
     ```sql
     AND (
       (jo."jobOperationBatchId" IS NOT NULL AND b."status" IN ('Active', 'Completing'))
       OR
       (jo."jobOperationBatchId" IS NULL AND rj."status" IN ('Ready', 'In Progress', 'Paused'))
     )
     ```
     If the newest definition has NO jobOperationBatch join, STOP and report —
     the fork source is not the batching-aware version.
6. Leave the existing `Paused` coercion (`WHEN rj."status" = 'Paused' THEN 'Paused'`)
   untouched — a paused member job renders Paused even inside a Released batch
   (documented spec behavior).

**Verify:**
```bash
pnpm db:migrate
# Expected: both new migrations apply cleanly, no errors
psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::\"jobOperationBatchStatus\"))::text" 2>/dev/null || \
  echo "verify enum via: SELECT enum_range(NULL::\"jobOperationBatchStatus\")"
# Expected: Planned, Active, Completing, Completed (Planned first)
```
If `pnpm db:migrate` fails on the local runner, use the rolled-back psql
transaction validation pattern from memory (supabase_admin + BEGIN/\i/ROLLBACK)
and report the runner failure.

**Out of scope:** any app code; `get_picking_schedule` and other RPCs that read
job status (they are pick-time surfaces, not floor dispatch — untouched in v1).

## Task 3: Apply migrations + regenerate types

**Depends on:** Tasks 1–2
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never hand-edit)

**Steps:**
1. `pnpm db:migrate` (if not already applied in Task 2's verify).
2. `pnpm run generate:types`

**Verify:**
```bash
grep -n '"Planned"' packages/database/src/types.ts | grep -i -m1 jobOperationBatch
# Expected: jobOperationBatchStatus union includes "Planned"
grep -n 'batchType' packages/database/src/types.ts | head -3
# Expected: batchType enum + process column present
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** fixing app-code type errors surfaced by the regen (they belong
to Tasks 5–13 — note them, don't patch ad hoc).

## Task 4: `batchDuration` in `@carbon/utils` (+ tests)

**Depends on:** none
**Files:**
- Create: `packages/utils/src/batch-duration.ts`
- Create: `packages/utils/src/batch-duration.test.ts`
- Modify: `packages/utils/src/index.ts` — export the new module
- Copy from (precedent): `packages/utils/src/batch-time-split.ts` + its test (module/test shape; note batch-time-split re-exports a Deno source — batchDuration does NOT need a Deno mirror, no edge fn consumes it — so it is a plain Node/browser module)

**Steps:**
1. Implement (pure, no I/O):
```typescript
export type BatchDurationMember = {
  setupDuration: number;      // seconds
  laborDuration: number;      // seconds, full planned
  machineDuration: number;    // seconds, full planned
  operationQuantity: number;
  quantityComplete: number;
};

export type BatchType = "Sequential" | "Simultaneous";

/**
 * Planned duration of an operation batch, in seconds.
 * setup = max member setup, counted once (shared load), 0 when the batch has
 *         already recorded any production event (setup-done rule, matching the
 *         engine's remaining-work netting for single ops).
 * run_i  = max(labor_i, machine_i) scaled by the member's remaining fraction
 *          (1 - quantityComplete/operationQuantity, clamped to [0,1]; fraction
 *          is 1 when operationQuantity <= 0).
 * run    = Σ run_i (Sequential) | max run_i (Simultaneous).
 */
export function batchDuration(
  members: BatchDurationMember[],
  batchType: BatchType,
  options?: { hasAnyEvent?: boolean }
): number
```
2. Tests (vitest, mirror batch-time-split.test.ts style): both regimes with the
   spec's worked example — members with effective runs 40/70/50 min and setups
   10/10/10 → Simultaneous `80*60`s, Sequential `170*60`s; remaining-fraction
   netting (a member at 50% complete contributes half its run); `hasAnyEvent`
   zeroes setup; empty members → 0; `operationQuantity: 0` → full run.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- batch-duration
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: exit 0
```

**Out of scope:** wiring into the engine or builder (Tasks 9, 12); no raw
`Math.*` rounding on value-bearing numbers (durations in whole seconds are
integer arithmetic; use `round` from the same package if needed).

## Task 5: Model/validator additions

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — status const at line ~1039, create validator at ~1045
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — `processValidator`
- Copy from (precedent): the existing `jobOperationBatchStatus` const + `createJobOperationBatchValidator` in the same file; `batchable: zfd.checkbox()` on `processValidator`

**Steps:**
1. `production.models.ts`:
   - Status const becomes `["Planned", "Active", "Completing", "Completed"]` (lifecycle order).
   - `createJobOperationBatchValidator`: add `release: zfd.checkbox().optional()`.
   - New `releaseJobOperationBatchValidator = z.object({ batchId: z.string().min(1) })` and an identical `unreleaseJobOperationBatchValidator` (separate names — intents diverge later).
2. `resources.models.ts`: `processValidator` gains
   `batchType: z.enum(["Sequential", "Simultaneous"]).optional().default("Sequential")` next to `batchable`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (new validators compile; downstream errors from the widened
# status const — e.g. exhaustive switches on batch status — must be fixed HERE
# by adding the Planned branch, not silenced)
```

**Out of scope:** MES models (MES reads batch status from generated DB types; if
`apps/mes/app/models.ts` mirrors the const, update it here too — grep
`Completing` in apps/mes/app to check).

## Task 6: `batch-operations` edge fn — `release`/`unrelease`, Planned-aware guards

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/supabase/functions/batch-operations/index.ts` — payload union (~:29-84), `create` (~:626-711), `add` (~:714-776), `update` (~:823-882)
- Modify: `packages/database/supabase/functions/shared/batch-time-split.ts` — `assertBatchWorkCenterMutable` (~:250-256)
- Modify: `packages/utils/src/batch-time-split.test.ts` (or wherever `assertBatchWorkCenterMutable` is pinned) — expectations for Planned
- Copy from (precedent): the existing `dissolve` case (guarded flip + named-error style), `.claude/rules/workflow-edge-function.md`

**Steps:**
1. Payload union: add
   `z.object({ type: z.literal("release"), batchId: z.string(), companyId: z.string(), userId: z.string() })`
   and the same for `"unrelease"`; `create` member gains `release: z.boolean().optional()`.
2. `create`: insert `status: payload.release ? "Active" : "Planned"`. When
   `release` is true, AFTER the existing shared-work-center adoption (~:658-668),
   assert the batch will have a non-null `workCenterId` (explicit payload OR
   adopted) — else throw `"A batch must have a work center before it can be released"`.
3. New `release` case, one Kysely transaction:
   - `SELECT … FOR UPDATE` the batch by `(id, companyId)`; 404-style error on miss.
   - Assert `status === 'Planned'` (error names the actual status), `workCenterId !== null`, and member count ≥ 1 (`jobOperation` where `jobOperationBatchId = batchId AND companyId = companyId` — EVERY Kysely statement carries companyId, per lesson).
   - Guarded flip: `UPDATE … SET status='Active', updatedBy, updatedAt WHERE id AND companyId AND status='Planned'`; assert 1 row or roll back.
4. New `unrelease` case, same shape: assert `status === 'Active'`; assert zero
   `productionEvent` rows `WHERE jobOperationBatchId = batchId AND companyId = companyId`
   (error: `"production has been recorded — complete the batch instead"`);
   guarded flip to `'Planned'`.
5. Widen pre-floor mutability from `Active`-only to `('Planned','Active')`:
   - `assertBatchWorkCenterMutable` in the shared Deno source accepts both.
   - The `add` case's batch-status assertion accepts both.
   - Confirm `remove`/`dissolve` gate only on production events (they do) — no change.
6. Confirm (do not change) `planBatchCompletion` throws for `Planned` — it
   throws for any status other than Active/Completing; add/extend the unit test
   pinning `planBatchCompletion("Planned")` → throw.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check batch-operations/index.ts && cd -
# Expected: exit 0 (if deno is unavailable locally, note it and rely on Task 17 gates)
pnpm --filter @carbon/utils test -- batch-time-split
# Expected: pass, including the new Planned expectations
```

**Out of scope:** the completion path (`completeBatch`), issue/GL logic,
`notifyScheduleInputsChanged` (edge fns never call it — the ERP action does).

## Task 7: ERP service wrappers + `batching.update` intents

**Depends on:** Tasks 5, 6
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — next to `createJobOperationBatch` (~:5976)
- Modify: `apps/erp/app/routes/x+/priority+/batching.update.tsx` — new intents
- Copy from (precedent): the existing `updateJobOperationBatch` wrapper + the route's existing intent dispatch; `apps/erp/app/routes/x+/job+/$jobId.status.tsx:60-90` (recalc-before-flip ordering)

**Steps:**
1. Service wrappers (client-first, `{data, error}` return, never throw):
   `releaseJobOperationBatch(client, { batchId, companyId, userId })` →
   `invoke("batch-operations", { body: { type: "release", … } })`; same for
   `unreleaseJobOperationBatch`. `createJobOperationBatch` passes `release` through.
2. Route action: read the file first; add `release` and `unrelease` intents to
   the existing dispatch (permission `update: "production"` — already the
   route's gate). Release flow, in this exact order (mirrors job release):
   a. Load member ops → member job ids (one `.in()` query, no loop).
   b. Load those jobs' statuses; for each job in `('Draft','Planned')`, run the
      same `recalculateJobRequirements` the job-status route uses (grep its
      import in `$jobId.status.tsx`; call sequentially in a for-loop — recalc is
      heavy, don't `Promise.all` a big batch). A recalc failure flashes the
      error and STOPS (no flip) — identical to job release.
   c. `releaseJobOperationBatch(…)` — on error, flash and stop.
   d. `notifyScheduleInputsChanged` (it is exported from
      `production.service.ts:5794` — read its signature and call with kind
      `"work-center"`, reason `"batch released"`, and the batch's
      `workCenterId` as the entity id).
   Unrelease flow: edge fn call → on success, the same notify (reason
   `"batch unreleased"`).
3. Update the batch-create path in the same action so the builder's
   `release` flag flows through, and on `release: true` the notify fires there
   too.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** MRP (`runMRP` is NOT called — locked decision), UI buttons
(Task 13), job status writes of any kind.

## Task 8: Scheduler plumbing — snapshot, regen delete, job loading

**Depends on:** Task 3
**Files:**
- Modify: `packages/ee/src/planning/scheduling/master-data-provider.ts` — reservation snapshot (~:476-498)
- Modify: `packages/ee/src/planning/scheduling/scheduling-engine.ts` — per-job reservation delete (~:1201)
- Modify: `packages/ee/src/planning/scheduling/run-schedule.ts` — job loading (~:77)
- Copy from (precedent): the surrounding code in each file — match Kysely idiom exactly

**Steps:**
1. `master-data-provider.ts`: the `excludeJobIds` filter at ~:497
   (`query.where("cr.jobId", "not in", excludeJobIds)`) becomes "exclude only
   UNTAGGED rows of not-yet-run jobs":
   ```typescript
   query = query.where((eb) =>
     eb.or([
       eb("cr.jobId", "not in", excludeJobIds),
       eb("cr.jobOperationBatchId", "is not", null),
     ])
   );
   ```
   Read ~:170 too — if a second reservation read shares the exclusion, apply the
   same edit there.
2. `scheduling-engine.ts` ~:1201: the `deleteFrom("capacityReservation")` that
   clears a job's rows before re-insert gains
   `.where("jobOperationBatchId", "is", null)` — a member job's regen must never
   destroy the batch's coalesced reservation. Read the surrounding function
   first to confirm this delete is the per-job clear (it is inside
   `persistChanges`); if the delete is scoped differently, STOP and report.
3. `run-schedule.ts` ~:77: after the active-status job load, add a second query:
   jobs at this location whose id appears in
   `jobOperation JOIN jobOperationBatch ON (id, companyId) WHERE batch.status IN ('Active','Completing')`
   and whose status is NOT in the already-loaded set — then merge + dedupe by id
   into the same array BEFORE the existing deterministic sort, so widened jobs
   take their natural place in the deadline/priority order. Keep both queries
   companyId- and locationId-scoped.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: existing scheduling tests still pass (no behavior change while no
# batch-tagged reservations exist — the new predicates are no-ops on null tags)
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** placement logic (Task 9); the expedite what-if path
(`run-schedule.ts:174-200`) keeps full exclusion semantics — do not modify it
beyond what the shared snapshot function change implies.

## Task 9: Scheduler batch pre-pass + pinned members (+ tests)

**Depends on:** Tasks 4, 8
**Files:**
- Create: `packages/ee/src/planning/scheduling/batch-scheduler.ts`
- Create: `packages/ee/src/planning/scheduling/batch-scheduler.test.ts`
- Modify: `packages/ee/src/planning/scheduling/run-schedule.ts` — invoke pre-pass before the per-job loop; thread placements into each engine run
- Modify: `packages/ee/src/planning/scheduling/scheduling-engine.ts` — accept `batchPlacements` option; skip reservation insert for placed members
- Modify: `packages/ee/src/planning/scheduling/date-calculator.ts` (~:34-43) and `packages/ee/src/planning/scheduling/work-center-selector.ts` (~:378, ~:424) — generalize the pinned-Outside-Processing fixed-window path
- Copy from (precedent): `date-calculator.ts` pinnedOutside branch; `work-center-selector.test.ts:298-343` (pinned-op test style); `machine-availability.ts` + `slot-allocator.ts` for slot search

**Steps:**
1. **Read first** (budget ~30 min): `run-schedule.ts` whole file,
   `scheduling-engine.ts` `run()` + `persistChanges`, `date-calculator.ts`,
   `work-center-selector.ts` pinned handling, `dependency-manager.ts` (how
   predecessors are derived), `slot-allocator.ts` (reservation tagging comment
   at ~:38). If the pinned-window path cannot carry an externally-supplied
   window (vs the op's stored dates) without restructuring placement, STOP and
   report the shape you found — do not improvise a parallel placement path.
2. `batch-scheduler.ts` — `placeBatches(db, { companyId, locationId, now })`:
   a. Load Released (`Active`,`Completing`) batches at the location. A batch
      with `workCenterId IS NULL` (legacy pre-rule rows) is SKIPPED with its
      members conflict-flagged `"batch has no work center"` — never placed.
   b. Load members (+ `process.batchType` via the batch's `processId`, + member
      time fields + quantities + whether any batch `productionEvent` exists).
   c. Anchor: for each member, its predecessors' persisted
      `projectedCompletionAt` — derive predecessors the same way
      `dependency-manager.ts` does (reuse its helper if exported; if the
      derivation is not reusable without the full engine context, approximate
      with: ops on the same `jobMakeMethodId` with lower `"order"`, which is the
      documented topological column). `anchor = max(now, max(predecessor ends))`.
   d. Duration: map members through the engine's own duration conventions to
      `BatchDurationMember` and call `batchDuration(members, batchType,
      { hasAnyEvent })` from `@carbon/utils`.
   e. Slot: earliest feasible window ≥ anchor on the batch's work center using
      the same availability + reservation machinery single ops use
      (`machine-availability` ladder + existing reservation intervals,
      placeholders excluded). Deterministic batch order: by min member job's
      position in the run's job comparator, tie-break batch id.
   f. Persist: delete `capacityReservation WHERE companyId = ? AND jobOperationBatchId IN (location's batch ids)`,
      then insert ONE row per placed batch — `resourceKind 'WorkCenter'`,
      `resourceId = workCenterId`, `operationId`/`jobId` = the min-member-op's
      (deterministic anchor member), `jobOperationBatchId`, `startAt`/`endAt`,
      audit columns exactly as the engine's insert at `scheduling-engine.ts:1209`
      writes them.
   g. Return `Map<jobOperationId, { startAt, endAt, workCenterId, conflict?: string }>`.
3. `run-schedule.ts`: call `placeBatches` once per location run, after job
   loading, BEFORE the per-job loop; pass the map into every engine invocation.
4. Engine: for an op present in `batchPlacements` —
   - `date-calculator` treats it as fixed-window (the batch's), like
     pinnedOutside but window from the map, not stored dates;
   - work-center selection is skipped (WC = batch's), successors chain after the
     fixed end via the existing pinned-end path (`work-center-selector.ts:378`);
   - NO per-member `capacityReservation` is written (`persistChanges` filters
     ops in the map from the reservation insert; their
     `startDate`/`projectedCompletionAt` ARE written from the window);
   - if a dependency's fresh placement ends after the batch window start, set
     the op's conflict flag with a message via `conflict-messages.ts` (add
     `"batchStartBeforePredecessor"`-style message following the file's
     existing pattern).
5. Tests (`batch-scheduler.test.ts`, using `test-helpers.ts` fixtures):
   - Sequential batch (runs 40/70/50 min, setups 10 each) reserves ONE
     WorkCenter row of 170 min; Simultaneous reserves 80 min.
   - Exactly one reservation row regardless of member count; row carries
     `jobOperationBatchId`.
   - Member ops' `startDate`/`projectedCompletionAt` equal the batch window;
     each member's downstream op starts ≥ batch end.
   - A member job's own regen (delete+insert) leaves the batch row in place
     (predicate from Task 8).
   - Snapshot with `excludeJobIds` containing the anchor job still returns the
     batch row.
   - Batch with null WC → skipped + members conflict-flagged.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: new batch-scheduler tests pass AND the full existing suite stays green
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** employee reservations for batches (v1 WC-only — documented);
splitting over-capacity simultaneous batches; `Planned` batches (members
schedule per-op as today — assert nothing about them here beyond "unchanged").

## Task 10: MES floor guards + `getOpenJobs` widening

**Depends on:** Task 3
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` — `getOpenJobs` (~:42-55)
- Modify: `apps/mes/app/routes/x+/operation.$operationId.tsx` — loader guard (~:90-112 region)
- Modify: `apps/mes/app/routes/x+/start.$operationId.tsx` — pre-start guard (after the companyId check)
- Copy from (precedent): the loader's existing redirect-with-flash blocks in the same files

**Steps:**
1. **Trigger audit first**:
   `grep -rn 'CREATE TRIGGER' packages/database/supabase/migrations/*.sql | grep -i productionEvent`
   and read any hits — confirm nothing auto-flips `job.status` when a
   production event lands on a Draft job's op. Expected: none. If one exists,
   STOP and report (a Released batch on a Draft job would silently release the
   job).
2. `getOpenJobs`: first query the member-job ids —
   ```typescript
   const memberJobs = await client
     .from("jobOperation")
     .select("jobId, jobOperationBatch!inner(status)")
     .eq("companyId", args.companyId)
     .in("jobOperationBatch.status", ["Active", "Completing"]);
   ```
   then the existing `jobs` query becomes, when member ids exist:
   `.or(\`status.in.(${activeJobStatuses.join(",")}),id.in.(${ids.join(",")})\`)`
   (keep `.eq("locationId", …)`; when the id list is empty, keep today's
   `.in("status", …)` untouched). Statuses containing spaces must be quoted per
   PostgREST `.or` syntax — `"In Progress"` — verify the generated filter
   against an existing `.or()` usage in the app (grep `.or(` in apps/mes).
3. Operation loader guard (after the batch read at ~:102):
   - `batchId && batchStatus === "Planned"` → redirect `path.to.operations` with
     flash error `"This operation is part of batch {readableId}, which has not been released to the floor"`.
   - `!batchId` → ensure the job's status is available (the loader's existing
     job fetch; if `getJobOperationById` output lacks it, add a one-column
     `job.status` select by `op.jobId` + companyId) and when not in
     `activeJobStatuses` → redirect with flash `"This operation's job has not been released"`.
   - Import `activeJobStatuses` from `@carbon/database`.
4. `start.$operationId.tsx`: `jobOperation.data.jobOperationBatchId` is already
   in the `select("*")` result. Apply the same two checks before any write
   (note: the loader currently re-opens timers via an `.update` in the same
   `Promise.all` — restructure so the guard runs BEFORE that update executes).
5. Do NOT gate `end.$operationId.tsx` — ending/closing a timer must never be
   blocked.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
pnpm --filter @carbon/mes test 2>/dev/null || true
# Expected: existing MES tests (if any) pass
```

**Out of scope:** the kanban RPC (Migration B already fixed it);
`event.tsx`/batch timers; any UI rendering changes (the widened job list reuses
existing cards — a Draft job shows its plain "Draft" status badge, which is
correct).

## Task 11: Process form — Batch type selector

**Depends on:** Tasks 3, 5
**Files:**
- Modify: `apps/erp/app/modules/resources/ui/Processes/ProcessForm.tsx`
- Modify: `apps/erp/app/modules/resources/resources.service.ts` — `upsertProcess` passthrough
- Copy from (precedent): the existing `batchable` Boolean field in the same form; any `Select` with two options in the same module (grep `<Select` in `apps/erp/app/modules/resources/ui`)

**Steps:**
1. `upsertProcess`: pass `batchType` through (it is on the validator from Task 5).
2. `ProcessForm.tsx`: below the `batchable` checkbox, render a `Select` named
   `batchType` ONLY when batchable is checked (the form already tracks that
   state for the batch-rules card — reuse that conditional). Options:
   `Sequential` — helper text "Parts run one after another (saw, laser table)";
   `Simultaneous` — "Parts run together in one load (furnace, oven, plating)".
   Default `Sequential`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** processes table column (optional; skip in v1 unless a
one-line column add — decide by the table's existing `batchable` column: if it
renders one, mirror it, else skip).

## Task 12: Batch builder — Create vs Create & Release, chips, duration

**Depends on:** Tasks 4, 5, 7
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Batches/BatchBuilder.tsx`
- Modify: `apps/erp/app/modules/production/ui/Batches/batch-builder-logic.ts` — `batchPlanBreakdown` (~:131)
- Modify: `apps/erp/app/routes/api+/production.batchable-operations.ts` — jobStatus passthrough, retire unreleased-attribution (~:16-26, :105-121)
- Modify: `apps/erp/app/routes/x+/production+/batches.new.tsx` — add-mode bounce (~:66-100)
- Modify: `apps/erp/test/batch-suggestions.test.ts` — breakdown expectations
- Copy from (precedent): the builder's own review-panel chips + footer buttons; job status badges — grep `case "Draft"` under `apps/erp/app/modules/production/ui` for the status→variant map used by job tables

**Steps:**
1. API route: surface the RPC's new `jobStatus` on each candidate; delete the
   `RELEASED_JOB_STATUSES` constant and the `hidden.unreleased` attribution —
   the hidden-ops breakdown keeps only `batched` and `started`.
2. `batch-builder-logic.ts`: `batchPlanBreakdown(members, batchType)` — thread
   the scope's process `batchType` in; `Sequential` keeps today's sums;
   `Simultaneous` replaces the labor/machine Σ with per-type max. The panel's
   TOTAL must come from `batchDuration` (import from `@carbon/utils`) so the
   builder can never disagree with the scheduler. Update the unit tests with
   both regimes.
3. `BatchBuilder.tsx`:
   - Candidate rows: a small job-status badge when `jobStatus` is not in
     `('Ready','In Progress','Paused')` (Draft/Planned chips), so the planner
     sees what they are pulling forward. Reuse the grepped status-variant map.
   - Review step footer: primary button **"Create batch"** (Planned) plus a
     secondary **"Create & Release"** that submits `release: true` and is
     disabled with tooltip "Select a work center to release" while no work
     center is chosen and the members don't share one.
4. `batches.new.tsx` add-mode: the bounce that requires an `Active` batch now
   accepts `Planned` or `Active`.

**Verify:**
```bash
pnpm --filter @carbon/erp test -- batch-suggestions
# Expected: updated breakdown tests pass
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** suggestion scoring, capacity fill bar, compatibility rules
(unchanged); MRP hints.

## Task 13: Batches list/drawer/board — Planned state, Release/Unrelease actions

**Depends on:** Tasks 5, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/production+/batches.tsx` — status filter, badges, context-menu actions
- Modify: the batch detail drawer component (grep `BatchDetailDrawer` under `apps/erp/app/modules/production/ui/Batches/`) — status badge, Release/Unrelease footer actions
- Modify: the board batch card (grep `BatchItemCard` under `apps/erp/app/modules/production/ui/`) — Planned variant
- Copy from (precedent): the existing `Completing` yellow-badge/read-only handling in the same three files; the destructive Dissolve entries for menu/footer action shape

**Steps:**
1. Status rendering, one shared map (find where Active/Completing badges are
   defined — likely a small `statusVariant` helper; extend it):
   `Planned` → outline/secondary badge labelled `t"Planned"`; `Active` renders
   label `t"Released"` (green) — the stored value is unchanged, label only.
2. `batches.tsx`: status filter options now
   Planned/Released(Active)/Completing/Completed. Context menu: **Release**
   (rows with status Planned; disabled with tooltip when `workCenterId` is
   null) and **Unrelease** (rows with status Active; the server refuses started
   batches — surface its error as the flash, same as dissolve does). Both post
   to `path.to.priorityBatchingUpdate` with the new intents.
3. Detail drawer: same two actions in the footer; status badge from the shared
   map; while `Planned`, show a quiet hint line "Not on the shop floor — release
   to dispatch" (i18n'd).
4. `BatchItemCard` (board): a `Planned` batch renders with the outline badge and
   a dashed border (distinct from live), remains draggable (WC reassignment is
   legal pre-release — Task 6 widened the guard).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** bulk release (bulk dissolve exists; do not add bulk release in
v1); MES batch chip (batch mode only exists for Released batches — unchanged).

## Task 14: Job detail — "operations awaiting batching" notice

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/x+/job+/$jobId.tsx` (loader) + the job header/summary component it renders (grep `manufacturingBlocked` or `<Alert` under `apps/erp/app/modules/production/ui/Jobs/` for the exact spot the release-refusal state surfaces; place this notice alongside)
- Copy from (precedent): that grepped informational Alert/banner

**Steps:**
1. Loader: when the job's status is in `activeJobStatuses`, count its operations
   where the op's process is batchable, `jobOperationBatchId IS NULL`, op status
   in `('Todo','Ready','Waiting')`, and no production event — one embedded query,
   no loop.
2. Render, when count > 0: informational (not warning) notice —
   `t"{count} batchable operations are not in a batch — they run individually until batched"`.
   Plain count, no parentheses form.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** blocking job release on unbatched ops (explicitly rejected —
never block); MES job views.

## Task 15: i18n extract + translate

**Depends on:** Tasks 10–14
**Files:**
- Modify: `packages/locale/locales/*/*.po` (generated by extract; filled by /translate)

**Steps:**
1. `pnpm run lingui:extract`
2. Invoke the `/translate` skill to fill every empty `msgstr` (Haiku fan-out per
   its own procedure).
3. `pnpm run lingui:compile`

**Verify:**
```bash
pnpm run lingui:check
# Expected: exit 0, no missing translations reported
```

**Out of scope:** changing the locale list; editing glossary.json.

## Task 16: Docs sync

**Depends on:** Tasks 1–14 (content final)
**Files:**
- Modify: `apps/erp/app/modules/production/AGENTS.md` — Operation Batch section: lifecycle `Planned → Active("Released") → Completing → Completed`, release/unrelease semantics + guards, membership-handoff floor rule, batch-as-one-unit scheduling (tagged reservation, pinned members, batchType durations)
- Modify: `.claude/rules/mes-job-operation-ui.md` — the loader now enforces the handoff rule; Planned batches unreachable from the floor
- Modify: `.claude/rules/scheduling-data-structures.md` — batch pre-pass, `capacityReservation.jobOperationBatchId`, the two predicate rules (regen delete + snapshot), job-loading widening
- Modify: `.ai/specs/2026-09-04-batch-release-and-scheduling.md` — changelog entry recording implementation; also add a line to `.ai/specs/2026-08-21-job-operation-batching.md` changelog noting its HIGH scheduling risk is resolved by this feature
- Modify: `.ai/lessons.md` — only if a task surfaced a new pitfall (Context → Problem → Rule → Applies to)

**Steps:**
1. Update each file per above, documenting COMMITTED behavior only — verify each
   claim against the code you actually wrote before stating it.

**Verify:**
```bash
grep -n "Planned" apps/erp/app/modules/production/AGENTS.md | head -3
# Expected: the new lifecycle documented
```

**Out of scope:** reader-facing product docs under `docs/` (follow-up; note it
in the PR body instead).

## Task 17: Validation gates

**Depends on:** Tasks 1–16
**Files:** none (verification only)

**Steps & Verify (run all; every one must pass):**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/ee --filter=@carbon/utils --filter=@carbon/database
# Expected: exit 0 for all five
pnpm run lint
# Expected: exit 0
pnpm --filter @carbon/utils test && pnpm --filter @carbon/ee test && pnpm --filter @carbon/erp test
# Expected: all suites pass
pnpm db:check:datasets
# Expected: all datasets still apply (db:migrate already run in Task 3)
pnpm db:check:backups
# Expected: verdict OK (schema still restore-compatible)
```
Report any failure verbatim; fix within the owning task's scope, not ad hoc.

**Out of scope:** committing (only on explicit ask, per repo rule).

## Task 18: Browser verification via /test

**Depends on:** Task 17, a running stack (`crbn up`), /auth
**Files:** none (verification; screenshots to the PR later)

**Steps:** run the `/test` skill against this branch's diff with these scenarios
(each maps to a spec acceptance criterion):
1. Process form: enable batchable on a process → Batch type selector appears,
   defaults Sequential; set one process Simultaneous.
2. Builder shows candidates from a Draft job (status chip visible); create a
   batch → status Planned; confirm its member op does NOT appear on the MES
   floor (kanban + job list) even after releasing the job; confirm the MES
   operation URL for that member redirects with the "not released" flash.
3. Release the batch (drawer action) → members appear on MES floor even though
   a member job is still Draft; job list shows the Draft job.
4. A batchable op on a released job, in no batch → present on the floor and
   startable (happy path).
5. Unrelease the batch (no timers) → members leave the floor; start a timer on
   a released batch → Unrelease refuses with the named error.
6. Scheduling: after release, exactly one `capacityReservation` row exists for
   the batch (`select count(*) … where "jobOperationBatchId" = …` via psql);
   Simultaneous vs Sequential durations match `setup + max` vs `setup + Σ` for
   the seeded members.
7. Complete the batch end-to-end (existing flow) — proportional slices,
   members Done, batch Completed — unchanged behavior.
8. Job detail shows the "batchable operations not in a batch" notice when true.

**Verify:** the /test run report lists every scenario PASS. Any FAIL loops back
to the owning task. Cache the playbook per /test's own convention.

**Out of scope:** load/perf testing; multi-company scenarios beyond the standard
tenant-scoping smoke.
