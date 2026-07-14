# Job Operation Batching

> Status: in-progress
> Author: Claude (with Brad)
> Date: 2026-07-03
> Research: `.ai/research/job-operation-batching.md`
> Requirement: REQ-FUN-PRODUCTION-005 (Must, Daily)
> Tracking issue: https://github.com/crbnos/carbon/issues/1010 (suggest retitling to "Job Operation Batching")
> Supersedes: the never-merged prior design (commit `d6c7ad3de`, branch-only)

## TLDR

Some processes can run several jobs at once — a laser table nests parts from many
work orders on one sheet, a furnace treats many jobs in one cycle, a paint booth
coats whatever fits. Other processes can't: a brake press runs exactly one job at
a time. **Batchability is a property of the process**, so this spec adds a single
`batchable` flag to the `process` master record. Every job operation whose process
is batchable is thereby batchable — no per-item flags, no per-routing-step markers.

A planner composes an **operation batch** (`jobOperationBatch`) on a new
drag-and-drop **batch planning board**: pick a batchable process, filter the
unstarted job operations by the material properties of their BOM lines ("show me
everything on the laser that uses 1/4-inch A36 steel sheet"), and drag them into a
batch. The batch runs as one card in MES; completing it records per-member produced
quantities, splits the shared run time **proportionally to each member operation's
quantity**, issues material per each job's own BOM, and finishes every member
operation in one action. **Jobs are never merged** — each keeps its identity, cost,
and downstream operations; the bill of materials is never modified. There is no
batch size limit.

Terminology note: an operation batch is unrelated to **lot/batch tracking**
(`batchNumber`, `trackedEntity`, `requiresBatchTracking`). Same word, different
concept — the same collision SAP lives with ("Batch Management" = material lots vs
combined orders). UI copy and docs must keep the two distinct.

## Problem Statement

When several jobs need time on the same batch-capable machine, Carbon forces one
run per job: N setups on the laser table for N jobs that could have shared one
nest; N furnace cycles where the furnace only needed to run once. The operator
signs in and out of every job, the machine time is over-reported N-fold or
misattributed, and the planner has no way to see which queued operations *could*
share a run — finding "everything on the laser in 1/4-inch A36" means opening
every job.

Carbon has no concept of one run serving many jobs: `jobOperation.jobId` is a
required FK, and every schedule/MES/costing query assumes an operation runs alone
on its work center.

The prior design (commit `d6c7ad3de`) modeled eligibility wrong: it required a
per-item opt-in (`itemReplenishment` flag) plus a per-routing-step marker. That puts the flag on the part, but the part doesn't determine
batchability — the machine does. A laser-cut bracket is batchable at the laser and
not at the brake press. Industry practice agrees: SAP multi-activity resources,
Asprova's furnace resource class, and PlanetTogether's resource-level batching all
put the capability on the resource (see research §1). This spec replaces that
design entirely; the double opt-in, the propagated flags, and the even splits are
gone.

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
2. **Plan** (batch planning board): pick a batchable process at a location; the
   board lists every unstarted, unbatched job operation for that process with the
   material properties of its BOM lines (form, substance, grade, dimension,
   finish) as filterable facets and visible chips. The planner filters — e.g.
   substance Steel, grade A36, dimension 1/4" — and drags operations into an
   existing batch or a "new batch" drop zone. Dragging into a batch that has a
   work center assigns that work center to the member operation (same effect as
   dragging a card between schedule-board columns today). Operations can be
   dragged out again, and batches dissolved, any time before the run starts.
3. **Run** (MES): the batch renders as one card (member count + summed quantity).
   The operator starts one set of Setup/Labor/Machine timers for the whole batch —
   `productionEvent` rows tagged with the batch id.
4. **Complete** (one action): a member table pre-filled with each operation's
   quantity; the operator confirms per-member produced quantity (and optional
   per-member scrap). The system then, in order: closes open batch timers; slices
   each recorded `productionEvent` into per-member events with durations
   **proportional to member operation quantity** (largest-remainder on seconds,
   contiguous sub-windows of the recorded span); inserts per-member
   `productionQuantity` rows; issues material for each member via the existing
   `issue` edge function — so consumption follows **each job's own BOM**, scaled
   by its own produced quantity; sets every member operation `Done` in one
   multi-row update (the existing per-row `sync_finish_job_operation` interceptor
   releases each job's downstream operation independently — no cross-job
   dependency edges); marks the batch `Completed`. GL posting then runs per
   member event via the existing `post-production-event` flow.
5. **Cost**: because the split is materialized as per-member production events,
   every existing surface — job costing, estimates-vs-actuals, WIP/GL — shows each
   job its proportional share with **zero special-casing**. A 20-part job absorbs
   4× the shared run time of a 5-part job.

### Eligibility gate (enforced server-side on create/add)

- The operation's process has `batchable = true`.
- All members share one process (`jobOperation.processId` equal across members —
  it is NOT NULL, so this is a plain equality check; nothing propagates).
- Candidate operation is unstarted: status in `Todo`/`Ready`/`Waiting` and no
  `productionEvent` recorded.
- Candidate not already in a batch (`jobOperationBatchId IS NULL`).
- **No size cap** (min 1 member so a batch always has content; no maximum).
- No item/work-center/material restrictions: material filters are a planning aid,
  not a constraint — the planner owns nesting compatibility (matches SigmaNEST/
  Lantek, where material match is workflow, not schema).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where batchability lives | **`process.batchable` boolean** — job operations derive it via their NOT NULL `processId`; no flags on item, methodOperation, quoteOperation, or jobOperation, and no get-method propagation | The machine determines simultaneity (laser vs brake press). Matches SAP multi-activity resources / Asprova furnace class (research §1). Supersedes the requirement's literal "Manufacturing tab" framing — confirmed by Brad 2026-07-03. Precedent: `process.completeAllOnScan` boolean flag |
| What gets combined | **Operations, not jobs** — `jobOperationBatch` is a plain join over real `jobOperation` rows via a nullable FK | SAP Order Combination / DM process-lot pattern; jobs keep identity, status, cost, downstream chain |
| Entity naming | Table `jobOperationBatch`, FK `jobOperation.jobOperationBatchId`, readable prefix `BAT`, UI noun "batch" | Convention-true FK naming (`{table}Id`). Explicitly documented as distinct from lot-tracking "batch" (`batchNumber`, `requiresBatchTracking`, the `issue` fn's `jobOperationBatchComplete` case = *lot*-tracked completion) |
| Batch size | **No cap** (min 1) | Brad 2026-07-03: no size constraints. No surveyed system caps member count; capacity is physical, and modeling it (PlanetTogether Batch Volume) is a separate future spec |
| Time/cost split | **Proportional to member operation quantity** (weight = `operationQuantity` / Σ; equal weights only as a Σ=0 fallback), materialized at completion by slicing each batch `productionEvent` into per-member events (largest-remainder rounding on seconds) | Brad 2026-07-03: proportional, not even. SAP quantity-distribution / CADTALK weighted-ratio pattern. Materializing per-member events makes GL posting, job costing, and estimates-vs-actuals correct with no downstream changes — the prior design's single-event approach would have posted 100% of WIP to one job while displaying 1/N |
| Weight basis | Planned `operationQuantity`, not produced actuals, not part area | Defined before and during the run; zero-produced members still absorb their share (scrapped parts consumed table time). Area/cut-time weights arrive with nesting import (v2) |
| Produced quantity | **Entered per member** (pre-filled with operation quantity), optional per-member scrap; NOT one total split across members | Each job's parts are distinct — a nest cuts 5 of A and 20 of B; splitting one number across heterogeneous parts is meaningless. One screen, one action still satisfies "aggregated output" (Fulcrum confirm-parts pattern) |
| Material consumption | Per member via the existing `issue` edge fn (`type: "jobOperation"`, member's produced quantity) at batch completion — each job consumes per **its own BOM**; `jobMaterial`/`jobMakeMethod` never rewritten | Nesting write-back pattern (research §5); reuses the exact machinery MES per-op completion uses today; cross-item batches make "split one consumed number" ill-defined |
| Membership lifecycle | `create` (≥1 op), `add`, `remove` while no production event exists; `dissolve` deletes the batch and clears members (blocked after any event — error names the recovery: complete the batch); removing the last member dissolves | Drag-and-drop planning implies incremental add/remove; all pre-start operations are pure FK writes with nothing to unwind |
| Work center | Batch carries nullable `workCenterId`; assigning it (at create or later) writes it to all member operations; adding an op to a batch with a work center sets the op's `workCenterId` | Physically true — batching puts the job on that machine. Same write the schedule board's drag already performs. Members need NOT pre-match |
| Completion mechanism | One transaction: slice events → insert quantities → multi-row `Done` → batch `Completed`; caller then issues material + posts GL per event | `trg_event_sync_jobOperation` is BEFORE/FOR EACH ROW (re-verified 2026-07-03), so each member's downstream op releases independently; no cross-job dependency edges anywhere |
| Planning integration | Manual board only in v1; no MRP/scheduler auto-suggestions | APS auto-grouping is solver territory (v2); manual composer matches the MES precedent (Critical Manufacturing) |
| Multi-tenancy (heuristic 1) | `jobOperationBatch` composite PK `("id","companyId")`, `id` TEXT default `id()`, `companyId` on every query | Carbon convention |
| Service shape (heuristic 2) | `(client, ...) → {data, error}` wrappers in `production.service.ts`; multi-row mutations via a `batch-operations` edge function (Kysely transaction) | `.ai/rules/conventions-services.md`; one service/models file per module |
| RLS (heuristic 3) | Policies named `SELECT`/`INSERT`/`UPDATE`/`DELETE`: view = employee role, mutations = `production_create/update/delete`, `::text[]` casts per current idiom | Matches `job`/`jobOperation`; copy the newest migration's idiom |
| Permission scoping (heuristic 4) | Routes + edge fn: `view: "production"` for reads, `update: "production"` for batch mutations | Batching mutates job operations — production scope |
| Form pattern (heuristic 5) | Process form: `Boolean` field in existing `ValidatedForm`; batch completion: `ValidatedForm` + zod validator in MES | House pattern; clone `completeAllOnScan` |
| Module layout (heuristic 6) | Validators in `production.models.ts`, services in `production.service.ts`; process flag in `resources.models.ts`/`resources.service.ts`; no new files beyond UI components/routes | One service/models per module |
| Backward compatibility (heuristic 7) | All columns additive/nullable (or defaulted); inert until a process is flagged batchable; `get_active_job_operations_by_location` re-declared additively (both boards read it); `processes` view recreated from newest definition | No FROZEN surface touched; unflagged behavior byte-for-byte unchanged |

## Data Model Changes

```sql
-- 1. The capability flag (master data)
ALTER TABLE "process" ADD COLUMN "batchable" BOOLEAN NOT NULL DEFAULT false;
-- Recreate the "processes" view from its NEWEST definition including the column.

-- 2. The operation batch
CREATE TYPE "jobOperationBatchStatus" AS ENUM ('Active', 'Completed', 'Cancelled');

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
  the MES kanban; newest definition `20260531084723_rework-serial-flow.sql`):
  re-declare from the newest definition adding `processBatchable`,
  `jobOperationBatchId`, `batchReadableId` (LEFT JOIN `jobOperationBatch`).
- **New RPC `get_batchable_operations`** `(location_id, process_id)` for the
  planning board: unstarted, unbatched operations of that (batchable) process at
  the location, joined to job/item, plus a `materials` JSONB array per operation —
  each element `{itemReadableId, description, quantity, formName, substanceName,
  gradeName, dimensionName, finishName, formId, substanceId, gradeId, dimensionId,
  finishId}` — built from `jobMaterial.jobOperationId → item → material`
  (`material.id = item.readableId`) → the five property lookups. Operations whose
  BOM lines lack material rows return an empty array and group under "No material
  properties" in the UI. Also returns current members of Active batches for the
  process (to render batch lanes).
- After migration: `pnpm run generate:types` before typecheck.

## API / Service Changes

### New edge function: `batch-operations` (`packages/database/supabase/functions/batch-operations/`)

Follows `.ai/rules/workflow-edge-function.md`: CORS preflight, zod discriminated
union, `requirePermissions(req, companyId, userId, { update: "production" })`,
module-scope Kysely pool, one transaction per request. Payload types:

- `{ type: "create", jobOperationIds: string[] (min 1), workCenterId?, locationId, companyId, userId }`
  — validates the eligibility gate (batchable process via join, single process,
  unstarted, unbatched); derives `processId` from the members; `getNextSequence`
  → `BAT...`; inserts the batch; tags members; writes `workCenterId` to members
  when provided. Returns `{ id, readableId }`.
- `{ type: "add", batchId, jobOperationIds, companyId, userId }` — same gate per
  candidate + batch must be `Active` with no production events; tags members;
  propagates the batch's work center if set.
- `{ type: "remove", batchId, jobOperationIds, companyId, userId }` — blocked once
  any batch production event exists; clears the FK; removing the last member
  deletes the batch.
- `{ type: "update", batchId, workCenterId, companyId, userId }` — assigns (or
  clears) the batch's work center; when set, writes it to every member
  operation's `workCenterId`.
- `{ type: "dissolve", batchId, companyId, userId }` — blocked once any batch
  production event exists (error: "production has been recorded — complete the
  batch instead"); clears all members; deletes the batch.
- `{ type: "complete", batchId, members: [{ jobOperationId, quantity, scrapQuantity? }], companyId, userId }`
  — in one transaction: close open batch-tagged `productionEvent`s (`endTime = NOW()`);
  slice every batch-tagged event into contiguous per-member events with durations
  ∝ member `operationQuantity` (update the original row to the first slice, insert
  the rest; slices keep `jobOperationBatchId`, `postedToGL = false`); insert
  `productionQuantity` rows per member (`Production` + optional `Scrap`);
  multi-row `UPDATE ... SET status = 'Done'` on members (per-row interceptor
  releases each job's next operation); set batch `Completed`. Returns
  `{ memberIds, eventIds }` for the caller's follow-ups.

### `production.service.ts` additions (`apps/erp/app/modules/production/`)

```typescript
getJobOperationBatch(client, batchId, companyId)          // batch + member ops + jobs
getBatchableOperations(client, { locationId, processId, companyId })  // rpc wrapper
getActiveBatchesByProcess(client, { processId, locationId, companyId })
createJobOperationBatch(client, payload)   // invoke("batch-operations", { type: "create" })
addToJobOperationBatch(client, payload)    // type: "add"
removeFromJobOperationBatch(client, payload) // type: "remove"
dissolveJobOperationBatch(client, payload)   // type: "dissolve"
```

`production.models.ts`: `jobOperationBatchStatus` const,
`createJobOperationBatchValidator`, `updateJobOperationBatchValidator` (add/
remove/dissolve intents), `completeJobOperationBatchValidator` (member rows with
int quantities ≥ 0). **No max-size validation anywhere.**

MES (`apps/mes/app/services/`): `getJobOperationBatch`, batch completion
validator in `models.ts`; the complete action invokes `batch-operations` then,
per member, the existing `issue` (`type: "jobOperation"`) and, per returned
event, `post-production-event` — mirroring `finishJobOperation`'s GL pattern.

### `resources` module

`processValidator` gains `batchable: zfd.checkbox()`; `upsertProcess` passes it
through; `ProcessForm` gains the Boolean field (clone `completeAllOnScan`).

## UI Changes

| Surface | Change |
|---------|--------|
| Process form (`resources/ui/Processes/ProcessForm.tsx`) | "Batchable" checkbox — "Multiple jobs can run on this process at the same time (laser table, furnace, plating bath)" |
| Processes table | `Batchable` boolean column/badge |
| **Batch planning board** (new: `x/schedule/batching`) | Location + batchable-process pickers; left pane = filterable candidate operations (cards: job, item, quantity, due date, material chips), faceted URL-param filters on form/substance/grade/dimension/finish + search (clone the operations board's `Filter`/`ActiveFilters`/`useFilters` pattern; pickers reuse the existing material-lookup comboboxes); right pane = Active batch lanes (readableId, work center, members, summed qty) + "New batch" drop zone; `@dnd-kit` drag in/out; work-center assignment on the lane; dissolve action. Persists via fetcher to an action route calling the service wrappers |
| Schedule board (`ui/Schedule/Kanban/ItemCard.tsx`) | Batched ops render a `BAT000001` badge; card menu gains "Batch planning" (nav, process pre-filtered) for batchable unbatched ops and "Remove from batch" (guarded) for batched ones |
| MES kanban (`apps/mes/.../ItemCard.tsx` + operations loader) | Rows sharing `jobOperationBatchId` collapse to one card: member count, summed quantity, batch readableId; card links to the batch view |
| MES batch view (new: `x/batch/$batchId`) | Member table (job, item, quantity, due date, link to each member op for per-op flows), Start/Stop timers (events tagged with the batch), **Complete Batch** form: per-member produced quantity (pre-filled) + optional scrap, copy stating time splits proportionally to quantity |
| Job detail | Member operation shows the batch badge; estimates-vs-actuals needs **no math change** (per-member events) — optional "part of BAT…" badge only |

## Acceptance Criteria

- [ ] Toggling `batchable` on a process makes its unstarted job operations appear on the batch planning board; unflagged processes are absent from the process picker and their operations never offer batch actions.
- [ ] Filtering candidates by substance=Steel + grade=A36 + dimension=1/4" shows exactly the operations whose BOM lines resolve to those material properties; an operation consuming aluminum disappears; operations with no material-bearing BOM lines group under "No material properties".
- [ ] Dragging 3 operations (different jobs, different items) into "New batch" creates a `jobOperationBatch` with a `BAT`-sequence readableId, tags all 3, and both boards render one card; dragging one out again untags it; a 30-member batch is accepted (no cap).
- [ ] Assigning the batch a work center writes that `workCenterId` to every member operation; adding an op to a work-centered batch sets the op's work center.
- [ ] Server rejects (with a specific error per rule): mixing processes, a non-batchable process, a started operation, an already-batched operation, and add/remove/dissolve after any batch production event (dissolve error names the recovery: complete the batch).
- [ ] Starting the batch in MES creates `productionEvent` rows tagged with `jobOperationBatchId`; the batch card shows the running timer.
- [ ] Completing a batch (members qty 5/20/10, one 70-minute machine event) yields per-member events of 10/40/20 minutes (largest-remainder on seconds, contiguous windows), per-member `productionQuantity` rows matching the entered quantities (+ scrap rows where entered), one `issue` call per member consuming that job's own BOM (no `jobMaterial` row rewritten), all members `Done` in one action, each member job's next operation independently flipping to `Ready`, batch `Completed`, and `post-production-event` posting GL per member event.
- [ ] Job costing / estimates-vs-actuals for each member job shows its proportional share with no special-case code path (verified by reading each member op's own events).
- [ ] Jobs/operations never batched behave byte-for-byte as before; `pnpm exec turbo run typecheck --filter=erp --filter=mes`, lint, and tests pass.
- [ ] The superseded feature's terminology (case-insensitive grep pattern `st[i]tch`) appears nowhere in the shipped code, migrations, or docs for this feature.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Quantity weights distort cost when parts differ wildly in size (20 washers vs 5 large panels on one sheet) | Med | Documented limitation; weights live in one function in the edge fn — area/cut-time weights via nesting import is the designed v2 upgrade path |
| Sliced event windows are temporal approximations (contiguous sub-spans, not the "real" simultaneous run) | Low | Durations sum exactly to the recorded span; slices keep `jobOperationBatchId` so provenance is queryable; documented in AGENTS.md |
| `get_active_job_operations_by_location` re-declaration regresses a board (two apps consume it) | Med | Fork the newest definition verbatim, additive columns only; smoke both boards |
| Ops whose `jobMaterial` rows lack `jobOperationId` show no material chips | Low | Column exists since `20260120132502` (with backfill); "No material properties" bucket keeps them visible/batchable |
| Planner batches metrically incompatible materials (filters are advisory) | Low | Deliberate (research: material match is workflow, not schema); chips make membership visible; hard constraints would fight real shop exceptions |
| Terminology confusion with lot/batch tracking | Low | Naming decision documented; UI copy says "operation batch"; AGENTS.md and glossary spell out the distinction |

## Open Questions

> HARD STOP satisfied 2026-07-03: Brad pre-delegated resolution (combined
> spec+plan request); each answer below is a documented recommendation applied to
> this spec — veto any of them and the spec+plan will be revised.

- [x] **Weight basis for the proportional split?** — **Answer: planned
  `operationQuantity`** (share = member qty / Σ). Defined before/during the run;
  zero-produced members still absorb time (their parts occupied the machine).
  Produced-actuals weighting rejected (undefined mid-run, zero-yield edge); part
  area/cut-time rejected for v1 (needs nesting import — v2).
- [x] **Must members share a work center?** — **Answer: no — the batch owns the
  work center.** Adding an op to a batch (or assigning the batch a work center)
  writes the member's `workCenterId`, exactly like a schedule-board drag. Requiring
  pre-matching would block the planner for no physical reason.
- [x] **Which material facets filter the board?** — **Answer: form, substance,
  grade, dimension, finish** (+ text search) — the normalized `material` FKs that
  exist today, with existing combobox components; matches the industry keys
  (material + thickness + machine). An op matches if ANY of its BOM lines match
  all active facets. `materialType` omitted from facets in v1 (derivable from
  form+substance; add later if asked).
- [x] **Minimum batch size?** — **Answer: 1** (a batch must contain at least one
  operation; removing the last member dissolves it). No maximum, per Brad. A
  1-member batch is transitional drag-and-drop state, not an error.
- [x] **Scrap at batch completion?** — **Answer: optional per-member scrap input**
  on the completion form (posts `Scrap`-type `productionQuantity` per member).
  Even-split scrap (prior design) is wrong under per-member quantities; NCR/quality
  workflows unchanged (member ops are real rows).
- [x] **Where do timers live while the batch runs?** — **Answer: `productionEvent`
  rows on the first member operation, tagged `jobOperationBatchId`, sliced into
  per-member events at completion.** Events require a `jobOperationId`; the tag
  makes the batch timer queryable, and slicing materializes the proportional
  split so GL/costing need no batch awareness. (The alternative — batch-aware
  query-time division everywhere — was the prior design's latent GL bug.)
- [x] **Auto-suggest batches during planning/MRP?** — **Answer: manual board only
  in v1**; solver-style grouping (Opcenter operation aggregation) is v2.
- [x] **Capacity semantics (how much fits on the table/in the furnace)?** —
  **Answer: out of scope** — separate future spec (PlanetTogether Batch Volume
  pattern); v1 batches are unbounded by design.

## Changelog

- 2026-07-03: Created, superseding the prior spec (commit `d6c7ad3de`) after
  Brad's redesign direction: (1) terminology is batch/batchable throughout — the
  old feature name is eliminated; (2) batchability is a **process** property (laser
  batchable, brake press not) — the per-item Manufacturing-tab flag and per-
  routing-step marker are deleted, along with all get-method propagation; (3) a
  material-property-filtered drag-and-drop batch planning board is core scope
  ("all job operations on the laser table using 1/4-inch A36 steel").
- 2026-07-03: Brad: no batch size constraint (old ≤10 cap removed) and cost split
  proportional to job quantity (old even split removed). Consequence adopted:
  proportional split materialized as per-member `productionEvent` slices at
  completion, fixing the prior design's GL misattribution; produced quantity and
  material consumption become per-member (own-BOM) rather than even splits.
- 2026-07-03: Research refreshed at `.ai/research/job-operation-batching.md`
  (SAP order combination/process lots, APS batchable resources, sheet-metal
  nesting workflow); all open questions resolved with recommendations pending
  Brad's veto; status → in-progress, ready for `/plan`.
