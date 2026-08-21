# Job Operation Batching (v2 — fresh build)

> Status: in-progress
> Author: Claude (with Sid)
> Date: 2026-08-21
> Research: `.ai/research/job-operation-batching.md` (2026-07-03 survey — still current)
> Requirement: REQ-FUN-PRODUCTION-005 (Must, Daily)
> Tracking issue: https://github.com/crbnos/carbon/issues/1010
> Supersedes: `.ai/specs/2026-07-03-job-operation-batching.md` (deleted this branch),
> `.ai/plans/2026-07-03-job-operation-batching.md` (deleted this branch),
> `.ai/plans/2026-07-16-job-operation-batching-best-of-both.md` (branch-only, never merged)
> Branch: `feat/job-operation-batching-v2` (fresh from `main`)

## TLDR

Some processes can run several jobs at once — a laser table nests parts from many
work orders on one sheet, a furnace treats many jobs in one cycle, a paint booth
coats whatever fits. Other processes can't: a brake press runs exactly one job at
a time. **Batchability is a property of the process**: a single `batchable` flag
on the `process` master record. Every job operation whose process is batchable is
thereby batchable — no per-item flags, no per-routing-step markers.

A planner composes an **operation batch** (`jobOperationBatch`) on a drag-and-drop
**batch planning board** under Scheduling: pick a batchable process, filter the
unstarted job operations by the material properties of their BOM lines ("show me
everything on the laser that uses 1/4-inch A36 steel sheet"), and drag them into a
batch. The batch runs as one card in MES; completing it is a **two-phase,
resumable** workflow that records per-member produced quantities, splits the
shared run time **proportionally to each member operation's quantity**, issues
material per each job's own BOM, finishes every member operation, and posts GL —
with a durable `Completing` state so a partial failure is always retryable.
**Jobs are never merged** — each keeps its identity, cost, and downstream
operations; the bill of materials is never modified. There is no batch size limit.

Terminology note: an operation batch is unrelated to **lot/batch tracking**
(`batchNumber`, `trackedEntity`, `requiresBatchTracking`). Same word, different
concept — the same collision SAP lives with ("Batch Management" = material lots vs
combined orders). UI copy and docs must keep the two distinct. The superseded
feature's old terminology (case-insensitive grep pattern `st[i]tch`) must not
appear in any code, SQL, or docs this spec produces.

## Lineage — why a fresh build, and what it inherits

This is the third pass at #1010. The two prior implementations both reached
typecheck-green but neither merged, and each got half the answer right:

| | `feat/job-operation-batching` (ours, 2026-07-07) | PR #1137 `loop/1010-…` (agent loop, 2026-07-14) |
|---|---|---|
| Board/UX | ✅ Scheduling-placed board, faceted material filters, schedule-board badge/menu, MES kanban collapse | ❌ Subset board in a Production submodule |
| Edge fn shape | ✅ Lean (~476 ln), `assertEligible` gate, single feature migration | ❌ 787 ln, 4 migrations |
| Completion | ❌ Single txn + best-effort issue/GL in the MES route; a partial failure strands inventory/GL with the batch already `Completed`, no retry | ✅ Two-phase resumable `Active → Completing → Completed`; edge fn owns issue + Done + GL, idempotent |
| Time split | ❌ Inline `proportional-shares.ts`, thinner tests | ✅ Tested `batch-time-split.ts` (largest-remainder on seconds, contiguous windows) + Deno mirror |
| Board candidates | ❌ Timer-started-but-unflipped ops listed (rejected only on drop) | ✅ RPC `NOT EXISTS productionEvent` guard at the source |
| MES batch page | ❌ Start/Complete rendered unconditionally, no status surface, raw strings | ✅ Status badge, timer gated to `Active`, "Retry Completion" relabel, live elapsed timer, i18n |
| Tests | thin | ✅ time-split, completion-membership, validator, tenant-scope/FK-lock |

The never-executed merge plan (`2026-07-16-…-best-of-both.md`) already concluded:
**our UX + their completion safety**. This spec bakes that conclusion in from day
one instead of grafting it on. Both old branches remain as **salvage sources**
(port code deliberately, never wholesale-merge): board/UX and schedule/MES
integration from `feat/job-operation-batching`; completion machinery, time-split
util, RPC guard, and tests from `origin/loop/1010-20260714010219` (PR #1137).

Starting fresh also removes v1's accumulated warts: the `Completing` enum value is
in the initial `CREATE TYPE` (no `ADD VALUE` follow-up migration), the RPC ships
with the started-op guard, the MES page is status-aware and i18n'd from its first
commit, and there is one feature migration instead of a base + patches.

An even earlier design (commit `d6c7ad3de`) modeled eligibility wrong — a
per-item opt-in plus per-routing-step marker. The flag belongs on the machine,
not the part (SAP multi-activity resources, Asprova furnace class, PlanetTogether
resource-level batching — research §1). That design stays dead.

## Problem Statement

When several jobs need time on the same batch-capable machine, Carbon forces one
run per job: N setups on the laser table for N jobs that could have shared one
nest; N furnace cycles where the furnace only needed to run once. The operator
signs in and out of every job, the machine time is over-reported N-fold or
misattributed, and the planner has no way to see which queued operations *could*
share a run — finding "everything on the laser in 1/4-inch A36" means opening
every job. Carbon has no concept of one run serving many jobs: `jobOperation.jobId`
is a required FK, and every schedule/MES/costing query assumes an operation runs
alone on its work center.

## Proposed Solution

**The process is what's batchable; the batch is a group of real job operations.**
N jobs stay N separate jobs. One specific operation from each job — all on the
same batchable process — is tagged into a `jobOperationBatch`: a lightweight join
over N real `jobOperation` rows. No lead job, no shadow rows; every member
operation remains a first-class row on its own job.

```
process "Laser Cutting"  (batchable = true)
   │
jobOperationBatch BAT000001 · work center: Laser 2
   │
   ├── Job A · op "Laser Cut" (qty 5)  ──┐  members — same process, grouped
   ├── Job B · op "Laser Cut" (qty 20) ──┤  by the planner from the batch
   └── Job C · op "Laser Cut" (qty 10) ──┘  planning board, never merged

Job A's next op (Deburr, qty 5)   ─┐  each job's OWN downstream operations and
Job B's next op (Brake, qty 20)   ─┤  dependency chain are untouched — they
Job C's next op (Weld, qty 10)    ─┘  release on their own job, same as today

process "Brake Press"  (batchable = false)  → its operations never batch
```

### Key behaviors

1. **Flag** (master data): a checkbox on the process record — "Batchable —
   multiple jobs can run on this process at the same time". Laser cutting,
   heat treat, plating, painting: on. Brake press, manual mill: off.
2. **Plan** (batch planning board, under Scheduling): pick a batchable process at
   a location; the board lists every unstarted, unbatched job operation for that
   process with the material properties of its BOM lines (form, substance, grade,
   dimension, finish) as filterable facets and visible chips. The planner filters
   — e.g. substance Steel, grade A36, dimension 1/4" — and drags operations into
   an existing batch or a "new batch" drop zone. Dragging into a batch that has a
   work center assigns that work center to the member operation (same effect as
   dragging a card between schedule-board columns today). Operations can be
   dragged out again, and batches dissolved, any time before the run starts.
3. **Run** (MES): the batch renders as one card (member count + summed quantity).
   The operator starts one set of Setup/Labor/Machine timers for the whole batch —
   `productionEvent` rows tagged with the batch id. Timers are gated to batches in
   `Active` status; the page shows a live elapsed timer and a status badge.
4. **Complete** (one action, two-phase, resumable): a member table pre-filled with
   each operation's quantity; the operator confirms per-member produced quantity
   (and optional per-member scrap). Phase 1 (one transaction) closes and slices
   the recorded events into per-member events with durations **proportional to
   member operation quantity** (largest-remainder on seconds, contiguous
   sub-windows), inserts per-member `productionQuantity` rows, and flips the batch
   `Active → Completing`. Phase 2 (post-commit, idempotent) issues material for
   each member via the existing `issue` edge function — consumption follows
   **each job's own BOM** — sets every member operation `Done` (the existing
   per-row `sync_finish_job_operation` interceptor releases each job's downstream
   operation independently), posts GL per member event via `post-production-event`,
   then flips `Completing → Completed`. A failure mid-Phase-2 leaves the batch
   `Completing`; re-submitting resumes without double effects.
5. **Cost**: because the split is materialized as per-member production events,
   every existing surface — job costing, estimates-vs-actuals, WIP/GL — shows each
   job its proportional share with **zero special-casing**. A 20-part job absorbs
   4× the shared run time of a 5-part job.

### Eligibility gate (enforced server-side on create/add, mirrored in the RPC)

- The operation's process has `batchable = true`.
- All members share one process (`jobOperation.processId` equal across members —
  it is NOT NULL, so this is a plain equality check; nothing propagates).
- Candidate operation is unstarted: status in `Todo`/`Ready`/`Waiting` **and no
  `productionEvent` recorded** (the RPC carries the same `NOT EXISTS` predicate so
  timer-started-but-unflipped ops never appear as candidates — the gate and the
  board can't disagree).
- Candidate not already in a batch (`jobOperationBatchId IS NULL`).
- **No size cap** (min 1 member so a batch always has content; no maximum).
- No item/work-center/material restrictions: material filters are a planning aid,
  not a constraint — the planner owns nesting compatibility (matches SigmaNEST/
  Lantek, where material match is workflow, not schema).

## Design Decisions

All decisions below were resolved with Brad on 2026-07-03 and remain locked; the
completion mechanism and MES-page decisions were upgraded 2026-07-16 (post-#1137)
and are locked as upgraded. Restated here so this spec stands alone.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where batchability lives | **`process.batchable` boolean** — job operations derive it via their NOT NULL `processId`; no flags on item, methodOperation, quoteOperation, or jobOperation, and no get-method propagation | The machine determines simultaneity (laser vs brake press). SAP multi-activity resources / Asprova furnace class (research §1). Precedent: `process.completeAllOnScan` |
| What gets combined | **Operations, not jobs** — `jobOperationBatch` is a plain join over real `jobOperation` rows via a nullable FK | SAP Order Combination / DM process-lot pattern; jobs keep identity, status, cost, downstream chain |
| Entity naming | Table `jobOperationBatch`, FK `jobOperation.jobOperationBatchId`, readable prefix `BAT`, UI noun "batch" | Convention-true FK naming; explicitly distinct from lot-tracking "batch" (the `issue` fn's `jobOperationBatchComplete` case = *lot*-tracked completion — unrelated, untouched) |
| Batch size | **No cap** (min 1) | Brad 2026-07-03. No surveyed system caps member count; capacity is physical, and modeling it (PlanetTogether Batch Volume) is a separate future spec |
| Time/cost split | **Proportional to member operation quantity** (weight = `operationQuantity` / Σ; equal weights only as a Σ=0 fallback), materialized at completion by slicing each batch `productionEvent` into per-member events (largest-remainder on seconds, contiguous windows) via the shared tested `batch-time-split` util | Brad 2026-07-03: proportional, not even. SAP quantity-distribution / CADTALK weighted-ratio. Materialized slices make GL, costing, and estimates-vs-actuals correct with no downstream changes |
| Weight basis | Planned `operationQuantity`, not produced actuals, not part area | Defined before and during the run; zero-produced members still absorb their share (scrapped parts consumed table time). Area/cut-time weights arrive with nesting import (v2) |
| Produced quantity | **Entered per member** (pre-filled with operation quantity), optional per-member scrap; NOT one total split across members | A nest cuts 5 of A and 20 of B; splitting one number across heterogeneous parts is meaningless. One screen, one action still satisfies "aggregated output" (Fulcrum confirm-parts pattern) |
| Material consumption | Per member via the existing `issue` edge fn (`type: "jobOperation"`, member's produced quantity) inside completion Phase 2 — each job consumes per **its own BOM**; `jobMaterial`/`jobMakeMethod` never rewritten | Nesting write-back pattern (research §5); reuses the machinery MES per-op completion uses today; backflush-capped so a resume re-issue is a no-op |
| Membership lifecycle | `create` (≥1 op), `add`, `remove` while no production event exists; `dissolve` deletes the batch and clears members (blocked after any event — error names the recovery: complete the batch); removing the last member dissolves | Drag-and-drop planning implies incremental add/remove; all pre-start operations are pure FK writes with nothing to unwind |
| Work center | Batch carries nullable `workCenterId`; assigning it (at create or later) writes it to all member operations; adding an op to a batch with a work center sets the op's `workCenterId` | Physically true — batching puts the job on that machine. Same write the schedule board's drag already performs. Members need NOT pre-match |
| Completion mechanism | **Two-phase, resumable** (`Active → Completing → Completed`), wholly owned by the `batch-operations` edge fn. Phase 1 (one txn, `SELECT … FOR UPDATE`): slice events → insert quantities → guarded `Active → Completing`. Phase 2 (post-commit, idempotent): issue BOM → multi-row `Done` skipping already-`Done` → post GL per event skipping `postedToGL` → guarded `Completing → Completed`. Any Phase-2 throw leaves the batch `Completing`; re-invoking resumes | `sync_finish_job_operation` is BEFORE/FOR EACH ROW, so each member's downstream op releases independently. A single-txn design (v1) left the batch `Completed` with unissued materials / unposted GL and no recovery on partial failure — proven gap, the reason #1137 existed |
| Board placement | **Scheduling** (`x/schedule/batching`), beside the operations schedule board | Batch composition is a planner activity; v1's placement, judged better than #1137's Production submodule |
| MES batch page states | Status badge (`Active`/yellow `Completing`/green `Completed`), timers gated to `Active`, complete form enabled for `Active`+`Completing`, submit relabels "Retry Completion" while `Completing`, live elapsed timer, all strings i18n'd (`<Trans>`/`t`) | The UI counterpart of the two-phase workflow — the operator must be able to see and retry a stuck completion |
| Planning integration | Manual board only in v1; no MRP/scheduler auto-suggestions | APS auto-grouping is solver territory (v2); manual composer matches the MES precedent (Critical Manufacturing) |
| Multi-tenancy | `jobOperationBatch` composite PK `("id","companyId")`, `id` TEXT default `id()`, `companyId` on every query | Carbon convention |
| Service shape | `(client, ...) → {data, error}` wrappers in `production.service.ts`; multi-row mutations via the `batch-operations` edge function (Kysely transaction) | `.claude/rules/conventions-services.md`; one service/models file per module |
| RLS | Policies named `SELECT`/`INSERT`/`UPDATE`/`DELETE`: view = employee role, mutations = `production_create/update/delete`, `::text[]` casts per current idiom | Matches `job`/`jobOperation`; copy the newest migration's idiom |
| Permission scoping | Routes + edge fn: `view: "production"` for reads, `update: "production"` for batch mutations | Batching mutates job operations — production scope |
| Form pattern | Process form: `Boolean` field in existing `ValidatedForm`; batch completion: `ValidatedForm` + zod validator in MES | House pattern; clone `completeAllOnScan` |
| Module layout | Validators in `production.models.ts`, services in `production.service.ts`; process flag in `resources.models.ts`/`resources.service.ts`; no new files beyond UI components/routes | One service/models per module |
| Backward compatibility | All columns additive/nullable (or defaulted); inert until a process is flagged batchable; `get_active_job_operations_by_location` re-declared additively (both boards read it); `processes` view recreated from newest definition | No frozen surface touched; unflagged behavior byte-for-byte unchanged |

## Data Model Changes

One feature migration. Verify every "newest definition" against the live tree at
plan time — v1's migration (`20260707135312`, branch-only) is a reference, not a
source to copy blindly; `main` has moved since July.

```sql
-- 1. The capability flag (master data)
ALTER TABLE "process" ADD COLUMN "batchable" BOOLEAN NOT NULL DEFAULT false;
-- Recreate the "processes" view from its NEWEST definition including the column.

-- 2. The operation batch — 'Completing' is in the initial enum (fresh build:
--    no ADD VALUE follow-up migration needed). No 'Cancelled': nothing ever set
--    it in v1 (dissolve DELETES the row); add via ADD VALUE if a real cancel
--    workflow ever exists.
CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completing', 'Completed');

CREATE TABLE "jobOperationBatch" (
    "id" TEXT NOT NULL DEFAULT id(),
    "readableId" TEXT NOT NULL,               -- BAT000001 (getNextSequence)
    "companyId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,                -- every member matches this
    "workCenterId" TEXT,                      -- where the batch runs; propagated to members
    "locationId" TEXT NOT NULL,               -- planning board is per-location
    "status" "jobOperationBatchStatus" NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "customFields" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "jobOperationBatch_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "jobOperationBatch_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobOperationBatch_processId_fkey" FOREIGN KEY ("processId")
      REFERENCES "process"("id"),
    CONSTRAINT "jobOperationBatch_workCenterId_fkey" FOREIGN KEY ("workCenterId")
      REFERENCES "workCenter"("id") ON DELETE SET NULL,
    CONSTRAINT "jobOperationBatch_locationId_fkey" FOREIGN KEY ("locationId")
      REFERENCES "location"("id"),
    CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
);
-- RLS: SELECT employee role; INSERT/UPDATE/DELETE production_create/update/delete
-- (policy names "SELECT" etc., ::text[] casts — copy the newest migration idiom).

-- 3. Membership — one nullable FK on jobOperation
ALTER TABLE "jobOperation" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
CREATE INDEX "jobOperation_jobOperationBatchId_idx"
  ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 4. Batch-tagged timers (while running; slices keep the tag for auditability)
ALTER TABLE "productionEvent" ADD COLUMN "jobOperationBatchId" TEXT;
-- + same composite FK shape (ON DELETE SET NULL) + partial index

-- 5. Sequence for readable ids (existing companies via migration,
--    new companies via the seed-company sequences seed)
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'jobOperationBatch', 'Operation Batch', 'BAT', NULL, 0, 6, 1, "id"
FROM "company" ON CONFLICT DO NOTHING;
```

Also required (behavioral, not new tables):

- **`get_active_job_operations_by_location`** (feeds the ERP schedule board AND
  the MES kanban): re-declare from the newest definition on `main` adding
  `processBatchable`, `jobOperationBatchId`, `batchReadableId`
  (LEFT JOIN `jobOperationBatch`).
- **New RPC `get_batchable_operations`** `(location_id, process_id)` for the
  planning board: unstarted, unbatched operations of that (batchable) process at
  the location — **including the `NOT EXISTS (SELECT 1 FROM "productionEvent" …)`
  started-op guard from day one** — joined to job/item, plus a `materials` JSONB
  array per operation (`{itemReadableId, description, quantity, formName,
  substanceName, gradeName, dimensionName, finishName, formId, substanceId,
  gradeId, dimensionId, finishId}`) built from
  `jobMaterial.jobOperationId → item → material` (`material.id = item.readableId`)
  → the five property lookups. Operations whose BOM lines lack material rows
  return an empty array and group under "No material properties" in the UI. Also
  returns current members of `Active` **and `Completing`** batches for the
  process (to render batch lanes; `Completing` lanes are read-only — see UI).
- After migration: `pnpm run generate:types` before typecheck.

## API / Service Changes

### Shared util: `batch-time-split`

Port #1137's tested util (do not re-derive):
`packages/utils/src/batch-time-split.ts` + test, exported from the package index,
with the Deno mirror at
`packages/database/supabase/functions/shared/batch-time-split.ts`. Exports
`buildBatchCompletionPlan`, `planBatchCompletion`,
`assertBatchCompletionMembership`, `sliceEventByWeight`. Largest-remainder on
seconds; contiguous sub-windows; durations sum exactly to the recorded span.
Note `productionEvent.duration` is a GENERATED column
(`EXTRACT(EPOCH FROM endTime-startTime)`) and `post-production-event` costs from
it — so slices write start/end windows only, never `duration`; the proportional
cost falls out automatically (grounded correction from the v1 build, 2026-07-07).

### New edge function: `batch-operations`

Follows `.claude/rules/workflow-edge-function.md`: CORS preflight, zod
discriminated union, `requirePermissions(req, companyId, userId,
{ update: "production" })`, module-scope Kysely pool. Target the lean v1 shape
(~500 lines), with the membership cases from v1 and the complete case from #1137:

- `{ type: "create", jobOperationIds (min 1), workCenterId?, locationId, companyId, userId }`
  — eligibility gate (batchable process via join, single process, unstarted, no
  productionEvent, unbatched); derives `processId` from the members;
  `getNextSequence` → `BAT…`; inserts the batch; tags members; writes
  `workCenterId` to members when provided. Returns `{ id, readableId }`.
- `{ type: "add", batchId, jobOperationIds, companyId, userId }` — same gate per
  candidate + batch must be `Active` with no production events; tags members;
  propagates the batch's work center if set.
- `{ type: "remove", batchId, jobOperationIds, companyId, userId }` — blocked once
  any batch production event exists; clears the FK; removing the last member
  deletes the batch.
- `{ type: "update", batchId, workCenterId, companyId, userId }` — assigns (or
  clears) the batch's work center; when set, writes it to every member operation.
- `{ type: "dissolve", batchId, companyId, userId }` — blocked once any batch
  production event exists (error: "production has been recorded — complete the
  batch instead"); clears all members; deletes the batch.
- `{ type: "complete", batchId, members: [{ jobOperationId, quantity, scrapQuantity? }], companyId, userId }`
  — **two-phase, resumable**; the edge fn owns the whole completion:
  - **Phase 1** (one Kysely transaction, `SELECT … FOR UPDATE` on the batch to
    serialize completers): `planBatchCompletion(status)` returns `"slice"` for
    `Active` or `"resume"` for `Completing` (throws for `Completed`/terminal). On
    `"slice"`: `assertBatchCompletionMembership` against actual membership, reject
    any still-open timer, `buildBatchCompletionPlan` — delete the aggregate batch
    events, insert per-member slices (`postedToGL = false`, keeping
    `jobOperationBatchId` for provenance), insert `productionQuantity` rows per
    member (`Production` + optional `Scrap`), guarded flip `Active → Completing`
    (`WHERE status = 'Active'`, rollback if 0 rows). On `"resume"`: reload the
    already-sliced events; do NOT re-slice.
  - **Phase 2** (post-commit, idempotent): per member, `issue` its own BOM
    (backflush-capped → resume re-issue is a no-op), propagating errors; multi-row
    `Done` skipping already-`Done` (per-row interceptor releases each job's next
    op); `post-production-event` per sliced event skipping `postedToGL = true`,
    propagating errors.
  - **Finalize**: guarded flip `Completing → Completed`. Returns
    `{ completed, memberIds, eventIds }`.

### `production.service.ts` additions (`apps/erp/app/modules/production/`)

```typescript
getJobOperationBatch(client, batchId, companyId)          // batch + member ops + jobs
getBatchableOperations(client, { locationId, processId, companyId })  // rpc wrapper
getActiveBatchesByProcess(client, { processId, locationId, companyId })
createJobOperationBatch(client, payload)     // invoke("batch-operations", { type: "create" })
addToJobOperationBatch(client, payload)      // type: "add"
removeFromJobOperationBatch(client, payload) // type: "remove"
dissolveJobOperationBatch(client, payload)   // type: "dissolve"
```

`production.models.ts`: `jobOperationBatchStatus` const (includes `"Completing"`),
`createJobOperationBatchValidator`, `updateJobOperationBatchValidator` (add/
remove/dissolve intents), `completeJobOperationBatchValidator` (member rows with
int quantities ≥ 0). **No max-size validation anywhere.**

MES (`apps/mes/app/services/`): `getJobOperationBatch`, batch completion
validator in `models.ts` (mirror the `Completing` status const). The complete
action is a single `invoke("batch-operations", { type: "complete" })` — no issue
loop, no GL calls in the route; check both `error` and `data.error` and flash on
failure. A failed completion leaves the batch `Completing`; re-submitting the
form resumes it.

### `resources` module

`processValidator` gains `batchable: zfd.checkbox()`; `upsertProcess` passes it
through; `ProcessForm` gains the Boolean field (clone `completeAllOnScan`).

## UI Changes

| Surface | Change |
|---------|--------|
| Process form (`resources/ui/Processes/ProcessForm.tsx`) | "Batchable" checkbox — "Multiple jobs can run on this process at the same time (laser table, furnace, plating bath)" |
| Processes table | `Batchable` boolean column/badge |
| **Batch planning board** (new: `x/schedule/batching`, salvage from v1) | Location + batchable-process pickers; left pane = filterable candidate operations (cards: job, item, quantity, due date, material chips), faceted URL-param filters on form/substance/grade/dimension/finish + search (clone the operations board's `Filter`/`ActiveFilters`/`useFilters` pattern; pickers reuse the existing material-lookup comboboxes); right pane = batch lanes (readableId, work center, members, summed qty) + "New batch" drop zone; `@dnd-kit` drag in/out; work-center assignment on the lane; dissolve action. `Active` lanes are full drag targets; **`Completing` lanes render read-only** — yellow badge, no drop targets, no dissolve, a link to the MES batch page ("completion in progress — retry there") — so a stuck completion is visible where planners look. Persists via fetcher to an action route calling the service wrappers |
| Schedule board (`ui/Schedule/Kanban/ItemCard.tsx`) | Batched ops render a `BAT000001` badge; card menu gains "Batch planning" (nav, process pre-filtered) for batchable unbatched ops and "Remove from batch" (guarded) for batched ones |
| MES kanban (`apps/mes/.../ItemCard.tsx` + operations loader) | Rows sharing `jobOperationBatchId` collapse to one card: member count, summed quantity, batch readableId; card links to the batch view |
| MES batch view (new: `x/batch/$batchId`, status-aware from day one) | Status Badge (`secondary` Active / `yellow` Completing / `green` Completed); member table (job, item, quantity, due date, link to each member op); Start/Stop timers gated to `Active`, live elapsed timer (`formatDurationMilliseconds` tick); **Complete Batch** form: per-member produced quantity (pre-filled) + optional scrap, enabled for `Active`+`Completing`, submit relabeled "Retry Completion" while `Completing` with a short explanatory line; copy stating time splits proportionally to quantity; all strings `<Trans>`/`t` (extraction covers `mes.po`) |
| Job detail | Member operation shows the batch badge; estimates-vs-actuals needs **no math change** (per-member events) — optional "part of BAT…" badge only |

## Acceptance Criteria

- [ ] Toggling `batchable` on a process makes its unstarted job operations appear on the batch planning board; unflagged processes are absent from the process picker and their operations never offer batch actions.
- [ ] Filtering candidates by substance=Steel + grade=A36 + dimension=1/4" shows exactly the operations whose BOM lines resolve to those material properties; an operation consuming aluminum disappears; operations with no material-bearing BOM lines group under "No material properties".
- [ ] Dragging 3 operations (different jobs, different items) into "New batch" creates a `jobOperationBatch` with a `BAT`-sequence readableId, tags all 3, and both boards render one card; dragging one out again untags it; a 30-member batch is accepted (no cap).
- [ ] An operation with a recorded `productionEvent` (timer started, status unflipped) never appears as a board candidate (RPC guard), and the server independently rejects it on create/add.
- [ ] Assigning the batch a work center writes that `workCenterId` to every member operation; adding an op to a work-centered batch sets the op's work center.
- [ ] Server rejects (with a specific error per rule): mixing processes, a non-batchable process, a started operation, an already-batched operation, and add/remove/dissolve after any batch production event (dissolve error names the recovery: complete the batch).
- [ ] Starting the batch in MES creates `productionEvent` rows tagged with `jobOperationBatchId`; the batch card shows the running timer; timers are hidden for a non-`Active` batch.
- [ ] Completing a batch (members qty 5/20/10, one 70-minute machine event) yields per-member events of 10/40/20 minutes (largest-remainder on seconds, contiguous windows), per-member `productionQuantity` rows matching the entered quantities (+ scrap rows where entered), one `issue` call per member consuming that job's own BOM (no `jobMaterial` row rewritten), all members `Done`, each member job's next operation independently flipping to `Ready`, batch `Completed`, and GL posted per member event.
- [ ] A completion interrupted after Phase 1 leaves the batch `Completing`; the MES page shows the yellow badge and "Retry Completion"; re-submitting resumes and lands `Completed` with **no duplicated** issues, quantities, events, or GL postings.
- [ ] Invoking `complete` on an already-`Completed` batch returns an error, not a second completion.
- [ ] Job costing / estimates-vs-actuals for each member job shows its proportional share with no special-case code path (verified by reading each member op's own events).
- [ ] Jobs/operations never batched behave byte-for-byte as before; `pnpm exec turbo run typecheck --filter=erp --filter=mes`, lint, and tests pass. Ported tests are green: batch-time-split, completion-membership, MES validator, tenant-scope/FK-locks.
- [ ] All MES batch UI strings are extracted (`mes.po` updated across locales); no raw user-facing strings.
- [ ] The superseded feature's terminology (case-insensitive grep pattern `st[i]tch`) appears nowhere in the shipped code, migrations, or docs for this feature.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Quantity weights distort cost when parts differ wildly in size (20 washers vs 5 large panels on one sheet) | Med | Documented limitation; weights live in one util — area/cut-time weights via nesting import is the designed v2 upgrade path |
| Sliced event windows are temporal approximations (contiguous sub-spans, not the "real" simultaneous run) | Low | Durations sum exactly to the recorded span; slices keep `jobOperationBatchId` so provenance is queryable; documented in AGENTS.md |
| `get_active_job_operations_by_location` re-declaration regresses a board (two apps consume it) | Med | Fork the newest `main` definition verbatim, additive columns only; smoke both boards |
| Phase 1 delete+reinsert of aggregate events vs FKs (`productionQuantity.{setup,labor,machine}ProductionEventId`) | Low | Those FKs are nullable `ON DELETE SET NULL` and the batch start flow does not set them (verified in the v1/plan-B analysis); re-verify at plan time |
| Salvaged code drifts from `main` (both source branches are a month stale) | Med | Port file-by-file with typecheck after each; never `git merge` either branch; re-verify every "newest definition" (RPCs, views, triggers) against `main` before writing the migration |
| Ops whose `jobMaterial` rows lack `jobOperationId` show no material chips | Low | Column exists since `20260120132502` (with backfill); "No material properties" bucket keeps them visible/batchable |
| Planner batches metrically incompatible materials (filters are advisory) | Low | Deliberate (research: material match is workflow, not schema); chips make membership visible |
| Terminology confusion with lot/batch tracking | Low | Naming decision documented; UI copy says "operation batch"; AGENTS.md and glossary spell out the distinction |

## Open Questions

> All resolved — no unanswered questions remain. Items without a date are
> carried forward from the 2026-07-03 design sessions with Brad (locked);
> dated items were resolved by Sid in the 2026-08-21 grill.

- [x] **Weight basis for the proportional split?** Planned `operationQuantity`
  (share = member qty / Σ). Produced-actuals rejected (undefined mid-run,
  zero-yield edge); part area/cut-time rejected for v1 (needs nesting import — v2).
- [x] **Must members share a work center?** No — the batch owns the work center
  and writes it to members, exactly like a schedule-board drag.
- [x] **Which material facets filter the board?** Form, substance, grade,
  dimension, finish (+ text search) — the normalized `material` FKs that exist
  today. An op matches if ANY of its BOM lines match all active facets.
  `materialType` omitted in v1.
- [x] **Minimum batch size?** 1 (removing the last member dissolves). No maximum.
  A 1-member batch is transitional drag-and-drop state, not an error.
- [x] **Scrap at batch completion?** Optional per-member scrap input (posts
  `Scrap`-type `productionQuantity` per member). Even-split scrap is wrong under
  per-member quantities; NCR/quality workflows unchanged.
- [x] **Where do timers live while the batch runs?** `productionEvent` rows on
  the first member operation, tagged `jobOperationBatchId`, sliced into per-member
  events at completion. (Batch-aware query-time division everywhere was the
  original design's latent GL bug.)
- [x] **Completion failure semantics?** Durable `Completing` status + idempotent
  Phase 2; retry by re-invoking with the same payload. (Upgraded 2026-07-16 from
  the single-txn design after #1137 demonstrated the gap.)
- [x] **Phase-2 failure mode: fail-fast or continue-and-collect?** — **Answer:
  fail-fast** (Sid, 2026-08-21). Phase 2 stops at the first error (issue, Done
  flip, or GL post), the batch stays `Completing`, and the error is returned
  verbatim. No error aggregation, no continuing to later members. Resume makes
  retries cheap: idempotency (backflush cap, already-`Done` skip, `postedToGL`
  skip) means the retry fast-forwards past completed work and re-attempts only
  the failed step onward.
- [x] **Retry with changed quantities?** — **Answer: reject loudly** (Sid,
  2026-08-21). The resume branch compares the submitted member quantities (and
  scrap) against the `productionQuantity` rows Phase 1 already committed; any
  mismatch errors with the recorded values named ("quantities were already
  recorded as 5/20/10 — retry with those") instead of silently ignoring the
  edit or rewriting committed rows. "Re-invoking with the same payload resumes"
  is an enforced contract, not an assumption. Post-completion quantity
  corrections are out of scope (existing per-op correction paths apply).
- [x] **Keep the `Cancelled` enum value?** — **Answer: drop it** (Sid,
  2026-08-21). Enum is `('Active', 'Completing', 'Completed')`. Nothing in v1
  ever set `Cancelled` — dissolve deletes the batch row, which remains the only
  "never mind" path (pre-start there is nothing worth keeping; post-start you
  complete). Adding an enum value later is trivial (`ADD VALUE`), removing one
  is nearly impossible — dead states also force unreachable UI branches. If a
  real cancel workflow ever exists, it arrives with its own migration.
- [x] **Does the planning board show `Completing` batches?** — **Answer: yes,
  read-only** (Sid, 2026-08-21). The RPC returns `Active` + `Completing`
  batches; `Completing` lanes render with the yellow badge, no drop targets,
  no dissolve, and a link to the MES batch page. Durable `Completing` exists so
  failures wait visibly for a human — hiding them from the planning surface
  would undercut it. Drag/dissolve stay gated to `Active`.
- [x] **Auto-suggest batches during planning/MRP?** Manual board only in v1;
  solver-style grouping is v2.
- [x] **Capacity semantics (how much fits on the table/in the furnace)?** Out of
  scope — separate future spec (PlanetTogether Batch Volume pattern); v1 batches
  are unbounded by design.

## Changelog

- 2026-08-21: **Fresh restart** on `feat/job-operation-batching-v2`. Consolidates
  the 2026-07-03 spec (as upgraded 2026-07-16 with the two-phase completion), the
  best-of-both merge plan, and the PR #1137 assessment into one self-contained
  spec; the stale 07-03 spec and plan are deleted from this branch. Design baked
  in from day one rather than grafted: `Completing` in the initial enum, edge fn
  owns issue+Done+GL, shared `batch-time-split` util, RPC started-op guard,
  status-aware + i18n'd MES page. Prior branches demoted to salvage sources.
  Research file kept as-is (survey still current). Next step: `/plan`.
- 2026-08-21: Grill session (Sid) — four design decisions locked and written to
  Resolved Questions: Phase-2 fail-fast; resume rejects changed quantities
  loudly; `Cancelled` dropped from the enum; `Completing` batches visible
  read-only on the planning board (RPC returns Active + Completing).
  Housekeeping: deleted redundant local `feat/job-operation-batching-v1` and
  stale remote `job-operation-batching-spec`; PR #1137 to be closed as
  superseded (branch kept for salvage); `feat/job-operation-batching` kept
  until v2 merges, then deleted.
- 2026-08-21: Finalized — every open question resolved (none outstanding),
  status → in-progress. Ready for `/plan`.
