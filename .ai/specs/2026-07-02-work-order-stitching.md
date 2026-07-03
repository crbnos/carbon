# Work Order Stitching

> Status: in-progress
> Author: Claude (with Sid)
> Date: 2026-07-02
> Research: `.ai/scratch/research/work-order-stitching.md`
> Requirement: REQ-FUN-PRODUCTION-005 (Must, Daily)
> Tracking issue: https://github.com/crbnos/carbon/issues/1010

## TLDR

Add "Work Order Stitching" to the production module: when several jobs need
the same operation (same process, same work center — e.g. a furnace cycle or
bath treatment), a planner can group those specific **job operations** into
one virtual operation. The virtual operation completes all of its member
operations together, and its time/cost splits evenly across them. Material
consumption and produced quantity are logged once for the group and split
evenly to each member job at posting time — the underlying bill of materials
is never touched. **Jobs themselves are never merged or combined** — each
member job keeps its own identity, status, cost, and downstream operations;
only the one shared operation is shared. A per-item flag on the Manufacturing
tab plus a per-operation "stitchable" marker on the routing step gate which
operations are eligible to group.

## Problem Statement

Shops doing surface/heat treatment run the same preparation step (mix a bath,
heat a furnace, prepare a coating) once per job even when several jobs need
the identical step at the same time. Example from the requirement: two
treatments on two layers, same raw materials, same semi-finished output —
today Carbon forces 2 prep tasks, 2 material consumptions, 2 outputs, even
though the furnace only ran once. Wanted: 1 shared prep task, 1 aggregated
consumption, 1 aggregated output, while the 2 treatment/application steps
that follow stay separate and traceable to their own jobs.

Carbon has no concept of one operation belonging to more than one job today:
`jobOperation.jobId` is a required, cascading foreign key, and every
schedule/MES/costing query assumes an operation belongs to exactly one job.

## Proposed Solution

**A grouped operation is the unit being combined — not the job.** N jobs stay
N separate jobs throughout. What changes is that one specific operation on
each of those jobs (the shared prep step) gets pulled into a
`jobOperationGroup`: a lightweight join over N real `jobOperation` rows, one
per member job. There's no "lead job" and no deactivated duplicates — every
member operation stays a first-class row on its own job.

```
jobOperationGroup (readable: WOS000001)
   process: Heat Treat · work center: Furnace 2
   │
   ├── Job A · jobOperation "Heat Treat" ──┐
   ├── Job B · jobOperation "Heat Treat" ──┤  members — same process + work
   └── Job C · jobOperation "Heat Treat" ──┘  center, grouped, not merged

Job A's next op (Coat)  ─┐  each job's OWN downstream operations and
Job B's next op (Coat)  ─┤  dependency chain are untouched — they still
Job C's next op (Coat)  ─┘  release on their own job's schedule, same as today
```

Key behaviors:

1. **Group** (planner action): select N job operations that share a process +
   work center, none started, none already grouped → creates the
   `jobOperationGroup`, tags each member op with `operationGroupId`. Nothing
   else about the member jobs changes.
2. **Run** (MES): the group shows as one card. The operator starts one
   Setup/Labor/Machine timer (one `productionEvent`) and, at completion, logs
   **one** produced-quantity number and **one** consumed-material number for
   the whole group. The system splits both **evenly** across the N member
   operations (largest-remainder rounding for whole units) and posts one
   `productionQuantity` row + one `issue` call per member operation. The
   underlying `jobMaterial`/`jobMakeMethod` (the BOM) is never read or
   rewritten — this is purely a runtime posting split, not a planning change.
3. **Complete**: one action transitions all N member operations to `Done` in
   a single transaction. Each operation already has its own same-job
   `jobOperationDependency` chain to its own next step — Postgres fires the
   existing `finish_job_operation` row trigger once per updated row, so each
   job's downstream operation releases on its own, independently, exactly as
   it does for an ungrouped job today. **No cross-job dependency edge is
   needed anywhere in this design.**
4. **Cost**: the shared `productionEvent`'s time × rate divides evenly by the
   member count at reporting time (query-time computation, not a stored
   split) — a 2-unit job and a 20-unit job through the same furnace absorb
   equal setup cost. This is a deliberate trade-off, not an oversight (see
   Design Decisions).
5. **Ungroup** (before the shared operation starts): clear `operationGroupId`
   on all members, delete the group row. No state to restore beyond that —
   there was never anything deactivated or rewritten.

### Eligibility gate (group validator)

- Item opted in: `itemReplenishment.workOrderStitching = true` for every
  member job's item.
- Operation marked shareable: `jobOperation.stitchable = true` (propagated
  from `methodOperation.stitchable` via `get-method`).
- Same process, same work center across all candidate operations.
- Not started: candidate op status `Todo`/`Ready`/`Waiting`, no
  `productionEvent` recorded yet.
- Not already grouped: `jobOperation.operationGroupId IS NULL`.
- Group size ≤ 10 members (constant in the `stitch` edge function).

Member jobs do **not** need to share an item (decided — see Open Questions):
because this design never touches the BOM, two different items whose routing
hits the same furnace step can share a group. The double opt-in (item flag +
operation flag) means every member's item owner deliberately enabled this.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| What gets combined | **Operations, not jobs.** Jobs stay fully separate the whole time | Matches the actual ask: "application tasks stay separate, linked to the main order." Merging jobs (Odoo-style) was rejected earlier for destroying job identity — this avoids that question entirely, since jobs are never touched |
| Group entity | `jobOperationGroup`, a plain join over real `jobOperation` rows via `operationGroupId` — no lead/follower asymmetry, no deactivated duplicates | Simpler than an execution-overlay-with-deactivation model; every member op stays a normal, queryable row. Removes an entire class of "is this op real or a shadow" bugs |
| Completion mechanism | One transaction sets all member ops to `Done`; rely on Postgres firing `finish_job_operation` once per affected row | Row-level AFTER UPDATE triggers fire per row regardless of single- vs multi-row UPDATE — standard Postgres behavior, not new plumbing. Each job's own dependency chain releases independently, unmodified |
| Cross-job dependency edges | **Not used.** Rejected entirely | The earlier design needed them to gate each member's next op on the shared op; multi-row completion makes them unnecessary. This was the single highest risk in the prior design — removing it removes the risk |
| Material/output aggregation | Split evenly across members **at posting time only**; `jobMaterial`/`jobMakeMethod` never read or written | Confirmed with Sid: "without modifying the underlying BoM." `productionQuantity` has no `jobId` — it's attributed via `jobOperationId` → parent job — so posting one row per member operation gives correct per-job ledger/costing for free, no schema change to `issue` |
| Cost split | **Even**, not proportional to job quantity | Confirmed with Sid: "splits the time/cost evenly." Simpler than proportional-by-quantity; the trade-off (small orders subsidize large orders' setup) is explicit, not hidden |
| Setup event sharing | One `productionEvent`; member `productionQuantity` rows reference it via existing `setupProductionEventId` (nullable, no unique constraint — already legal) | Zero schema change for attribution |
| Eligibility scope | Same process + work center + stitchable flag; **not** same item | Decided (Open Questions): BOM is never touched, so same-item is not structurally required; double opt-in prevents accidental cross-item groups; matches physical furnace reality |
| Scrap on a grouped op | Even split, same posting path as production quantity; NCR workflow unchanged | Decided (Open Questions): scrap is just a `productionQuantity` type; load-level failure (the common case per MRB/Nadcap practice) splits evenly by construction; per-member NCR remains possible since member ops are real rows |
| Flags | Item-level `itemReplenishment.workOrderStitching` (UX opt-in, matches requirement's "Manufacturing tab" framing) + operation-level `methodOperation.stitchable` (identifies which routing step is shareable, auto-propagates to `jobOperation` via `get-method`) | Two flags because they answer different questions: "does this item's routing ever get combined" vs. "which specific step" |
| Multi-tenancy | `jobOperationGroup` composite PK `("id","companyId")` | Carbon convention |
| RLS model | Permission-based: `production_view/create/update/delete` | Matches `job`/`jobOperation` policies |
| Service shape | `(client, ...)` → `{ data, error }`; multi-row mutation via a `stitch` edge function (Kysely transaction) | `.ai/rules/conventions-services.md` |
| Backward compatibility | All columns additive/nullable; inert until both flags are set | No FROZEN surface touched |

## Data Model Changes

```sql
-- 1. Master-data flags
ALTER TABLE "itemReplenishment"
  ADD COLUMN "workOrderStitching" BOOLEAN NOT NULL DEFAULT false;  -- Manufacturing tab gate

ALTER TABLE "methodOperation" ADD COLUMN "stitchable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jobOperation"    ADD COLUMN "stitchable" BOOLEAN NOT NULL DEFAULT false; -- copied via get-method

-- 2. Operation group ("virtual operation")
CREATE TYPE "jobOperationGroupStatus" AS ENUM ('Active', 'Completed', 'Cancelled');

CREATE TABLE "jobOperationGroup" (
    "id" TEXT NOT NULL DEFAULT id('wos'),
    "readableId" TEXT NOT NULL,                 -- e.g. WOS000001 (getNextSequence)
    "companyId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,                  -- shared process; every member matches this
    "workCenterId" TEXT,                        -- shared work center; every member matches this
    "status" "jobOperationGroupStatus" NOT NULL DEFAULT 'Active',
    "customFields" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "jobOperationGroup_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "jobOperationGroup_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobOperationGroup_processId_fkey" FOREIGN KEY ("processId", "companyId")
      REFERENCES "process"("id", "companyId"),
    CONSTRAINT "jobOperationGroup_readableId_unique" UNIQUE ("readableId", "companyId")
);
ALTER TABLE "jobOperationGroup" ENABLE ROW LEVEL SECURITY;
-- SELECT: employee role; INSERT/UPDATE/DELETE: production_create/update/delete
-- (same shape as job policies in 20240915192542)

-- 3. Membership — one column on jobOperation, no join table needed
ALTER TABLE "jobOperation" ADD COLUMN "operationGroupId" TEXT; -- FK → jobOperationGroup(id), nullable
CREATE INDEX "jobOperation_operationGroupId_idx" ON "jobOperation" ("operationGroupId")
  WHERE "operationGroupId" IS NOT NULL;
```

Note what's **absent** compared to the earlier design: no `job.stitchGroupId`
(membership is derived by joining through `jobOperation`, not denormalized
onto `job`), no `stitchRole` enum, no cross-job rows in
`jobOperationDependency`. Smaller surface area.

Also required (behavioral, not schema):

- Views/RPCs that render the schedule board / MES operation lists must
  collapse operations sharing an `operationGroupId` into one card.
- After migration: `pnpm run generate:types` before typecheck.

## API / Service Changes

### New edge function: `stitch` (`packages/database/supabase/functions/stitch/`)

Follows `.ai/rules/workflow-edge-function.md`. Discriminated union payload:

- `{ type: "group", jobOperationIds: string[], companyId, userId }` —
  validates the eligibility gate server-side (including the ≤10-member cap),
  creates the group, sets `operationGroupId` on each op, returns
  `{ id, readableId }`.
- `{ type: "ungroup", operationGroupId, companyId, userId }` — guard: no
  `productionEvent` on any member op (all-or-nothing; error names the
  recovery route: complete the group); clears `operationGroupId` on all
  members, deletes the group row.
- `{ type: "complete", operationGroupId, producedQuantity, consumedMaterial[], companyId, userId }`
  — splits `producedQuantity` and each material line evenly across member
  operations (largest-remainder rounding), inserts one `productionQuantity`
  row and issues one `issue` call per member operation (all referencing the
  one `productionEvent`), then sets every member operation's status to
  `Done` in the same transaction. Scrap logged against the group takes the
  same even split.

### `production.service.ts` additions

```typescript
getJobOperationGroup(client, id, companyId)         // group + member operations + jobs
getStitchableOperations(client, processId, companyId)
  // open, ungrouped, flag-on operations matching a process (drives the picker)
groupJobOperations(client, payload)                 // invoke("stitch", { body: { type: "group", ... } })
ungroupJobOperations(client, payload)                // invoke("stitch", { body: { type: "ungroup", ... } })
completeOperationGroup(client, payload)              // invoke("stitch", { body: { type: "complete", ... } })
```

`production.models.ts`: `groupJobOperationsValidator`, `ungroupValidator`,
`completeOperationGroupValidator`, `jobOperationGroupStatus` const.

### `items` module

`itemManufacturingValidator` gains `workOrderStitching: zfd.checkbox()`
(items.models.ts:514); `upsertItemManufacturing` passes it through.

### `methodOperation` / `BillOfProcess.tsx`

`methodOperationValidator` gains `stitchable: zfd.checkbox()`; one `Boolean`
field added to the operation form. Selecting the column in `get-method`'s
copy query is the only change needed for it to propagate to `jobOperation` —
no explicit copy logic.

## UI Changes

| Surface | Change |
|---------|--------|
| Item → Manufacturing tab (`ItemManufacturingForm.tsx`) | "Work Order Stitching" checkbox, mirrors `requiresConfiguration` pattern |
| Method operation form (`BillOfProcess.tsx`) | "Stitchable" checkbox on the routing step |
| Jobs list / schedule board | Operations eligible to group (same process/work center, flags on, unstarted) surface a **Group** action; confirming opens a picker across matching open jobs (grouped by process + work center, cross-item allowed) |
| Schedule board / MES operation list | Grouped operations render as **one card** with a member-job list, not N cards |
| MES operation view for a group | Single "produced quantity" + "material consumed" input, with copy explaining it splits evenly across N jobs; a **Complete group** action replaces per-operation Finish |
| Job detail | Badge on the shared operation showing group membership + a link to ungroup (guarded) |

## Acceptance Criteria

- [ ] Setting both flags (item + operation) makes an operation eligible to appear in the group picker; missing either flag hides it.
- [ ] Grouping 3 unstarted operations (same process + work center, different jobs — including jobs for different items) creates a `jobOperationGroup`, tags all 3 ops with the same `operationGroupId`, and the schedule board/MES show one card for all three.
- [ ] Grouping operations that differ in process or work center, are already started, already grouped, or would exceed 10 members is rejected server-side with a specific error per rule.
- [ ] Logging 10 produced units + 9kg material on a 3-member group splits as 4/3/3 units (largest remainder) and 3/3/3 kg, one `productionQuantity` row and one `issue` call per member operation, all referencing the same `productionEvent`; `jobMaterial` rows are unchanged before and after.
- [ ] Scrap logged on the group splits evenly across member operations via the same path; each member job's `quantityScrapped` reflects its share.
- [ ] "Complete group" transitions all 3 member operations to `Done` in one action; each member job's own next operation flips from `Waiting`/blocked to `Ready` independently (no cross-job coupling required for this to work).
- [ ] Estimates-vs-actuals / job costing for each member job shows 1/3 of the shared operation's time and cost, not the full amount.
- [ ] Ungrouping before any production event clears `operationGroupId` on all members and deletes the group; ungrouping after a production event is blocked with an error naming the recovery route (complete the group).
- [ ] Jobs/operations that were never grouped behave byte-for-byte as before; `pnpm run typecheck` and `pnpm run test` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Even (not proportional) cost split silently misleads a planner comparing job margins | Med | Costing/estimates UI explicitly labels grouped-operation cost as "1/N of shared operation," not folded silently into the job's own numbers |
| Cross-item grouping surprises someone expecting same-item scope (widening from the literal requirement text) | Med | Decided deliberately (see Open Questions) and documented; double opt-in flags prevent accidental use; picker UI makes the mixed-item membership visible before confirming |
| Rounding on indivisible units (e.g. 10 units / 3 jobs) | Low | Largest-remainder allocation; acceptance test with non-divisible splits |
| Multi-row `Done` transition doesn't fire per-row triggers as expected in some edge case (e.g. a trigger written assuming single-row UPDATE) | Low | Verify `finish_job_operation` against a real multi-row UPDATE in a migration test before relying on it |
| Group completion partially fails mid-transaction (some member posts succeed, others don't) | Low | Whole `complete` action runs in one Kysely transaction — standard rollback semantics, no partial state possible |

## Open Questions

> All resolved 2026-07-02. Gate cleared — spec is ready for `/plan` / `/feature`.

- [x] **Which operations are "the prep"?** — **Answer:** explicit
  `methodOperation.stitchable` flag, propagates to `jobOperation` via
  `get-method`. Confirmed in conversation — load-bearing for the eligibility
  gate itself, not just a UI hint.
- [x] **Output/material allocation rule.** — **Answer:** even split across
  member operations, computed and posted at execution time; `jobMaterial`/
  `jobMakeMethod` never touched. Confirmed with Sid directly.
- [x] **Scrap ownership on a grouped operation.** — **Answer: even split,
  identical mechanism to production quantity; NCR workflow unchanged.** Scrap
  is just a `productionQuantity` type, so the even split reuses the exact
  same posting path with zero extra machinery. Domain practice supports the
  default: a bad furnace cycle condemns the whole load (MRB/Nadcap treat the
  lot as one), so process failure — the common case — splits evenly by
  construction. For the rarer part-specific defect, member ops are all real
  rows, so quality can raise an NCR against the specific member operation
  exactly as today; no NCR schema or workflow change in v1.
- [x] **Same-item restriction.** — **Answer: ship the wider rule — same
  process + same work center, any items.** The double opt-in (item-level
  `workOrderStitching` AND operation-level `stitchable`) means every member's
  item owner deliberately enabled grouping; accidental cross-item groups
  can't happen. Wider matches physical reality (a furnace doesn't care whose
  parts are loaded) and the requirement's intent (eliminate redundant prep),
  even though its example assumed same-item.
- [x] **Ungroup boundary.** — **Answer: all-or-nothing; blocked after any
  production event on any member op.** Error names the recovery route:
  complete the group, after which member jobs proceed independently. Partial
  member removal is v2 if ever requested.
- [x] **Planning integration scope.** — **Answer: manual only in v1** —
  grouping happens from the jobs list / schedule board. Purchasing's silent
  supplier+period auto-grouping is a UX precedent to avoid; an explicit
  suggestion in `ProductionPlanningOrderDrawer` is the natural v2 follow-up.
- [x] **Group size ceiling.** — **Answer: hard cap of 10 members, a constant
  in the `stitch` edge function validator.** Purely a blast-radius bound — no
  capacity semantics implied. Not a company setting: no demand for tunability
  yet; promoting a constant to config later is a one-line change. Real
  furnace/bath capacity modeling is a separate future spec.

## Changelog

- 2026-07-02: Created. Research grounded in 9 codebase-exploration passes + adversarially verified ERP prior art (SAP Combined Production Orders, Odoo merge/split, Dynamics 365 TCA); notes at `.ai/scratch/research/work-order-stitching.md`.
- 2026-07-02: Open questions upgraded from proposals to researched recommended paths (3 further codebase passes: scrap/quality attribution, planning UI + methodOperation config, standard-factor batch semantics; plus manufacturing-practice research on load-level nonconformance and batch-machine scheduling).
- 2026-07-02: Redesigned from an execution-overlay-on-jobs model to an **operation-group model** after clarifying with Sid that jobs are never combined — only specific job operations are. Dropped: lead job / deactivated shadow operations, cross-job `jobOperationDependency` edges, proportional-by-quantity cost/output split. Adopted: a plain `jobOperationGroup` join over real operations, multi-row completion relying on existing per-row triggers, and an even split of time/cost/material/output posted at execution time without ever touching the BOM.
- 2026-07-02: All remaining open questions resolved (scrap = even split with unchanged NCR workflow; eligibility = cross-item allowed, same process + work center; ungroup = all-or-nothing before first production event; planning = manual-only v1; group cap = constant 10). Status → in-progress; spec ready for `/plan` or `/feature`.
