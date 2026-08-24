# Job Operation Batching

> Status: in-progress
> Author: Claude (with Sid; original design decisions with Brad, 2026-07-03)
> Date: 2026-08-21
> Research: `.ai/research/job-operation-batching.md` (2026-07-03 survey — still current)
> Requirement: REQ-FUN-PRODUCTION-005 (Must, Daily)
> Tracking issue: https://github.com/crbnos/carbon/issues/1010
> Branch: `feat/job-operation-batching-v2` (fresh from `main`)
> Supersedes: the 2026-07-03 spec + plan (deleted this branch), the 2026-07-16
> best-of-both plan (branch-only), and both prior implementations —
> `feat/job-operation-batching` and PR #1137 — which are salvage sources, not
> ancestors.

## TLDR

Some processes can run several jobs at once — a laser table nests parts from
many work orders on one sheet, a furnace treats many jobs in one cycle, a paint
booth coats whatever fits. Other processes can't: a brake press runs exactly one
job at a time. **Batchability is a property of the process**: one `batchable`
flag on the `process` master record, nothing on items, methods, or operations.

A planner composes an **operation batch** (`jobOperationBatch`) on a
drag-and-drop **batch planning board** under Scheduling: pick a batchable
process, filter unstarted job operations by the material properties of their
BOM lines ("everything on the laser in 1/4-inch A36 steel"), drag them into a
batch. MES runs the batch as one card with one set of timers. Completion is a
**two-phase, resumable** workflow: it records per-member produced quantities,
slices the shared run time **proportionally to member operation quantity**,
issues material per each job's own BOM, finishes every member operation, and
posts GL — with a durable `Completing` status so a partial failure always waits
visibly for a retry instead of stranding inventory or the ledger.

**Jobs are never merged.** Each keeps its identity, status, cost, and
downstream operations; the bill of materials is never modified. There is no
batch size limit.

**Terminology:** an operation batch is unrelated to **lot/batch tracking**
(`batchNumber`, `trackedEntity`, `requiresBatchTracking`, the `issue` fn's
`jobOperationBatchComplete` case — that is *lot*-tracked completion, untouched).
Same word, different concept — the collision SAP lives with ("Batch Management"
= material lots vs combined orders). UI copy and docs keep the two distinct.
The superseded feature's old terminology (case-insensitive grep pattern
`st[i]tch`) must not appear in any code, SQL, or docs this spec produces.

## Lineage — why a fresh build

This is the third pass at #1010. Two prior implementations both reached
typecheck-green, neither merged, and each got half the answer right:

| | `feat/job-operation-batching` (ours, 2026-07-07) | PR #1137 `loop/1010-…` (agent loop, 2026-07-14) |
|---|---|---|
| Board/UX | ✅ Scheduling-placed board, faceted material filters, schedule badge/menu, MES kanban collapse | ❌ Subset board in a Production submodule |
| Edge fn shape | ✅ Lean (~476 ln), `assertEligible` gate, single feature migration | ❌ 787 ln, 4 migrations |
| Completion | ❌ Single txn + best-effort issue/GL in the MES route — a partial failure strands inventory/GL with the batch already `Completed`, no retry | ✅ Two-phase resumable; edge fn owns issue + Done + GL, idempotent |
| Time split | ❌ Inline `proportional-shares.ts`, thin tests | ✅ Tested `batch-time-split.ts` + Deno mirror |
| Board candidates | ❌ Timer-started ops listed, rejected only on drop | ✅ RPC `NOT EXISTS productionEvent` guard at the source |
| MES batch page | ❌ Start/Complete unconditional, no status surface, raw strings | ✅ Status badge, gated timers, retry relabel, live timer, i18n |
| Tests | thin | ✅ time-split, completion-membership, validator, tenant-scope/FK-lock |

The verdict (already reached in the never-executed best-of-both plan): **our
UX + their completion safety**. This spec bakes that in from day one instead of
grafting it on, which also sheds v1's accumulated warts: `Completing` is in the
initial enum (no `ADD VALUE` follow-up), the RPC ships with the started-op
guard, the MES page is status-aware and i18n'd from its first commit, and there
is one feature migration.

**Salvage rule:** port file-by-file with typecheck after each; never `git
merge` either source. Board/UX and schedule/MES integration come from
`feat/job-operation-batching`; completion machinery, `batch-time-split`, RPC
guard, and tests come from `origin/loop/1010-20260714010219` (PR #1137, closed
as superseded, branch kept). Both sources are a month behind `main` — re-verify
every "newest definition" (RPCs, views, triggers) against `main` before writing
the migration; v1's migration `20260707135312` is a reference, not a source to
copy.

An even earlier design (commit `d6c7ad3de`) put eligibility on the part — a
per-item opt-in plus per-routing-step marker. The flag belongs on the machine,
not the part (SAP multi-activity resources, Asprova furnace class,
PlanetTogether resource-level batching — research §1). That design stays dead.

## Problem Statement

When several jobs need time on the same batch-capable machine, Carbon forces
one run per job: N setups on the laser for N jobs that could have shared one
nest; N furnace cycles where the furnace only needed to run once. The operator
signs in and out of every job, machine time is over-reported N-fold or
misattributed, and the planner has no way to see which queued operations
*could* share a run — finding "everything on the laser in 1/4-inch A36" means
opening every job. Carbon has no concept of one run serving many jobs:
`jobOperation.jobId` is a required FK, and every schedule/MES/costing query
assumes an operation runs alone on its work center.

## Proposed Solution

**The process is what's batchable; the batch is a group of real job
operations.** N jobs stay N separate jobs. One specific operation from each job
— all on the same batchable process — is tagged into a `jobOperationBatch`: a
lightweight join over N real `jobOperation` rows. No lead job, no shadow rows;
every member operation remains a first-class row on its own job.

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

### Lifecycle

`Active → Completing → Completed`. That is the whole status enum — there is no
`Cancelled` (nothing ever set it in v1; a pre-start "never mind" is `dissolve`,
which deletes the batch row, and a post-start batch must be completed). Adding
an enum value later is trivial; removing one is nearly impossible.

1. **Flag** (master data): a checkbox on the process record — "Batchable —
   multiple jobs can run on this process at the same time". Laser cutting, heat
   treat, plating, painting: on. Brake press, manual mill: off.
2. **Plan** (batch planning board, under Scheduling): pick a batchable process
   at a location; the board lists every unstarted, unbatched job operation for
   that process with the material properties of its BOM lines (form, substance,
   grade, dimension, finish) as filterable facets and visible chips. The
   planner filters and drags operations into an existing batch or a "new batch"
   drop zone. Dragging into a batch that has a work center assigns that work
   center to the member operation (the same write a schedule-board drag
   performs today). Operations can be dragged out again, and batches dissolved,
   any time before the run starts.
3. **Run** (MES): the batch renders as one card (member count + summed
   quantity). The operator starts one set of Setup/Labor/Machine timers for the
   whole batch — `productionEvent` rows tagged with the batch id. Timers are
   gated to `Active`; the page shows a live elapsed timer and a status badge.
4. **Complete** (one action, two-phase, resumable): a member table pre-filled
   with each operation's quantity; the operator confirms per-member produced
   quantity and optional per-member scrap. Phase 1 commits the arithmetic in
   one transaction and flips `Active → Completing`; Phase 2 performs the
   side effects idempotently and flips `Completing → Completed`. Any Phase-2
   failure stops immediately (**fail-fast** — first error returned verbatim,
   no aggregation) and the batch waits in `Completing`; re-submitting the form
   resumes, fast-forwarding past whatever already succeeded. A resume must
   carry the **same quantities** Phase 1 recorded — an edited quantity is
   **rejected loudly**, naming the recorded values, never silently ignored and
   never rewritten. Full mechanics in the edge-function section.
5. **Cost**: the split is materialized as per-member production events, so
   every existing surface — job costing, estimates-vs-actuals, WIP/GL — shows
   each job its proportional share with **zero special-casing**. A 20-part job
   absorbs 4× the shared run time of a 5-part job.

### Eligibility gate (enforced server-side on create/add, mirrored in the RPC)

- The operation's process has `batchable = true`.
- All members share one process (`jobOperation.processId` equal across members
  — it is NOT NULL, so this is a plain equality check; nothing propagates).
- Candidate is unstarted: status in `Todo`/`Ready`/`Waiting` **and no
  `productionEvent` recorded**. The RPC carries the same `NOT EXISTS`
  predicate, so the board and the gate cannot disagree — a timer-started but
  status-unflipped op never appears as a candidate.
- Candidate not already in a batch (`jobOperationBatchId IS NULL`).
- **No size cap** (min 1 member so a batch always has content; no maximum).
- No item/work-center/material restrictions: material filters are a planning
  aid, not a constraint — the planner owns nesting compatibility (matches
  SigmaNEST/Lantek, where material match is workflow, not schema).

### Design Decisions

All rows locked: 2026-07-03 with Brad, upgraded 2026-07-16 post-#1137, grilled
2026-08-21 with Sid (see Open Questions for the audit trail).

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where batchability lives | **`process.batchable` boolean** — operations derive it via their NOT NULL `processId`; no flags on item, methodOperation, quoteOperation, or jobOperation; no get-method propagation | The machine determines simultaneity (laser vs brake press). SAP multi-activity resources / Asprova furnace class (research §1). Precedent: `process.completeAllOnScan` |
| What gets combined | **Operations, not jobs** — `jobOperationBatch` is a plain join over real `jobOperation` rows via a nullable FK | SAP Order Combination / DM process-lot pattern; jobs keep identity, status, cost, downstream chain |
| Entity naming | Table `jobOperationBatch`, FK `jobOperation.jobOperationBatchId`, readable prefix `BAT`, UI noun "batch" | Convention-true FK naming; explicitly distinct from lot-tracking "batch" (see Terminology) |
| Status enum | `('Active', 'Completing', 'Completed')` — no `Cancelled` | Nothing ever set `Cancelled` in v1; dissolve deletes the row. Dead enum states force unreachable UI branches and can't be removed later; a real cancel workflow would arrive with its own `ADD VALUE` migration |
| Batch size | **No cap** (min 1) | Brad: no size constraints. No surveyed system caps member count; capacity is physical — modeling it (PlanetTogether Batch Volume) is a separate future spec |
| Time/cost split | **Proportional to member operation quantity** (weight = `operationQuantity` / Σ; equal weights only as a Σ=0 fallback), materialized at completion by slicing each batch `productionEvent` into per-member events via the shared tested `batch-time-split` util (largest-remainder on seconds, contiguous windows) | Brad: proportional, not even. SAP quantity-distribution / CADTALK weighted-ratio. Materialized slices make GL, costing, and estimates-vs-actuals correct with no downstream changes |
| Weight basis | Planned `operationQuantity` — not produced actuals, not part area | Defined before and during the run; zero-produced members still absorb their share (scrapped parts consumed table time). Area/cut-time weights arrive with nesting import (v2) |
| Produced quantity | **Entered per member** (pre-filled with operation quantity), optional per-member scrap; NOT one total split across members | A nest cuts 5 of A and 20 of B; splitting one number across heterogeneous parts is meaningless. One screen, one action still satisfies "aggregated output" (Fulcrum confirm-parts pattern) |
| Material consumption | Per member via the existing `issue` edge fn (`type: "jobOperation"`, member's produced quantity) inside completion Phase 2 — each job consumes per **its own BOM**; `jobMaterial`/`jobMakeMethod` never rewritten | Nesting write-back pattern (research §5); reuses the machinery MES per-op completion uses today; backflush-capped so a resume re-issue is a no-op |
| Membership lifecycle | `create` (≥1 op), `add`, `remove` while no production event exists; `dissolve` deletes the batch and clears members (blocked after any event — error names the recovery: complete the batch); removing the last member dissolves | Drag-and-drop planning implies incremental add/remove; all pre-start operations are pure FK writes with nothing to unwind |
| Work center | Batch carries nullable `workCenterId`; assigning it (at create or later) writes it to all member operations; adding an op to a work-centered batch sets the op's `workCenterId` | Physically true — batching puts the job on that machine. Same write the schedule board's drag already performs. Members need NOT pre-match |
| Completion mechanism | **Two-phase, resumable**, wholly owned by the `batch-operations` edge fn. Phase 1 (one txn, `SELECT … FOR UPDATE`): slice + quantities + guarded `Active → Completing`. Phase 2 (post-commit, idempotent): issue → Done → GL → guarded `Completing → Completed` | `sync_finish_job_operation` is BEFORE/FOR EACH ROW, so each member's downstream op releases independently. v1's single-txn design left the batch `Completed` with unissued materials / unposted GL and no recovery on partial failure — the proven gap #1137 existed to close |
| Phase-2 failure mode | **Fail-fast** — stop at the first error (issue, Done flip, or GL post), return it verbatim, batch stays `Completing`; no error aggregation, no continuing to later members | Resume makes retries cheap: idempotency (backflush cap, already-`Done` skip, `postedToGL` skip) fast-forwards past completed work. One error at a time keeps the edge fn simple |
| Resume payload contract | Resume **rejects changed quantities loudly** — submitted member quantities/scrap are compared against the `productionQuantity` rows Phase 1 committed; mismatch errors with the recorded values named | Silent ignore is quiet data corruption (operator believes the edit took); accepting the edit reopens the Phase-1 transaction boundary. Post-completion corrections are out of scope (existing per-op paths apply) |
| Board placement | **Composition lives ON the operations schedule board** (`x/schedule/operations`) — no separate view. Batchable, unstarted operations get a select checkbox; a floating bar creates a batch from the selection; live batches render as one collapsed `BAT` card in their work-center column; material facets join the board's existing filter bar. (Supersedes the earlier dedicated `x/schedule/batching` board — removed 2026-08-21 at Sid's direction: the separate view read as bolted-on. APS precedent: PlanetTogether/Opcenter compose batches inside the main scheduling view) |
| Board visibility of `Completing` | A `Completing` batch's collapsed card renders **read-only** on the operations board (yellow badge, drag/dissolve/member-remove disabled, link to the MES batch page) | Durable `Completing` exists so failures wait visibly for a human — hiding them from the planning surface would undercut it |
| MES batch page states | Status badge (`secondary` Active / `yellow` Completing / `green` Completed), timers gated to `Active`, complete form enabled for `Active`+`Completing`, submit relabeled "Retry Completion" while `Completing`, live elapsed timer, all strings i18n'd | The UI counterpart of the two-phase workflow — the operator must see and retry a stuck completion |
| Planning integration | Manual board only in v1; no MRP/scheduler auto-suggestions | APS auto-grouping is solver territory (v2); manual composer matches the MES precedent (Critical Manufacturing) |
| Multi-tenancy | `jobOperationBatch` composite PK `("id","companyId")`, `id` TEXT default `id()`, `companyId` on every query | Carbon convention |
| Service shape | `(client, ...) → {data, error}` wrappers in `production.service.ts`; multi-row mutations via the `batch-operations` edge function (Kysely transaction) | `.claude/rules/conventions-services.md`; one service/models file per module |
| RLS | Policies named `SELECT`/`INSERT`/`UPDATE`/`DELETE`: view = employee role, mutations = `production_create/update/delete`, `::text[]` casts per current idiom | Matches `job`/`jobOperation`; copy the newest migration's idiom |
| Permission scoping | Routes + edge fn: `view: "production"` for reads, `update: "production"` for batch mutations | Batching mutates job operations — production scope |
| Form pattern | Process form: `Boolean` field in existing `ValidatedForm`; batch completion: `ValidatedForm` + zod validator in MES | House pattern; clone `completeAllOnScan` |
| Module layout | Validators in `production.models.ts`, services in `production.service.ts`; process flag in `resources.models.ts`/`resources.service.ts`; no new files beyond UI components/routes | One service/models per module |
| Backward compatibility | All columns additive/nullable (or defaulted); inert until a process is flagged batchable; `get_active_job_operations_by_location` re-declared additively (both boards read it); `processes` view recreated from newest definition | No frozen surface touched; unflagged behavior byte-for-byte unchanged |

## Data Model Changes

One feature migration. Re-verify every "newest definition" against `main` at
plan time (see the salvage rule).

```sql
-- 1. The capability flag (master data)
ALTER TABLE "process" ADD COLUMN "batchable" BOOLEAN NOT NULL DEFAULT false;
-- Recreate the "processes" view from its NEWEST definition including the column.

-- 2. The operation batch. Complete enum from day one; no 'Cancelled' (see
--    Design Decisions).
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

Behavioral (not new tables):

- **`get_active_job_operations_by_location`** (feeds the ERP schedule board AND
  the MES kanban): re-declare from the newest definition on `main`, adding
  `processBatchable`, `jobOperationBatchId`, `batchReadableId`
  (LEFT JOIN `jobOperationBatch`). Additive columns only; smoke both boards.
- **New RPC `get_batchable_operations`** `(location_id, process_id)` for the
  planning board:
  - Candidates: unstarted, unbatched operations of that (batchable) process at
    the location — including the
    `NOT EXISTS (SELECT 1 FROM "productionEvent" …)` started-op guard from day
    one — joined to job/item, plus a `materials` JSONB array per operation
    (`{itemReadableId, description, quantity, formName, substanceName,
    gradeName, dimensionName, finishName, formId, substanceId, gradeId,
    dimensionId, finishId}`) built from
    `jobMaterial.jobOperationId → item → material`
    (`material.id = item.readableId`) → the five property lookups. Operations
    whose BOM lines lack material rows return an empty array and group under
    "No material properties" in the UI.
  - Lanes: current members of `Active` **and** `Completing` batches for the
    process (`Completing` lanes render read-only — see UI Changes).
- After the migration: `pnpm run generate:types` before typecheck.

## API / Service Changes

### Shared util: `batch-time-split`

Port #1137's tested util — do not re-derive. `packages/utils/src/batch-time-split.ts`
(+ test, exported from the package index) with the Deno mirror at
`packages/database/supabase/functions/shared/batch-time-split.ts`. Exports
`buildBatchCompletionPlan`, `planBatchCompletion`,
`assertBatchCompletionMembership`, `sliceEventByWeight`. Largest-remainder on
seconds; contiguous sub-windows; durations sum exactly to the recorded span.

Grounded fact from the v1 build: `productionEvent.duration` is a GENERATED
column (`EXTRACT(EPOCH FROM endTime-startTime)`) and `post-production-event`
costs from it (skipping null) — so slices write start/end windows only, never
`duration`; the proportional cost falls out automatically.

### New edge function: `batch-operations`

Follows `.claude/rules/workflow-edge-function.md`: CORS preflight, zod
discriminated union, `requirePermissions(req, companyId, userId,
{ update: "production" })`, module-scope Kysely pool. Target the lean v1 shape
(~500 lines): membership cases from v1, complete case from #1137.

- `{ type: "create", jobOperationIds (min 1), workCenterId?, locationId, companyId, userId }`
  — eligibility gate (batchable process via join, single process, unstarted, no
  productionEvent, unbatched); derives `processId` from the members;
  `getNextSequence` → `BAT…`; inserts the batch; tags members; writes
  `workCenterId` to members when provided. Returns `{ id, readableId }`.
- `{ type: "add", batchId, jobOperationIds, companyId, userId }` — same gate
  per candidate + batch must be `Active` with no production events; tags
  members; propagates the batch's work center if set.
- `{ type: "remove", batchId, jobOperationIds, companyId, userId }` — blocked
  once any batch production event exists; clears the FK; removing the last
  member deletes the batch.
- `{ type: "update", batchId, workCenterId, companyId, userId }` — assigns (or
  clears) the batch's work center; when set, writes it to every member
  operation.
- `{ type: "dissolve", batchId, companyId, userId }` — blocked once any batch
  production event exists (error: "production has been recorded — complete the
  batch instead"); clears all members; deletes the batch.
- `{ type: "complete", batchId, members: [{ jobOperationId, quantity, scrapQuantity? }], companyId, userId }`
  — **two-phase, resumable**; the edge fn owns the whole completion:
  - **Phase 1** (one Kysely transaction; `SELECT … FOR UPDATE` on the batch to
    serialize completers): `planBatchCompletion(status)` → `"slice"` for
    `Active`, `"resume"` for `Completing`, throws for `Completed`.
    - `"slice"`: `assertBatchCompletionMembership` against actual membership;
      reject any still-open timer; `buildBatchCompletionPlan` — delete the
      aggregate batch events, insert per-member slices (`postedToGL = false`,
      keeping `jobOperationBatchId` for provenance); insert `productionQuantity`
      rows per member (`Production` + optional `Scrap`); guarded flip
      `Active → Completing` (`WHERE status = 'Active'`, rollback if 0 rows).
    - `"resume"`: **validate the submitted quantities against the
      `productionQuantity` rows Phase 1 committed — any mismatch errors,
      naming the recorded values** ("quantities were already recorded as
      5/20/10 — retry with those"). Then reload the already-sliced events; do
      NOT re-slice, do NOT touch quantities.
  - **Phase 2** (post-commit, idempotent, **fail-fast** — stop at the first
    error and return it; the batch stays `Completing`): per member, `issue` its
    own BOM (backflush-capped → a resume re-issue is a no-op); multi-row `Done`
    skipping already-`Done` (the per-row `sync_finish_job_operation`
    interceptor releases each job's next op independently);
    `post-production-event` per sliced event skipping `postedToGL = true`.
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

`production.models.ts`: `jobOperationBatchStatus` const
(`["Active", "Completing", "Completed"]`), `createJobOperationBatchValidator`,
`updateJobOperationBatchValidator` (add/remove/dissolve intents),
`completeJobOperationBatchValidator` (member rows with int quantities ≥ 0).
**No max-size validation anywhere.**

MES (`apps/mes/app/services/`): `getJobOperationBatch` + the completion
validator in `models.ts` (mirroring the status const). The complete action is a
single `invoke("batch-operations", { type: "complete" })` — no issue loop, no
GL calls in the route; check both `error` and `data.error` and flash on
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
| **Operations schedule board** (`x/schedule/operations` — composition integrated 2026-08-21) | Batchable, unstarted operations show a hover checkbox (selection lives in `BatchSelectionProvider`; the first pick pins the process, so only same-process ops stay selectable). A floating bar ("N selected · Create batch · Clear") submits to the `batching.update` action. Members of a live batch collapse into one **`BatchItemCard`** in the batch's work-center column: `BAT` badge, member count · summed qty, member rows with hover-remove, dissolve in the menu, "Open in MES". Dragging the batch card to another column reassigns the batch work center (edge fn writes it to every member); a `Completing` batch card is read-only (yellow badge, MES retry link). Material facets (substance/grade/dimension/form/finish) join the board's filter bar, and cards show material chips (display-setting toggle) |
| MES kanban (`apps/mes/.../ItemCard.tsx` + operations loader) | Rows sharing `jobOperationBatchId` collapse to one card: member count, summed quantity, batch readableId; card links to the batch view |
| MES batch UI — **the operation view IS the batch UI** (folded in 2026-08-21; `x/batch/$batchId` is now a redirect) | Opening any member operation (`x/operation/$operationId`) runs the page in **batch mode** when its batch is `Active`/`Completing`: the loader reads `jobOperationBatch` (membership via a direct `jobOperationBatchId` read, since the RPC omits it) and swaps in the batch's events. A **batch chip** in the info bar (`BAT… · N jobs`, yellow `Completing` badge) lists members as links to hop between them. The shared **Start/Stop** timer tags its `productionEvent` with `jobOperationBatchId` (so any member's page drives the same timer) and `event.tsx` defers cost posting to completion. `WorkTypeToggle`/`Times` read summed member durations. **Complete Batch** replaces "Log Completed" and opens `BatchCompleteModal` (per-member produced quantity pre-filled from `operationQuantity` less completed + optional scrap; "Retry Completion" while `Completing`; blocked while a timer runs). Scrap/Rework/Finish hidden in batch mode. `x/batch/$batchId` redirects to the first member's operation so ERP-board and MES-kanban links keep working; completion still POSTs to `x/batch/$batchId/complete`. All strings `<Trans>`/`t` |
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
- [ ] A completion interrupted after Phase 1 leaves the batch `Completing`; the planning board shows the lane read-only with a yellow badge; the MES page shows the badge and "Retry Completion"; re-submitting with the same quantities resumes and lands `Completed` with **no duplicated** issues, quantities, events, or GL postings.
- [ ] Retrying a `Completing` batch with **changed** quantities is rejected with an error naming the recorded quantities; nothing is written.
- [ ] Invoking `complete` on an already-`Completed` batch returns an error, not a second completion.
- [ ] Job costing / estimates-vs-actuals for each member job shows its proportional share with no special-case code path (verified by reading each member op's own events).
- [ ] Jobs/operations never batched behave byte-for-byte as before; `pnpm exec turbo run typecheck --filter=erp --filter=mes`, lint, and tests pass. Ported tests are green: batch-time-split, completion-membership, MES validator, tenant-scope/FK-locks.
- [ ] All MES batch UI strings are extracted (`mes.po` updated across locales); no raw user-facing strings.
- [ ] The superseded feature's terminology (case-insensitive grep pattern `st[i]tch`) appears nowhere in the shipped code, migrations, or docs for this feature.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Quantity weights distort cost when parts differ wildly in size (20 washers vs 5 large panels on one sheet) | Med | Documented limitation; weights live in one util — area/cut-time weights via nesting import is the designed v2 upgrade path |
| Salvaged code drifts from `main` (both source branches are a month stale) | Med | Port file-by-file with typecheck after each; never `git merge` either branch; re-verify every "newest definition" (RPCs, views, triggers) against `main` before writing the migration |
| Capacity planning (PR #1151) collides: both recreate the `processes` view (theirs switches to an explicit column list — would silently drop `batchable`) and both re-declare `get_active_job_operations_by_location` (theirs changes the signature); its `capacityReservation` is per-operation with no batch awareness, so batch members would N×-over-book a work center and nightly replan could split a batch across work centers | High | Plan's "Conflict watch" section maps every collision + resolution; migration pre-flight fails loudly if their defs land first; post-merge follow-up required on the scheduling engine (coalesce reservations per `jobOperationBatchId`, pin batched ops' work centers) — raise on #1151 review |
| `get_active_job_operations_by_location` re-declaration regresses a board (two apps consume it) | Med | Fork the newest `main` definition verbatim, additive columns only; smoke both boards |
| Sliced event windows are temporal approximations (contiguous sub-spans, not the "real" simultaneous run) | Low | Durations sum exactly to the recorded span; slices keep `jobOperationBatchId` so provenance is queryable; documented in AGENTS.md |
| Phase 1 delete+reinsert of aggregate events vs FKs (`productionQuantity.{setup,labor,machine}ProductionEventId`) | Low | Those FKs are nullable `ON DELETE SET NULL` and the batch start flow does not set them (verified in the v1/plan-B analysis); re-verify at plan time |
| Ops whose `jobMaterial` rows lack `jobOperationId` show no material chips | Low | Column exists since `20260120132502` (with backfill); "No material properties" bucket keeps them visible/batchable |
| Planner batches metrically incompatible materials (filters are advisory) | Low | Deliberate (research: material match is workflow, not schema); chips make membership visible |
| Terminology confusion with lot/batch tracking | Low | Naming decision documented; UI copy says "operation batch"; AGENTS.md and glossary spell out the distinction |

## Open Questions

> All resolved — none outstanding. Undated items were locked with Brad on
> 2026-07-03; dated items were resolved by Sid in the 2026-08-21 grill. The
> decisions are baked into the sections above; this list is the audit trail.

- [x] **Weight basis for the proportional split?** — **Answer:** planned
  `operationQuantity` (share = member qty / Σ). Produced-actuals rejected
  (undefined mid-run, zero-yield edge); part area/cut-time rejected for v1
  (needs nesting import — v2).
- [x] **Must members share a work center?** — **Answer:** no — the batch owns
  the work center and writes it to members, exactly like a schedule-board drag.
- [x] **Which material facets filter the board?** — **Answer:** form,
  substance, grade, dimension, finish (+ text search) — the normalized
  `material` FKs that exist today. An op matches if ANY of its BOM lines match
  all active facets. `materialType` omitted in v1.
- [x] **Minimum batch size?** — **Answer:** 1 (removing the last member
  dissolves). No maximum. A 1-member batch is transitional drag-and-drop
  state, not an error.
- [x] **Scrap at batch completion?** — **Answer:** optional per-member scrap
  input (posts `Scrap`-type `productionQuantity` per member). Even-split scrap
  is wrong under per-member quantities; NCR/quality workflows unchanged.
- [x] **Where do timers live while the batch runs?** — **Answer:**
  `productionEvent` rows on the first member operation, tagged
  `jobOperationBatchId`, sliced into per-member events at completion.
  (Batch-aware query-time division everywhere was the original design's latent
  GL bug.)
- [x] **Completion failure semantics?** — **Answer:** durable `Completing`
  status + idempotent Phase 2; retry by re-invoking. (Upgraded 2026-07-16 from
  the single-txn design after #1137 demonstrated the gap.)
- [x] **Phase-2 failure mode: fail-fast or continue-and-collect?** —
  **Answer: fail-fast** (Sid, 2026-08-21). Stop at the first error, return it
  verbatim, batch stays `Completing`. Resume fast-forwards past completed work,
  so retries are cheap and the edge fn stays simple.
- [x] **Retry with changed quantities?** — **Answer: reject loudly** (Sid,
  2026-08-21). Resume validates submitted quantities against the committed
  `productionQuantity` rows and errors on mismatch, naming the recorded
  values. No silent ignore, no rewrite of committed rows; post-completion
  corrections are out of scope.
- [x] **Keep the `Cancelled` enum value?** — **Answer: drop it** (Sid,
  2026-08-21). Enum is `('Active', 'Completing', 'Completed')`; dissolve-delete
  stays the only "never mind" path. `ADD VALUE` later is trivial; removal is
  nearly impossible; dead states force unreachable UI branches.
- [x] **Does the planning board show `Completing` batches?** — **Answer: yes,
  read-only** (Sid, 2026-08-21). Yellow badge, no drop targets, no dissolve,
  link to the MES batch page. Failures must wait visibly where planners look.
- [x] **Auto-suggest batches during planning/MRP?** — **Answer:** manual board
  only in v1; solver-style grouping (Opcenter operation aggregation) is v2.
- [x] **Capacity semantics (how much fits on the table/in the furnace)?** —
  **Answer:** out of scope — separate future spec (PlanetTogether Batch Volume
  pattern); v1 batches are unbounded by design.

## Changelog

- 2026-08-21: Created as the **fresh restart** on `feat/job-operation-batching-v2`,
  superseding the 2026-07-03 spec/plan (deleted this branch) and both prior
  implementations (demoted to salvage sources — see Lineage). Consolidates the
  July design (locked with Brad), the 2026-07-16 two-phase completion upgrade,
  and the PR #1137 assessment. Design baked in from day one: `Completing` in
  the initial enum, edge fn owns issue+Done+GL, shared `batch-time-split` util,
  RPC started-op guard, status-aware + i18n'd MES page.
- 2026-08-21: Grill session (Sid) — four new decisions locked: Phase-2
  fail-fast; resume rejects changed quantities loudly; `Cancelled` dropped
  from the enum; `Completing` batches visible read-only on the planning board.
  Housekeeping: deleted local `feat/job-operation-batching-v1` and remote
  `job-operation-batching-spec`; PR #1137 to be closed as superseded (branch
  kept for salvage); `feat/job-operation-batching` kept until v2 merges.
- 2026-08-21: Rewritten as a single coherent document — grill resolutions
  integrated into the body (lifecycle, edge fn, board, enum) instead of
  appended; acceptance criteria extended (resume, changed-quantity rejection,
  double-complete). Status: in-progress, ready for `/plan`.
- 2026-08-21: Implemented on `feat/job-operation-batching-v2` (plan Tasks 1–11),
  migration `20260821024449_job-operation-batching.sql`. Salvaged the board/UX +
  two-phase completion + `batch-time-split` + tests from the prior branches and
  grafted the four grill deltas (3-value enum, Phase-2 fail-fast, resume
  quantity-contract rejection, read-only Completing lanes) onto them. ERP + MES
  typecheck green, unit tests green, i18n filled across 12 locales. Browser
  e2e (Task 13) PASSED on 2026-08-21 against the running dev stack — all
  acceptance criteria verified (flag, board, facet filter, RPC guard, membership
  lifecycle, proportional completion, resume reject/accept, MES page).
- 2026-08-21: **Board composition integrated into the operations schedule board**
  (Sid: the separate view "would be a bit more integrated with the current
  system"; option B chosen). The dedicated `x/schedule/batching` board,
  `BatchingBoard` component, and schedule-nav entry are REMOVED. Replaced by:
  select-to-batch checkboxes + floating create bar on the operations board,
  collapsed `BatchItemCard` per live batch (drag across columns = work-center
  reassignment, member hover-remove, dissolve, Completing read-only), material
  facet filters + per-card material chips on the board itself. Built on the
  Vercel composition patterns: selection in a context provider (no boolean
  props threaded through the kanban), the batch card as an explicit variant
  component. The `batching.update` action route and the `batch-operations`
  edge fn are unchanged; MES is unchanged.
- 2026-08-21: MES batch page rebuilt on the JobOperation scaffold (Sid: the
  bare-card version "completely threw away the existing MES ui"). Header/info
  bar/Controls dock now reuse the operation view's components (`Controls`,
  `WorkTypeToggle`, `IconButtonWithTooltip`); batch timers are typed
  (Setup/Labor/Machine via the toggle; start action accepts `type`). Service
  select enriched (process + work center names, member time fields, event type).
- 2026-08-21: **MES batch page folded INTO the operation view** (Sid: "build on
  top of the exact same MES UI instead of adding new routes"). `x/batch/$batchId`
  shrinks to a loader-only redirect to the first member's operation; the
  operation view itself runs in batch mode when the op's batch is
  `Active`/`Completing` (loader detects membership via a direct
  `jobOperationBatchId` read + `getJobOperationBatch`, swaps in batch events via
  `getProductionEventsForBatch`). Shared Start/Stop timer tags `productionEvent`
  with `jobOperationBatchId` and `event.tsx` skips `post-production-event` for
  batch events (cost posts once at completion); batch chip in the info bar hops
  between members; `Complete Batch` opens `BatchCompleteModal`; Scrap/Rework/
  Finish hidden in batch mode; keyboard wedge disabled for batched members.
  Two new mes strings translated across 12 locales. Browser-verified end to end:
  redirect, chip, cross-member shared timer, deferred GL on stop, proportional
  slice completion (Labor 50→25/25, Machine 3→2/1 & 13→7/6), members Done + batch
  Completed, and the Completed batch reverting to a plain operation view.
- 2026-08-24: **Batch detail drawer** (Sid: "open the whole detail view" — the
  thin member-list drawer was nearly empty). `/x/production/batches/:batchId`
  now renders a full-size drawer (`BatchDetailDrawer`): header meta (status,
  process, work center, location, created date + creator avatar, notes), an
  enriched member table (item thumbnails, completed/qty with scrap callout,
  status badges, compacted cell padding so all columns fit), and a Run card —
  per-type actual-vs-plan progress bars (plan = max member setup + Σ
  labor/machine, the MES batch-mode semantics; actual from the batch's
  production events incl. an open timer's accrued elapsed) with a pulsing
  "Timer running" badge and the event history (employee avatar, relative start,
  duration — completed batches list the per-member slices, which keep the batch
  tag). New `getJobOperationBatchEvents` service fn; member select widened
  (scrap qty, time fields, thumbnail); footer actions unchanged. Verified live:
  plan 4h renders, MES-started shared timer shows running badge + accruing
  actual, stopped event shows recorded duration. 6 new strings, 12 locales.
- 2026-08-24: **Batch builder round 3** (Sid: "more flexible and BOM-aware"
  filtering + "polish up the UI, alignment"). Filtering: the fixed row of five
  property MultiSelects is replaced by a dynamic local-state "+ Filter" picker
  over the dimensions the candidates' BOMs actually contain — including the
  material ITEM itself — with removable/editable facet chips; a BOM line's
  grouping signature (grouped view, suggestions, mixed-materials warning,
  chips) now falls back to its material item's readable id when normalized
  properties are absent, so property-less BOMs group by what they consume
  instead of collapsing into "No material properties". Polish: shared Table
  gained additive `withColumnOrdering`/`withCsvExport` opt-outs (default true;
  the toolbar row collapses entirely when every control is off) so the builder
  loses its floating Columns/CSV chrome; due-window filter is one bordered
  segmented control; header/row checkboxes share identical wrapper geometry
  (measured th↔td alignment in-browser); Qty right-aligned; material chips are
  quiet outline badges; grouped view swapped Radix ScrollArea (its
  display:table viewport let wide rows overflow the card) for native scroll,
  aligned the group-header checkbox to the row checkbox column, and truncates
  the right meta; footer no longer duplicates the review panel's summary.
  Verified in-browser incl. a temporary BOM line attached to a test op
  (Material facet chip filters; group titled by the item's readable id).
- 2026-08-22: **Batch builder round 2** (Sid: eight guidance improvements + a
  builder-UI redesign). Data: the candidates API now also returns labor/machine
  times, item thumbnails, per-work-center queue load, and a hidden-ops count;
  the edge fn's create payload gains an optional `notes`. Guidance: suggestions
  ranked by setup time saved (emerald "save Xm" chips), footer "Add to BAT…"
  targets when an Active same-process batch exists (no duplicate batches), WC
  picker shows "N in queue", estimated batch run time (max setup + Σ labor + Σ
  machine) in the review summary, a due-window quick filter (7/14/30d) with
  due-date sorting, and a "N operations hidden — started or in a batch" hint.
  UI: numbered step badges (Scope → Select → Review & create), item thumbnails
  + selected-row highlight + full-cell checkbox hit areas + loading spinner in
  the table view, and a second **group-by-material** view (signature sections
  with per-group select-all and saving chips; suggestions strip is table-view
  only). Scope is deep-linkable (`?location=&process=`) and remembered
  (localStorage) along with the view choice. No migration; board unchanged.
- 2026-08-22: **Batch builder** (Sid: create batches from the Batches page, not
  only the schedule board) — a SECOND composition surface, guided/filterable/
  searchable, keyed on BOM+BOP not just the process flag. A full-screen drawer
  wizard (`ui/Batches/BatchBuilder.tsx`) launched from the Batches list
  (`New Batch`) and an Active batch's drawer (`Add operations` → add-mode). It
  revives the dead `get_batchable_operations` RPC (candidates + per-op BOM
  material properties) via a new `api/production/batchable-operations` route
  (enriched with each op's setup time/due date), then offers local search,
  material facet filters (substance/grade/dimension/form/finish — ANY BOM line
  matches ALL active facets), one-click suggested groups (candidates sharing a
  material signature), and a live preview (setup-saving + due-spread chips +
  a non-blocking "mixing materials" warning — material compatibility guides but
  never blocks, keeping the locked decision). Submits `create`/`add` to the
  unchanged `batching.update` action + `batch-operations` edge fn (the create
  branch now also returns the new batch id so the wizard can navigate to it). No
  migration, no MES change, no schedule-board change. 24 new strings translated
  across 12 locales.
- 2026-08-21: **UX round** (Sid: "lets improve all of these things") — seven
  improvements, all building ON existing surfaces: (1) setup-savings chip
  (`Setup sum → max`) and (2) due-date-spread warning (≥7 days) in the
  selection bar (context now stores the full selected operations); (3) a
  floating banner for same-process opportunities spanning 2+ work-center
  columns; (4) completion "not in this run" — a member can be excluded and
  detaches back to the schedule un-run inside the Phase-1 txn (no quantities,
  all-excluded rejected, resume drops applied exclusions and rejects new
  ones), plus a zero-quantity warning; (5) printable batch load sheet
  (`BatchLoadListPDF`, ERP `/file/batch/:id.pdf`, menu entries on the batch
  card + MES batch chip); (6) live-batch badges on the jobs table (Batches
  column), the JobBillOfProcess operation row, and the MES job DAG node;
  (7) a Batches list page under Production (`/x/production/batches`) with
  status filter, member stats, and a detail drawer. 15 new strings translated
  across 12 locales.
