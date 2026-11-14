# MRP v2: Planned-Order MRP — Generation, Cascade, Capacity & Simulation

> Status: **Phase 1 implemented** (PR #1601). **Phase 2a** fully specified, not started.
> Phases 2b and 2c designed, not started.
> Author: Brad Barbin (with Claude)
> Date: 2026-08-22 (phased 2026-09-08; Phase 2 split into 2a/2b/2c 2026-11-14)
>
> The spec has 2 parts:
>
> - **§P1 — Phase 1: Planning Action Messages & Buyer/Planner Assignment (shipped).**
>   MRP emits assignable, dismissible planning actions (`Order`, `Make`, `Expedite`,
>   `Defer`, `Cancel`, `Increase`, `Decrease`) in the `planningAction` table, routed to
>   a responsible buyer or planner. It runs on the per-item netting.
> - **Phase 2 — Planned-order MRP.** A `plannedOrder` layer, the buffer-policy
>   cascade, lot-sized explosion, Firm, the time fence, Convert and pegging (2a). Then
>   live replanning, rough-cut capacity and capable-to-promise (2b). Then workflow
>   automation, notifications, agent tools and suggested projections (2c).

# §P1 — Phase 1: Planning Action Messages & Buyer/Planner Assignment (shipped)

> **This is Phase 1 — shipped in PR #1601.** Resolved with Brad on 2026-09-08 (run
> record: `.ai/runs/2026-09-08-mrp-planning-actions.md`; research:
> `.ai/research/mrp-planning-actions.md` — SAP, Dynamics 365 SCM + Business Central,
> NetSuite, Epicor, Infor SyteLine/LN). Phase 2 follows §P1, from
> "# Phase 2 — Planned-order MRP".

## P1.0 TLDR

Today MRP emits exactly one suggestion — **Order** — computed live in SQL
(`calculate_quantity_to_order`) and thrown away on every page load. Phase 1 makes MRP
emit the **full set of planning actions every ERP has** — `Order`, `Make`, `Expedite`,
`Defer`, `Cancel`, `Increase`, `Decrease` — **persists** them in a focused
`planningAction` table, and **routes each to a responsible buyer/planner** resolved
through an inheritance ladder (item → item group → location → company). A buyer opens
the planning page filtered to *"my actions"* and works a queue: one-click apply on
uncommitted supply, review-on-document for anything already sent to a supplier.

Phase 1 deliberately builds on the **current** per-item netting. It does **not** include
the multi-level planned-order cascade, the Planned→Firm→Released lifecycle, rough-cut
capacity, or what-if/CTP — those are Phase 2 (after §P1). This is the
80/20: the whole user-visible outcome (a full, assignable action worklist) at a fraction
of the full-vision build.

## P1.1 Scope — what Phase 1 does and does not do

**Does:**

- Emit and **persist** the seven `planningActionType` values as assignable, dismissible
  rows, refreshed each MRP run (diff-write).
- Compute **change actions** (Expedite/Defer/Cancel/Increase/Decrease) by comparing
  **real open POs/jobs** against net requirements — the SAP "reschedule/cancel on a
  firmed receipt" model.
- Resolve a **`responsibleEmployee`** per action via the inheritance ladder, stamp it as
  the row's assignee, and let a lead reassign per row (bulk-capable).
- Let a buyer **act** on a message: apply directly on uncommitted supply, navigate to the
  document on committed supply.
- Gate reschedule noise with a single company tolerance.

**Does NOT (deferred to Phase 2):**

- The multi-level **planned-order cascade** (a parent's reorder need generating child
  demand before a job exists — the original MRP-v2 problem statement). Phase 1 Order/Make
  actions come from the **current** per-item reorder + demand netting, unchanged.
- The **Planned → Firm → Released** lifecycle, pegging tables, `planningRun`/
  `planningState`, continuous event-driven regen, rough-cut capacity, what-if/CTP,
  programmable release, and the §9 calm-by-default layer.
- A dedicated **advisory/warning** channel (below-safety-stock alerts, excess-stock,
  master-data-broken). Phase 1 is **actionable-only**; urgency is a flag, conditions live
  in each action's `reason`/`triggerValues`.

## P1.2 Data model

One new table, two new enums, four new `responsibleEmployee` columns, one tolerance
column. Standard Carbon conventions (composite PK, `id('…')` default, audit columns, four
RLS policies, `companyId` scoping; RLS uses `get_companies_with_employee_role()` /
`get_companies_with_employee_permission()`).

```sql
CREATE TYPE "planningActionType" AS ENUM
  ('Order', 'Make', 'Expedite', 'Defer', 'Cancel', 'Increase', 'Decrease');
CREATE TYPE "planningActionStatus" AS ENUM ('Open', 'Dismissed', 'Actioned');

CREATE TABLE "planningAction" (
    "id" TEXT NOT NULL DEFAULT id('pla'),
    "companyId" TEXT NOT NULL,

    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,                          -- weekly bucket (get-or-create)
    "type" "planningActionType" NOT NULL,
    "status" "planningActionStatus" NOT NULL DEFAULT 'Open',

    "suggestedQuantity" NUMERIC NOT NULL,              -- lot-sized order qty (Order/Make) or target qty (Increase/Decrease)
    "suggestedDate" DATE NOT NULL,                     -- recommended due date for the action
    "isASAP" BOOLEAN NOT NULL DEFAULT false,           -- urgency: release/need date already in the past

    -- Target of a CHANGE action (exactly one set; both NULL for Order/Make):
    "purchaseOrderLineId" TEXT,
    "jobId" TEXT,
    "requiresManualAction" BOOLEAN NOT NULL DEFAULT false, -- target committed (sent PO / released job) → "Review on document"

    -- Suggestion attribution (the "why"; computed today, discarded today):
    "supplierId" TEXT,                                 -- resolved/preferred supplier for an Order
    "policyName" TEXT,
    "reason" TEXT,
    "triggerValues" JSONB,                             -- {projectedStock, safetyStock, reorderPoint, reorderQuantity, lotSize, leadTime}

    -- Assignment:
    "assignee" TEXT REFERENCES "user"("id"),           -- resolved responsibleEmployee snapshot; overridable
    "assigneeOverridden" BOOLEAN NOT NULL DEFAULT false, -- true once a human reassigns; regen won't re-resolve it

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
    -- + CHECK: purchaseOrderLineId/jobId both NULL for Order|Make; exactly one set otherwise
);
CREATE INDEX "planningAction_companyId_idx" ON "planningAction" ("companyId");
CREATE INDEX "planningAction_assignee_idx"  ON "planningAction" ("companyId", "assignee");
CREATE INDEX "planningAction_item_loc_idx"  ON "planningAction" ("companyId", "itemId", "locationId");
CREATE INDEX "planningAction_status_idx"    ON "planningAction" ("companyId", "status");
-- Deterministic regen identity (diff-write): one non-terminal action per
-- (item, location, type, period, target document)
CREATE UNIQUE INDEX "planningAction_natural_key_idx" ON "planningAction"
  ("companyId", "itemId", "locationId", "type", "periodId",
   COALESCE("purchaseOrderLineId", "jobId", ''))
  WHERE "status" <> 'Actioned';
```

Ownership ladder (tree: **company default → location → location-specific item group → item**) + the tolerance scalar:

```sql
ALTER TABLE "itemPlanning"    ADD COLUMN "responsibleEmployee" TEXT REFERENCES "user"("id"); -- per item+location (most specific leaf)
ALTER TABLE "location"        ADD COLUMN "responsibleEmployee" TEXT REFERENCES "user"("id"); -- per location
ALTER TABLE "companySettings" ADD COLUMN "defaultResponsibleEmployee" TEXT REFERENCES "user"("id"); -- company default (all)
ALTER TABLE "companySettings" ADD COLUMN "rescheduleToleranceDays" INTEGER NOT NULL DEFAULT 7
  CHECK ("rescheduleToleranceDays" >= 0);  -- negative would make every gap actionable

-- The "location > item group" tier. Item-group ownership is LOCATION-SPECIFIC — the
-- same group can have a different owner at each location — so it is NOT a column on
-- itemPostingGroup; it is a sparse per-(location, group) assignment table (the printer
-- AssignmentsCard tree: location default → per-work-center override, here location →
-- per-item-group override). Rows exist only for configured cells.
CREATE TABLE "itemPostingGroupResponsibility" (
    "id" TEXT NOT NULL DEFAULT id('pgr'),
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemPostingGroupId" TEXT NOT NULL,
    "responsibleEmployee" TEXT REFERENCES "user"("id"),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    -- Composite-FK prerequisites (verified 2026-09-11): "location" already has
    -- UNIQUE ("id","companyId") (20260905132037_job-operation-batching.sql), but
    -- "itemPostingGroup"'s PK is ("id") ALONE (parts.sql:69) — the migration must first
    -- add an idempotent UNIQUE ("id","companyId") on itemPostingGroup or this FK fails.
    CONSTRAINT "itemPostingGroupResponsibility_location_fkey"
      FOREIGN KEY ("locationId", "companyId") REFERENCES "location"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "itemPostingGroupResponsibility_group_fkey"
      FOREIGN KEY ("itemPostingGroupId", "companyId") REFERENCES "itemPostingGroup"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "itemPostingGroupResponsibility_unique" UNIQUE ("companyId", "locationId", "itemPostingGroupId")
);
```

`itemPostingGroupResponsibility` has RLS **explicitly enabled**
(`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` — policies are inert without it) plus the
four standard policies (SELECT via `get_companies_with_employee_role()`; writes via
`settings_update`, since it is configured on the settings screen).

`planningAction` gets the four standard RLS policies — SELECT via
`get_companies_with_employee_role()`, writes via `production_*`/`purchasing_*` (mirroring
the two planning pages). Any view surfacing `itemPostingGroup`/`location`/`itemPlanning`
is DROP/recreated with `SELECT *` to pick up the new column (per the view-redefinition
convention).

## P1.3 Ownership resolution (the inheritance ladder)

`responsibleEmployee` for an item+location resolves **most-specific first**. Drawn as a
tree it is **all → location → item group**, with a per-item leaf override on top (and the
per-message assignee override on top of that):

```text
itemPlanning.responsibleEmployee                     -- this item at this location (leaf override)
  ?? itemPostingGroupResponsibility[location, group] -- the item's group AT THIS LOCATION
  ?? location.responsibleEmployee                     -- this location
  ?? companySettings.defaultResponsibleEmployee       -- company default (all, the root)
  ?? NULL                                             -- Unassigned
```

- `itemPostingGroupId` lives on **`itemCost`** (not `item`), so the resolver joins
  `item → itemCost.itemPostingGroupId`, then looks up
  `itemPostingGroupResponsibility` by `(companyId, locationId, itemPostingGroupId)` — the
  item-group tier is **location-specific** (same group, potentially different owner per
  location).
- It is a **hierarchical inheritance tree, not a free classification matrix.** Although
  the item-group tier is keyed by `(location, group)`, it is the exact shape of the
  printer `AssignmentsCard` tree (location default → per-work-center override): a **sparse**
  set of configured cells that each fall back up the tree, resolved by one shared
  function. This is deliberately different from the removed N×M posting-group matrix
  (`20260229000000_drop-posting-groups.sql`), which was an independent customer-type ×
  item-group cross-product with no inheritance. Here every tier inherits from the tier
  above and returns the first non-null.
- The engine stamps the resolved value onto each `planningAction.assignee` at write time.
  A human reassignment (P1.7) sets `assigneeOverridden = true`; subsequent regens leave
  that row's assignee alone.

One **unified** `responsibleEmployee` covers both buy and make — the item's
`replenishmentSystem` decides which worklist (purchasing vs production) an action shows
on; the owner is the same person either way. Configured in a new settings screen cloned
from the printer `AssignmentsCard` (P1.7).

## P1.4 Engine changes (`runMrp`)

`runMrp` already computes period-phased net requirements per (item, location). Phase 1
adds a generation step that **diff-writes** `planningAction` rows in **its own atomic
Kysely transaction, immediately after the Phase-7 transaction commits** (it reads the
planning RPCs, which see only committed data, so it cannot live inside Phase-7 itself).
A generation failure **propagates to the caller** — `runMrp` reports the run failed
rather than succeeding with stale actions; the already-committed forecasts are correct
and the actions self-heal on the next successful run. For each (item, location, period):

- **No open supply covers the net requirement** → **`Order`** (Buy item) or **`Make`**
  (Make item). `suggestedQuantity` = the lot-sized reorder quantity (the same number the
  grid shows today, via the shared sizing function — P1.8 "sizing home"); `suggestedDate`
  = the need date; `supplierId` = preferred supplier for Buy.
- **An open PO-line/job covers it on the wrong date**, gap **strictly greater than**
  `rescheduleToleranceDays` (a gap ≤ tolerance is suppressed; the same `>` comparison is
  used everywhere — engine, tests, acceptance) → **`Expedite`** (needs to be earlier) or
  **`Defer`** (later). `suggestedDate` = the recommended new date; the target ref points
  at the open document.
- **An open order's quantity no longer matches** the requirement (after lot/order-multiple
  rounding) → **`Increase`** or **`Decrease`**.
- **An open order has no remaining requirement** → **`Cancel`**.
- **One action per target document.** Date and quantity rules can both match the same
  open PO-line/job; the engine emits only the **single highest-priority** action per
  target: **Cancel** (no remaining requirement — mutually exclusive with the rest) →
  **Expedite/Defer** (date) → **Increase/Decrease** (quantity). A target needing both a
  date and a qty change gets the date action; the qty change surfaces on a later run
  once the date is fixed (SAP folds qty into reschedule the same way). This is MRP-v2's
  "single highest-priority message on the line" rule applied to Phase 1.

Each row carries the resolved assignee (P1.3), the `reason`/`policyName`/`triggerValues`
attribution (computed by the sizing logic, discarded today), the `isASAP` urgency flag
(start/need date already past), and `requiresManualAction` (target already committed —
P1.5).

**Diff-write, never delete-and-recreate** (assignment + dismissal state must survive a
run). On the natural key `(item, location, type, period, target document)`:

- a matched **Open** row is **updated in place** (suggested qty/date/reason refreshed;
  `assignee` re-resolved only when `assigneeOverridden = false`);
- a matched **Dismissed** row stays dismissed **unless** the suggestion changed materially
  (qty beyond rounding, or date beyond `rescheduleToleranceDays`), in which case it
  re-opens;
- an unmatched **Open** *or* **Dismissed** row whose need has vanished is **deleted**
  (retired) — a dismissal suppresses a *persisting* need; once the need disappears the
  row must not linger, or its natural key would block a fresh Open row if the same need
  returns later. A returning need is a new situation and re-surfaces as a new Open row;
- **Actioned** rows are terminal and ignored — if the same need recurs, a fresh row is
  created.

Two consecutive unchanged runs are therefore idempotent (no churn of assignments or
dismissals). The current unconditional `supplyForecast` delete stays as-is for now
(Phase 2 removes it); the live `quantityToOrder` SQL suggestion is superseded on the
suggestion path (P1.6) while the weekly projection columns (`week1…weekN`) stay live.

## P1.5 Acting on a message

The `planningAction` row is a **recommendation**; the existing owning subsystem executes
it. No new execution engine.

| Type | On apply |
|---|---|
| **Order** | Reuse the existing `planning.update` `"order"` path (group by supplier+period, find-or-create a `Planned` PO, merge lines); stamp the assignee onto the PO. |
| **Make** | Reuse the existing production `planning.update` job-creation path. |
| **Expedite / Defer** | Uncommitted target — PO line: update `requiredDate`. Job: update the **job's demand target** via `updateJob({ dueDate: suggestedDate })`, then `notifyScheduleInputsChanged(companyId, "reorder", reason, jobId)` so the scheduler re-plans. Never `updateJobOperationDueDate` (that pins an *operation* need-by and sets `manuallyScheduled` — a different input) and never direct `jobOperation` date writes. |
| **Increase / Decrease** | Uncommitted — update `purchaseQuantity` (PO) or the job qty via existing services. |
| **Cancel** | Uncommitted — cancel/remove the PO line, or cancel the job, via existing services. |

**Commitment gate.** A change action's target may be **committed** — a PO already sent to
the supplier, or a job already released to the floor. Then the action is flagged
`requiresManualAction = true`: the message still surfaces the recommendation ("this sent
PO should pull in to Sep 12") but **does not silently edit** the document. Acting on it
**navigates the buyer to the PO/job** to handle through the existing workflow (reopen +
renegotiate + notify supplier); the UI shows **"Review on PO/Job"** instead of one-click
apply. An **automated reopen + supplier-notification / change-order flow is explicitly
deferred** — a separate feature.

**Apply binds to the persisted action (IDOR guard).** The apply route receives only a
`planningActionId`. The server loads the `planningAction` by **id + companyId**, requires
`status = 'Open'`, and executes from the row's **stored** type, target reference, and
proposal values — never from client-supplied targets or quantities. Mismatched or
non-Open requests are rejected; every target lookup and mutation is `companyId`-scoped.

Applied → the row flips to **`Actioned`** (next run won't recreate it). A buyer may also
**`Dismiss`** (won't recur until the underlying need changes materially). Both are
available in bulk.

> Commitment-gate facts (verified): "sent to supplier" = `isPurchaseOrderLocked(status)`
> (`PURCHASE_ORDER_LOCKED_STATUSES` = To Receive / To Receive and Invoice / To Invoice /
> Completed / Closed, `purchasing.models.ts`). Do **not** gate on `orderDate` —
> `insertPurchaseOrder` defaults it to today, so it is set even on freshly planned POs
> and would flag every one `requiresManualAction`. Jobs are committed at status
> `Ready` or later (`Ready`/`In Progress`/`Paused`); `Draft`/`Planned` are uncommitted.
> A reopen path exists (`reopenPurchaseOrderAsRevision`) for the manual flow.

## P1.6 Noise gating

A single company-level **`rescheduleToleranceDays`** (default **7** = one weekly bucket)
gates Expedite/Defer. **Canonical boundary: a message fires only when the date gap is
strictly greater than the tolerance (`gap > rescheduleToleranceDays`); a gap ≤ tolerance
is suppressed.** The same comparison is used in the engine, the tests, and the acceptance
criteria — at exactly 7 days, nothing fires. The column carries a `CHECK (>= 0)` (a
negative value would make every gap actionable) and the settings mutation validates
`0–365`.
Because Carbon already buckets planning by week, sub-week noise is invisible anyway. **No
separate quantity dampener in Phase 1** — Carbon's existing `orderMultiple`/`lotSize`/
min-max-OQ rounding absorbs trivial qty deltas; a dampener is a later add if churn
appears. (In/out split and per-item tolerance overrides are later refinements.)

## P1.7 UI

Extend the **two existing planning pages** — no new module or page. Files:
`apps/erp/app/routes/x+/{purchasing,production}+/planning.tsx`,
`apps/erp/app/modules/{purchasing,production}/ui/Planning/`.

- **Planning pages:** keep the live 48-week projection grid; the suggestion/action column
  now reads persisted `planningAction` rows. New columns: **action type**, **suggested
  date/qty**, **reason** (from `triggerValues`), **assignee**, **status**, urgency flag.
  Each row's primary control is **Apply** (one-click; bulk via the existing
  multi-select) — except `requiresManualAction` rows, which show **"Review on PO/Job"**
  and navigate.
- **Filters:** **assignee** (default *"my actions"* = current user — the buyer's
  cockpit), plus action type and status. **Bulk assign** and **bulk accept/dismiss** via
  the existing multi-select.
- **Assignment control:** the existing **`Assignee`** component per row, pre-filled from
  the resolved `responsibleEmployee`, reassignable inline (sets `assigneeOverridden`).
- **Settings — one new screen** cloned from the printer `AssignmentsCard`
  (`settings/ui/Printing/`): a **company-default** row, a list of all **locations**, and a
  list of all **item groups**, each with an `Employee` picker and an inherited-placeholder
  ("inherits {default}") when unset. Per-**item** override lives on the item's existing
  **Planning tab** (`responsibleEmployee`).
- **Deferred:** a unified cross-module "all my actions" cockpit (each page filtered to the
  user already is their queue).

Suggestions are **as-fresh-as-the-last-run** (3-hour cron + the existing manual
"Recalculate" button), not recomputed per page load — the correct ERP model and the
prerequisite for persistence/assignment.

## P1.8 Phase 1 Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Persistence | **New focused `planningAction` table** (not the Phase-2 `plannedOrder` lifecycle) | Assignment + dismissal require persistence; the full planned-order lifecycle is deferred. All action types in one table so the worklist is uniform. |
| Firm lifecycle | **None in v1** | Carbon converts a suggestion straight into a real `Planned` PO/job; no unfirmed tier needed for action messages. Planned→Firm→Released is Phase 2. |
| Action enum | **`Order\|Make\|Expedite\|Defer\|Cancel\|Increase\|Decrease`** (directional, user-facing) | Direction-in-the-type reads best for a buyer (SAP/D365/Epicor); Increase/Decrease included per Brad. Advisory/warning types excluded (actionable-only). |
| Change-action source | **Real open POs/jobs vs net requirement** | SAP's reschedule/cancel-on-firmed-receipt model; needs no planned-order layer. |
| Assignment | **Unified `responsibleEmployee` inheritance tree** all → location → location-specific item group → item, + per-row assignee override | Auto-routes on day one (SAP MRP-controller / Epicor Buyer-ID). The item-group tier is location-specific (sparse `itemPostingGroupResponsibility` table), mirroring the printer AssignmentsCard tree — an inheritance hierarchy, not the removed N×M classification matrix. |
| Acting | **Recommendation; existing subsystem executes.** Apply on uncommitted supply; navigate on committed | Committed = external commitment (sent PO / released job); silent edits there are wrong. Change-order/notify automation deferred. |
| Noise gating | **One company `rescheduleToleranceDays` (7)**, no qty dampener | 80/20 — date reschedules are the dominant noise; qty deltas already partly rounded. |
| Suggestion source of truth | **Persisted `planningAction`**; keep live projection columns | Grid and worklist can't disagree; refreshes per run (assignment prerequisite). |
| Reorder-sizing home | **Pure TS function shared by engine + client** (four existing policies) | The engine must produce the Order/Make quantity the grid shows; today the logic is duplicated in SQL (`calculate_quantity_to_order`) + client (`calculateOrders`). Phase 2a extends this function (`computePlanningOrders`) to size the planned orders; POQ is Phase 2c. |
| UI | **Extend the two existing planning pages** + one printer-style settings screen | Copy precedent; no new module. |

## P1.9 Relationship to the Phase 2 planned-order model

Phase 1 is forward-compatible with the `plannedOrder` design below:

- Phase 2 adds no action types. It reuses `planningActionType` (§2a.5).
- Phase 2a adds `plannedOrderId` to `planningAction`. An Order or Make action then
  converts its planned order. A change action can also target a Firm or fence-held
  planned order. The assignment ladder, worklist, filters and apply flow of Phase 1
  stay unchanged.
- Nothing in Phase 1 has to be torn out for Phase 2.

## P1.10 Phase 1 Acceptance Criteria

- [ ] An MRP run writes `planningAction` rows: a Buy item short of coverage yields an
      **Order** (qty = the grid's lot-sized quantity, `supplierId` = preferred); a Make
      item yields a **Make**.
- [ ] An open PO due later than the net requirement (gap > `rescheduleToleranceDays`)
      yields an **Expedite** with `suggestedDate`; an open PO due too early yields a
      **Defer**; both reference the `purchaseOrderLineId`.
- [ ] An open order whose qty falls short / exceeds the requirement yields **Increase** /
      **Decrease**; an open order with no remaining requirement yields **Cancel**.
- [ ] A date mismatch **≤** `rescheduleToleranceDays` yields **no** message; a mismatch
      **strictly greater** fires (boundary test at exactly the tolerance value).
- [ ] `responsibleEmployee` resolves item → item-group → location → company; the engine
      stamps the resolved user as `assignee`; an unset ladder leaves the action
      Unassigned. Setting the item-group employee routes all that group's actions to
      them; a per-item override wins.
- [ ] Reassigning an action in the UI sets `assigneeOverridden`; the next run does not
      overwrite that assignee, but still refreshes suggested qty/date.
- [ ] Two consecutive runs with unchanged inputs produce **byte-identical**
      `planningAction` rows (diff-write); a **Dismissed** action stays dismissed across a
      run unless its suggestion changes materially; an **Actioned** action is not
      recreated.
- [ ] Applying an **Order** on an uncommitted plan creates/merges a `Planned` PO (the
      existing behavior) and flips the action to **Actioned**; applying **Expedite** on a
      Draft/Planned PO line edits its `requiredDate`.
- [ ] A change action whose target PO is already **sent** is flagged
      `requiresManualAction`; the worklist shows **"Review on PO"** and navigates to the
      PO instead of editing it.
- [ ] The planning pages render the new columns; the **"my actions"** filter defaults to
      the current user; bulk apply/assign/dismiss work via multi-select.
- [ ] The settings screen lists company default + every location + every item group with
      inherited-placeholders; the item Planning tab has a `responsibleEmployee` field.
- [ ] Gates: `pnpm --filter @carbon/ee test` (action-message generation + resolver +
      sizing) green; scoped ERP typecheck green; `pnpm run generate:types` committed;
      browser verification of the worklist + settings on the satellite dataset.

## P1.11 Phase 1 Open Questions

> All resolved with Brad 2026-09-08 (run record:
> `.ai/runs/2026-09-08-mrp-planning-actions.md`). Kept as the decision record.

- [x] **Scope vs the full MRP-v2 build?** — **Phased.** Ship action messages +
      assignment first (Phase 1); defer the planned-order cascade/lifecycle/capacity/
      simulation to Phase 2 of this spec.
- [x] **Persistence: full plannedOrder lifecycle or focused table?** — **Focused
      `planningAction` table, no Firm lifecycle**, diff-write, all types persisted.
- [x] **Assignment axis?** — **Unified `responsibleEmployee` inheritance tree**
      all → location → **location-specific** item group → item + per-row assignee
      override (2026-09-09 refinement: the item-group tier is per-location, stored in a
      sparse `itemPostingGroupResponsibility` table — a printer-style inheritance tree,
      not the removed N×M matrix).
- [x] **Enum names + Increase/Decrease in v1?** — **`Order|Make|Expedite|Defer|Cancel|
      Increase|Decrease`**; Increase/Decrease **included**.
- [x] **Advisory exceptions in v1?** — **Actionable-only**; urgency is a flag, conditions
      in `reason`/`triggerValues`; warning channel deferred.
- [x] **Tolerance?** — **One company `rescheduleToleranceDays` (7)**, no qty dampener.
- [x] **Acting on committed vs uncommitted supply?** — **Apply on uncommitted; navigate
      ("Review on document") on committed**; automated reopen+notify deferred.
- [x] **Keep or replace the live grid?** — **Keep projection columns; persisted
      `planningAction` is the suggestion source of truth** (refresh per run).
- [x] **UI surface?** — **Extend the two existing planning pages** + one printer-style
      settings screen; unified cockpit deferred.

---

# Phase 2 — Planned-order MRP

> Phase 1 (§P1) shipped the planning-action worklist on the current per-item netting.
> Phase 2 gives MRP a real planned-order layer. It ships in 3 parts:
>
> | Part | Scope | Status |
> |------|-------|--------|
> | **2a** | `plannedOrder`, buffer-policy cascade, lot-sized explosion with scrap, Firm, time fence, Convert, pegging, one number on every planning surface | Fully specified. Ships first. |
> | **2b** | Live replanning, open jobs dated at the scheduler's projected finish, rough-cut capacity, capable-to-promise, the cascade tree and time-phased matrix, the calm worklist | Designed. Starts after 2a. |
> | **2c** | Programmable conversion through workflows, automation rails, planning notifications, agent data tools, suggested demand projections, Period of Supply lot-sizing | Designed. Starts after 2b. |
>
> Research: `.ai/research/mrp-v2-phase-2-planned-orders.md` (SAP, Dynamics 365,
> Oracle, NetSuite, Epicor) and `.ai/research/mrp-v2-planner-ui.md`. Engine numbers:
> `.ai/research/2026-08-12-mrp-findings.md`.

## Terms

This spec uses one term per concept.

| Term | Meaning |
|------|---------|
| **Planned order** | A `plannedOrder` row: the supply that MRP suggests for one item, location, segment and week. MRP can change or delete it on any run. |
| **Planned job / Planned PO** | A real `job` or `purchaseOrder` in its first status, `Planned`. Converting a planned order creates one. Do not confuse it with a planned order. |
| **Firm** | A planned order that a person locked. MRP must not change its quantity or dates. MRP raises planning actions on it instead. This is the SAP and Oracle meaning. Dynamics 365 calls this state "Approved". |
| **Fence-held** | A planned order whose release date falls inside the planning time fence. MRP treats it like a Firm order for the run. Nothing stores this state. MRP computes it on each run. |
| **Convert** | Create the Planned job or Planned PO line from a planned order. SAP uses the same word. |
| **Release** | The existing Phase 1 action: move a Planned job or Planned PO to its next status. Phase 2 does not change it. |
| **Lot-sized quantity** | The order quantity after the item's reorder policy and order rules round the net requirement. |
| **Explosion quantity** | The lot-sized quantity plus the item's scrap allowance. MRP explodes this quantity to the components. |
| **Netting segment** | `planningSegmentId`: `''` for common stock, a project id, or a planning-group id. |
| **Peg** | A `projectPeg` row: it links one piece of supply to the demand it covers. |

## TLDR

Carbon's MRP nets existing demand against supply and suggests a reorder quantity per
item. It has 2 defects:

1. **A buffer need does not explode.** If a Make item is short only because of its
   reorder policy, MRP creates no demand for its components. The demand appears only
   after a person creates the parent job.
2. **MRP explodes the raw need, not the lot-sized quantity.** If the shop needs 3 and
   the batch size is 5, MRP plans components for 3. The job needs components for 5.

Phase 2a fixes both. MRP plans each item once, in low-level-code order. For each
shortage, it creates a planned order with the lot-sized quantity. Then it explodes the
explosion quantity to the components, in the same run. A buffer need and a sales order
get the same treatment. SAP and Dynamics 365 work the same way.

Planned orders are suggestions until a person converts them. A planner can firm a
planned order to keep their numbers. A per-item time fence holds near-term orders
still. MRP pegs every planned order to the demand it covers, so the planner can see
why it exists.

Phases 2b and 2c build on this layer. 2b makes the plan live and capacity-aware. 2c
makes it programmable.

## Problem Statement

### The engine only cascades actual demand

`explodeBom` (`packages/database/src/mrp-engine.ts:260`) is a correct multi-level
explosion. It computes low-level codes and walks items level by level. It nets each
item against on-hand and explodes the shortfall to the children with a lead-time
offset. But it explodes only what is already in `grossDemand`.

`planCompany` (`packages/planning/src/mrp/plan-company.ts`) fills `grossDemand` from 6
sources:

1. Open sales-order lines (`:585`).
2. Materials of jobs that already exist (`:645`).
3. Project materials (`:694`).
4. Project borrows (`:738`).
5. The unconsumed part of `demandProjection` (`:834`).
6. The Consume First redirect (`:952`).

A reorder-policy need is not one of them. `generatePlanningActions` sizes the Order and
Make actions after the engine has finished (`mrp.ts:658`). So the engine sees no demand
for the parent and explodes nothing to its components.

### Reproduction (verified against `Carbon Development`, 2026-08-22)

1. The planning grid shows demand 0 for ANT-PATCH-01.
2. "Make 5" on COMMS-001 creates a Planned job `J000010` (quantity 5). Its material
   lines are TXRX-SBAND ×5, **ANT-PATCH-01 ×10** (BOM quantity 2) and MAT-KAPTON ×2.5.
3. The next MRP run reads those job materials through `openJobMaterialLines`.
   ANT-PATCH-01 demand becomes 10.

The dependent demand is correct, but it appears only after the parent job exists. On
2026-11-14 the code on `main` still behaves this way.

### Secondary defects

- **Raw-need explosion.** `mrp-engine.ts:428` computes
  `child.quantity * netRequirement` (net at `:410`). If lot-sizing rounds 3 up to 5,
  the components are short by 2 parents' worth.
- **No scrap.** MRP applies no scrap. Job creation applies each item's
  `scrapPercentage` through `computeJobQuantities`
  (`packages/database/src/job-quantities-engine.ts`). So MRP plans fewer components
  than the job needs.
- **No planned-order layer.** "Make" creates a Planned job at once. MRP deletes every
  `supplyForecast` row on each run (`mrp.ts:529`) because no durable planned order
  exists to reconcile against.
- **Two copies of lot-sizing.** SQL `calculate_quantity_to_order` and TS
  `computePlanningOrders` (`packages/utils/src/planning-sizing.ts:252`) hold the same
  rules. A parity test pins them (`planning-sizing.test.ts:404`). A third copy in the
  engine would drift.

### Why parity is not the target

A textbook MRP fixes the defects above but keeps 4 failures that make small shops
abandon MRP. Phases 2b and 2c answer them.

| Failure | Answer |
|---------|--------|
| **Staleness.** A plan that runs every 3 hours is wrong for up to 3 hours after each change. | 2b: live replanning. The engine runs a full company in about 0.3–0.5 s. |
| **The fixed-lead-time lie.** MRP dates open-job supply at the due date. The finite scheduler knows the projected finish (`job.projectedCompletionAt`). | 2b: net open jobs at the projected finish. |
| **Black-box distrust.** A suggestion with no derivation gets ignored. | 2a: the lot-sizing trace and pegs. 2b: the change banner. 2c: the agent. |
| **Exception fatigue on dirty inputs.** Defaulted lead times and stale POs flood the worklist. | 2b: confidence-gated actions and the readiness panel. |

Carbon is the only surveyed system whose MRP and finite scheduler share one process,
one language and one package (`@carbon/planning`). Phase 2b uses that.

## Proposed Solution — Phase 2a

### 2a.1 The engine sweep

MRP plans each (location, segment, item) once, in strict low-level-code order. A
single sweep is enough for an acyclic BOM. The low-level code puts every item after all
of its parents, so all of its dependent demand is in place before MRP plans it. The
existing `for (level = 0..maxLevel)` loop in `explodeBom` is that sweep. The existing
cycle break stays: MRP plans cycle members last, as leaves.

At each item, the sweep does the full net, size and explode step:

```
for level in 0..maxLevel:
  for each (location, segment, item) at this level:
    grossReq  = dependent demand from parents (already accumulated)
              + independent demand (the 6 sources above)
    bufferReq = the reorder policy's need (reorder point, safety stock, maximum)  # NEW
    receipts  = open jobs + open PO lines + Firm and fence-held planned orders
    onHand    = quantityOnHand - quantityNonNettable
    for each period:
      netReq = max(0, grossReq + bufferReq - onHand - receipts)   # period-phased
      if netReq > 0 and item is outside the fence for this need date:
        { orders, trace } = computePlanningOrders(...)            # EXTENDED: one net requirement in, a trace out
        for each order (one per batch or split):
          dueDate     = the period's need date (per-batch dating, #1912)
          releaseDate = working-day offset of dueDate by the lead time
          emit plannedOrder(quantity = order.quantity, trace, segment, makeMethodId)
          peg the order to the demand it covers
          if item is Make:
            explosionQty = order.quantity + scrapAllowance(order.quantity, item.scrapPercentage)
            for each child in bomChildren(item):                 # skips quantity-0 lines
              childQty = child.quantity * explosionQty            # FIX: was * netReq
              childQty += scrapAllowance(childQty, child.scrapPercentage) unless child is Make to Order
              grossDemand[child, releaseDate period, segment] += childQty
      carry projected on-hand forward (order surplus is stock for later periods)
```

Rules:

- **Explode the explosion quantity.** This is the core fix. It follows SAP and
  Dynamics 365: lot-size first, then explode.
- **Scrap uses the job rule.** The engine applies `scrapAllowance` the way
  `computeJobQuantities` does: whole units, rounded up, from the item's
  `scrapPercentage`. A child that is Make to Order adds no scrap to its own target.
  The plan and the converted job then agree.
- **The buffer need joins at the item's own level.** All parent demand is in place
  first, so MRP plans the item once. The 3 buffer policies (Demand-Based Reorder
  safety stock, Fixed Reorder Quantity reorder point, Maximum Quantity) seed it.
  Manual Reorder seeds nothing.
- **Surplus is stock.** If an order of 5 covers a need of 3, the 2 extra units are
  projected on-hand for the next periods. MRP does not plan them again.
- **One sizing function.** Extend `computePlanningOrders` to size one net
  requirement and to return a trace. Keep the SQL `calculate_quantity_to_order` for
  rows with no planned order (§2a.8). The parity test stays.
- **Keep the Phase 1 sizing rules.** These rules work as they do today: batch size,
  order multiple, `maximumPerOrder`, frozen orders (`isOrderFrozen`), and per-batch
  dating for Demand-Based Reorder (#1912).
- **Dates are working days.** `releaseDate` uses the location calendar and the same
  day math as the scheduler's need-by pass (`calendar-utils`). A Buy lead time stays
  in calendar days, and the release date moves back to the nearest working day.
- **Open-job supply keeps its current date in 2a.** `jobCompletionDate`
  (`supply-date.ts:62`) does not change until 2b.

### 2a.2 Netting segments, supersession and configured BOMs

- **A planned order belongs to one segment.** `plannedOrder.planningSegmentId` is part
  of its natural key.
- **A component inherits its parent's segment.** The child's demand nets in that
  segment. The existing common-surplus rule applies: a project segment can draw the
  common segment's true surplus unless `itemPlanning.allowCommonSupplyForProjects` is
  false.
- **Project segments stay lot-for-lot**, as Phase 1 does (`planning-actions.ts:1591`).
  So a project order has no surplus to place.
- **Planning groups** keep their segment rule and their feature gate. `@carbon/planning`
  gets the group pegging functions through `MrpDeps` (`mrp.ts:336-352`), as today.
- **Consume First.** A lot-sized parent explodes through the redirected BOM, in whole
  assemblies, in the common segment only. This follows SAP discontinuation: MRP uses the
  old part's stock first, then moves the rest of the demand to the successor.
- **Configured BOMs.** The sweep reads children only through `bomChildren`, so a
  quantity-0 configuration line never explodes.
- **Make to Order children.** A Make child with method type Make to Order gets no
  planned order of its own. Its demand passes through to its own children, and job
  creation spawns its subjob when the parent converts. SAP and NetSuite treat a phantom
  the same way.

### 2a.3 Lifecycle: Planned, Firm, Converted

```
          firm (a person)               convert
Planned ─────────────────────▶ Firm ───────────────▶ Converted
   │  ◀───────────────────────   │
   │        unfirm               │
   └──────────── convert ────────┴──▶ Converted
```

- **Planned.** MRP owns the row. Each run updates it in place, keeps it, or deletes it
  (§2a.6).
- **Firm.** A person owns the row. MRP never changes its quantity or dates. It counts
  as fixed supply, and it still explodes to its components. If MRP disagrees, it raises
  a planning action on the order (§2a.5). `firmedBy` holds the user. A manual edit to a
  planned order's quantity or dates firms it, as in SAP.
- **Converted.** The Planned job or Planned PO line exists. `jobId` or
  `purchaseOrderLineId` points at it. MRP reads that document as supply from now on and
  never touches the converted row again.

The worklist does not ask the user to learn "Firm". If a planner edits a quantity or a
date, the drawer asks once: *"Keep your numbers through plan updates?"* Yes firms the
order. The status chip still says "Firm".

### 2a.4 The planning time fence

The fence keeps near-term orders still. It is a number of working days from today:

```sql
ALTER TABLE "location"     ADD COLUMN "planningTimeFenceDays" INTEGER NOT NULL DEFAULT 0
  CHECK ("planningTimeFenceDays" >= 0);
ALTER TABLE "itemPlanning" ADD COLUMN "planningTimeFenceDays" INTEGER
  CHECK ("planningTimeFenceDays" >= 0);   -- NULL = use the location's value
```

MRP resolves `COALESCE(itemPlanning."planningTimeFenceDays",
location."planningTimeFenceDays", 0)` per item. `0` means no fence. An explicit item
`0` takes a volatile item out of a location-wide fence. SAP, Oracle and Dynamics 365
all set the fence per item. The fence is not `planningHorizonDays`, which is a display
filter (`20261006130004_planning-horizon.sql`).

MRP tests each order's **release date** against the fence, as Dynamics 365 Planning
Optimization does. Inside the fence:

1. **An existing Planned order is fence-held.** MRP keeps its quantity and dates and
   counts it as fixed supply. Its status stays Planned. Nothing stores the hold. MRP
   computes it again on each run, as SAP does with fence firming.
2. **A new need creates an order at the fence end.** MRP dates the new planned order on
   the first working day after the fence. It raises an Expedite action on that order,
   with the real need date as `suggestedDate`. This is SAP firming type 1.
3. **A fence-held order with no demand left stays.** MRP raises a Cancel action on it.
   It does not delete it silently, because someone may already have bought parts for
   it. Applying the Cancel deletes the order.

Because the fence is computed, a fence-held order cannot outlive its demand without a
visible Cancel action. No cleanup sweep is needed.

### 2a.5 Planning actions over planned orders

Phase 2a reuses the Phase 1 worklist (`planningAction`). It adds no action types.

| Action | Phase 2a source | Applying it |
|--------|-----------------|-------------|
| **Order** / **Make** | One per Planned or Firm planned order. `plannedOrderId` points at it. | Converts the planned order (§2a.7). |
| **Expedite** / **Defer** / **Increase** / **Decrease** / **Cancel** on an open job or PO line | `deriveChangeActions`, as in Phase 1. | As in Phase 1. |
| **Expedite** / **Defer** / **Increase** / **Decrease** / **Cancel** on a Firm or fence-held planned order | `deriveChangeActions`, extended to targets of type planned order. | Edits the planned order. The edit firms it. Cancel deletes it. Never `requiresManualAction`. |
| **Release**, **Transfer**, **Borrow** | Unchanged. | Unchanged. |

The Order or Make quantity is the planned order's quantity. So the grid, the worklist
and the drawer show one number. The owner ladder, the tolerance gate
(`rescheduleToleranceDays`), the frozen-order rule and the read-time horizon apply
unchanged.

### 2a.6 Persistence and regeneration

`plannedOrder` is the durable output of the sweep. Each Planned row has a natural key:
`(companyId, itemId, locationId, planningSegmentId, orderType, periodId, splitIndex)`.
`splitIndex` is above 0 only when `maximumPerOrder` or batch sizing splits one week's
need into more than one order.

The Phase 7 transaction diff-writes `plannedOrder`:

1. If a generated order matches a Planned row on the natural key, update the row only
   when a value changed. The id and `createdAt` stay the same.
2. Insert each generated order that matches no row.
3. Delete each Planned row that matches no generated order, unless it is fence-held
   (§2a.4 rule 3).
4. Leave Firm and Converted rows alone.

The same transaction writes the pegs (§2a.9). If the run fails, the previous plan
stays. `generatePlanningActions` runs after the commit, under its advisory lock, as in
Phase 1. Two runs with the same inputs produce the same rows, ids included.

`plannedOrder` replaces `supplyForecast` on the planning path. The `planning.update`
routes stop writing `supplyForecast`, and MRP drops the unconditional delete at
`mrp.ts:529`.

### 2a.7 Convert

Applying an Order or Make action converts its planned order. So does the Convert
button in the drawer. The row's button keeps the words "Make" and "Order", so the
Phase 1 muscle memory stays.

- **Make.** The service creates a Planned job through the existing path (`insertJob`
  and `upsertJobMethod`). That path reads the item's make method again. If the method
  changed after the run that exploded the planned order, the drawer shows the
  difference before the user confirms. SAP copies the planned components by default.
  Carbon reads the method again because the job-creation path already does it.
- **Buy.** The service adds a line to a Planned PO for the planned order's supplier and
  location. One Planned PO collects every converted line with the same supplier and
  location, as NetSuite does. Extend `orderPlannedPurchases` for this.
- **After either one**, the planned order becomes Converted, and the action becomes
  Actioned. The next run reads the job or PO line as supply. It does not count the
  planned order again.
- **Partial conversion is deferred.** To convert part of an order, edit the quantity
  first. The edit firms the order.

### 2a.8 One number on every planning surface

`get_production_planning` and `get_purchasing_planning` read `plannedOrder` as the plan.
For an item that has a current planned order, `quantityToOrder` is the planned-order
total. `calculate_quantity_to_order` fills only the items that have no planned order,
for example an item that got demand after the last run.

### 2a.9 Pegging

Phase 2a extends the existing `projectPeg` table instead of adding a second peg table.

- `planningGroupId` and `projectId` become nullable. A peg in the common segment has
  both null. A CHECK keeps the planning-group rules for pegs in a group segment.
- `projectPegSupplyType` gains `'Planned Order'`. `supplyId` holds the planned order's
  id.
- `demandForecastSourceType` gains `'Planned Order'`. A component's peg names its
  parent planned order as the demand. `parentPegId` links the chain up to the
  independent demand.
- A buffer need pegs to a demand source of type `'Reorder Policy'` (new enum value)
  with the `itemPlanning` row as `demandSourceId`.
- The table name stays `projectPeg`. The planning-group writer, the views, the RLS
  policies and the backup manifest all use that name. A rename adds risk and changes no
  behavior.
- The MRP writer supersedes only the pegs whose values changed, with the existing
  `diffPegs`. A run with no changes writes no peg rows. The common-segment writer lives
  in `@carbon/planning`. The planning-group logic stays in `@carbon/ee/pegging`.
- A lot-size surplus pegs to nothing. The drawer shows it as "quantity without source",
  the SAP term.

Pegs are soft: one supply can serve many demands. A Make to Order job linked to a sales
order line stays the hard-peg case, as today.

### 2a.10 Explain the number

The planned order stores the trace from `computePlanningOrders` in `quantityTrace`. The
drawer shows it as a line, for example *"Net requirement 3 → Fixed Reorder Quantity 5 →
order multiple 5 → scrap +1 → explode 6"*. A peg popover answers "why does this exist?"
(the demand it covers) and "what does it drive?" (its child planned orders).

## Proposed Solution — Phase 2b

### 2b.1 Live replanning

Copy the scheduler's notify, debounce and replan pattern (`notifyScheduleInputsChanged`
→ `carbon/schedule.inputs.changed` → `scheduleReplanWaveFunction`).

- **Emitter.** `notifyPlanningInputsChanged(companyId, kind, reason, entityId?)` in
  `production.service.ts`. `kind` is one of `salesOrder`, `purchaseOrder`, `job`,
  `inventory`, `bom`, `itemPlanning`, `demandProjection`, `plannedOrder`. `reason` is a
  readable cause, for example "SO-1042 quantity changed".
- **Call sites.** These service functions call the emitter:
  1. Sales-order line writes and status changes.
  2. PO line writes and status changes.
  3. Job status changes and job quantity or date edits.
  4. Receipt, shipment and adjustment posting.
  5. `methodMaterial` writes.
  6. `itemPlanning` and `itemReplenishment` edits.
  7. `demandProjection` edits.
  8. Planned-order firm, edit and convert.
- **Inngest listeners.**
  - `markPlanningStaleFunction` runs at once. It upserts the one row per company in
    `planningState` (`lastInputAt`, `lastInputKind`, `lastInputReason`).
  - `planningRegenFunction` debounces 30 s, with concurrency 1 per company. It calls
    `runMrp` in-process. At 0.3–0.5 s per run, a busy company costs about 2 runs per
    minute at most.
- **The 3-hourly cron and the daily `mrpRunTime` stay** as the backstop for a missed
  call site and for the weekly roll.
- **Every run writes a `planningRun` row**: trigger, cause, timing, change counts and
  the rough-cut load. Keep the newest 200 rows per company.

The time fence (§2a.4) is the guard that makes live replanning safe. Near-term orders
stop moving however often the plan runs.

### 2b.2 Open jobs at the projected finish

`jobCompletionDate` (`supply-date.ts:62`) returns `job.projectedCompletionAt` when the
scheduler has set it. Else it returns the due date, as today. `openProductionOrders`
exposes `projectedCompletionAt`. The MRP rule allows no other place to date supply, so
this one function and this one view are the whole change.

A job that the scheduler projects late then gets an Expedite action through
`deriveChangeActions`, with no new action type. Dynamics 365 has netted late orders at
their expected completion since 2023. Applying a job Expedite still goes through
`updateJob({ dueDate })` and `notifyScheduleInputsChanged`. The scheduler owns job
dates. MRP only recommends.

### 2b.3 Rough-cut capacity

After the sweep, MRP prices the planned Make orders against work-center hours:

- **Work content** of a planned order = the active routing's operation times (setup +
  max(labor, machine) per operation) × the order quantity. MRP spreads it over the
  order's release-to-due window, per work center.
- **Available hours** per work center per week come from the availability ladder
  (`resolveWorkCenterWindows`), minus maintenance downtime and the hours that
  `capacityReservation` already holds for live jobs.

MRP records **one capacity exception per (work center, week)** in
`planningRun.loadSummary`, with the contributing orders inside it. Each contributing
planned order gets a secondary `capacityConstrained` badge. One missing shift shows as
one row. MRP moves no order on its own. SAP's Manage Work Center Capacity and pMRP work
the same way. The UI labels it "rough-cut" everywhere. Scenario finite scheduling of
planned orders is deferred.

### 2b.4 Capable-to-promise

Extend `runQuoteLeadTimeWhatIf` (`scheduling/quote-lead-time.ts:626`). Do not write a
second what-if engine. The extended call runs the 2a sweep and the rough-cut pass
against live inputs plus one hypothetical demand line. It writes nothing. It returns:

1. The **promise date**: the latest finish along the exploded tree, on real calendars.
2. The **plan change**: the planned orders that the line would add or change.
3. The **capacity impact**: the weeks that would go over capacity.
4. The **estimated cost** of the new orders.
5. The **assumptions**, rendered word for word: *"assumes the current plan converts on
   time; material and rough-cut capacity only; shop queue not simulated"*.

The quote line and the sales-order line get a "Can we make it?" action. The panel says
"plan-based" everywhere. It writes a date to the line only when the user accepts it,
as NetSuite's Earliest Item Availability does.

### 2b.5 The calm worklist

- **The worklist never moves under the planner.** It does not revalidate live. A
  watcher on `planningRun` and `planningState` shows a banner: *"Plan updating —
  SO-1042 changed"*, then *"Plan updated — 3 changes · Refresh"*. Rows change only on
  Refresh.
- **Stale submissions are caught.** Each mutation sends the loaded rows' `updatedAt`.
  The server rejects each changed row on its own and reports it: *"2 of 12 selected
  orders changed since you loaded them. Review these 2. The other 10 succeeded."*
- **Confidence gating.** Each run computes readiness flags per item:
  1. The lead time was never maintained.
  2. A routing has zero times.
  3. A Make item has no active BOM or routing.
  4. An open PO is more than 60 days past due.

  An action from a flagged input gets `lowConfidence = true` and a `confidenceNote`,
  for example *"computed from the default 7-day lead time"*. The default filter and
  every digest leave these actions out. An "All messages" view shows them with a badge.
- **Readiness panel.** It shows the company-wide counts of the 4 flags. Each count
  links to a filtered list where the user can fix the input. It also shows before the
  first run.
- **Change banner and mark-reviewed.** The header compares the latest `planningRun`
  with the planner's `reviewedAt`: *"Since your last review: 3 new, 2 moved earlier,
  1 cancelled. Latest cause: SO-1042 quantity changed."*
- **Chain conversion across teams.** Converting a cascade that crosses the make/buy
  permission boundary firms the whole chain in one transaction. It converts the side
  the user may convert. It notifies the other team with
  `NotificationEvent.PlannedOrdersAwaitingRelease`, with a link to the chain.

### 2b.6 Cascade tree and time-phased matrix

- **Cascade tree.** Independent demand → planned order → child planned orders → buys.
  It reuses the job and method BOM-tree rendering. Each level shows its order-by date.
  The row action converts the whole chain (§2b.5).
- **Time-phased matrix.** An expert drill-down per item, never the landing page. It has
  the 6 standard rows per week: Gross Requirements, Scheduled Receipts, Projected
  Available Balance, Net Requirements, Planned Order Receipts, Planned Order Releases.

## Proposed Solution — Phase 2c

### 2c.1 Programmable conversion

- **Trigger entity.** Register `plannedOrder` in the workflow catalog
  (`packages/workflows/src/catalog/entities.ts`). Watch `status`, `dueDate` and
  `quantity`. Do not watch `capacityConstrained`, because regeneration flips it. The
  diff-write keeps these events meaningful.
- **Moment.** `planning.actionRaised` fires when a run opens a new planning action on a
  planned order.
- **Operations.** `convertPlannedOrder` and `firmPlannedOrder` in
  `catalog/operations.ts`. A shop can then write a rule like *"if a Buy planned order
  costs under $500 and its supplier is approved, convert it and post to Slack"*.

### 2c.2 Automation rails

Three `companySettings` columns gate both planning operations:

```sql
ALTER TABLE "companySettings"
  ADD COLUMN "planningAutomationsPaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "planningAutomationsDryRun" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "planningAutomationMaxConversionsPerRun" INTEGER NOT NULL DEFAULT 25
    CHECK ("planningAutomationMaxConversionsPerRun" >= 0);
```

1. If `planningAutomationsPaused` is true, skip the operation and log the reason.
2. If `planningAutomationsDryRun` is true, log the action as Skipped with the reason,
   and create nothing. Dry run is on by default.
3. If the run reaches the cap, queue the rest and show a notice.

A daily autopilot ledger in the planning digest lists everything that automation
converted.

### 2c.3 Notifications

- `NotificationEvent.PlanningExceptions` sends a digest per location planner. It holds
  new normal-confidence actions, new over-capacity weeks and the autopilot ledger. In-app
  is on by default. Email and Slack are opt-in. Low-confidence actions never notify.

### 2c.4 Agent data tools

Restore the agent data tools from the commit that removed them on 2026-09-30
(`git log -S AGENT_DATA_TOOLS_ENABLED`). Classify the planning reads
(`getPlannedOrders`, `getPlannedOrderCascade`, `getItemTimePhasedPlan`,
`getPlanningRun`) as READ in the MCP tool metadata. Add a planning page to the docs so
the agent knows the terms. The agent answers *"why is it telling me to order 50 of
ANT-PATCH-01?"* from the pegs and the trace.

### 2c.5 Suggested demand projections

`getSuggestedDemandProjection(client, { itemId, locationId })` computes a trailing
13-week average, with a simple trend, from `demandActual` sales-order history.

- If the history is too irregular (coefficient of variation above
  `SUGGESTION_MAX_CV = 0.8`), the service refuses. The UI shows the history sparkline
  and *"demand is too irregular for a simple average"*, with no number.
- `DemandProjectionForm` shows each suggestion as a ghost row with Apply. An applied row
  is an ordinary `demandProjection` row with `forecastMethod = 'suggested'` and a
  `confidence` value.

### 2c.6 Period of Supply lot-sizing

Add Period of Supply as a fifth `reorderingPolicy`. It orders the net requirements of
the next N periods in one order. It lives only in `computePlanningOrders`. It has no
SQL twin, because every item with this policy has a planned order (§2a.8).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Phasing | **2a / 2b / 2c**, as in the table at the top | 2a fixes both defects with the smallest new surface. The live, capacity and automation layers need 2a's planned orders first. |
| Planned order entity | **New `plannedOrder` table** | `supplyForecast` is a weekly aggregate with no identity, status or peg. A planned order must be firmable, convertible, peggable and diffable. |
| Sweep | **One low-level-code sweep**, reusing the `explodeBom` loop and its cycle break | The low-level code puts every parent first. One pass is enough. |
| Explosion quantity | **Lot-sized quantity plus scrap** | SAP and Dynamics 365 lot-size first, then explode. Scrap matches `computeJobQuantities`, so the plan and the job agree. |
| Buffer needs | **Seed the 3 buffer policies at the item's own level** | SAP MRP and Dynamics 365 treat safety stock as a requirement. Their planned orders explode like any other. |
| Sizing home | **Extend `computePlanningOrders`**; keep the SQL twin for no-plan rows | One TS function already exists, with a parity test. A new function would drift. |
| Firm meaning | **Firm = MRP must not change it** (SAP, Oracle) | It is the standard meaning. The glossary notes that Dynamics 365 says "Approved". |
| Who firms | **Only a person.** A manual edit firms the order. | SAP sets its firm flag on a manual change. |
| Time fence | **Computed on each run, never stored.** Per item, with a location default. Working days. Tested on the release date. | SAP computes fence firming per run. A stored system firm outlives its demand and needs a cleanup sweep. |
| New need inside the fence | **Order at the fence end plus an Expedite action** (SAP firming type 1) | The planner gets an order to act on. Creating nothing hides it. |
| Fence-held order with no demand | **Keep it and raise Cancel** | Someone may have bought parts for it. A silent delete hides that. |
| Turning a planned order into a document | **"Convert"**, not "Release" | Carbon already uses Release for a Planned job or PO. SAP calls this step conversion. |
| Components at conversion | **Read the make method again, and show a difference** | It reuses the job-creation path. The difference covers the risk that SAP's copy-by-default avoids. |
| PO grouping | **Supplier and location** (NetSuite) | Every vendor groups by supplier. Location keeps receiving correct. |
| Partial conversion | **Deferred.** Edit the quantity first. | SAP supports it, but the edit-then-convert path covers it. |
| Planning actions | **Reuse `planningAction`.** Order and Make point at `plannedOrderId`. No new action types. | One worklist, one owner ladder, one tolerance. Expedite already covers a late job. |
| Pegging | **Extend `projectPeg`**: nullable group and project, a `'Planned Order'` supply type | One peg model and one id prefix. Its supersede history is a better design than a new table. |
| Peg history volume | **Supersede only changed pegs** (`diffPegs`) | A run with no changes writes no rows. |
| Segment of a component | **The parent's segment**, with the existing common-surplus rule | It matches Carbon's segment rule and Oracle Fusion's netting order. |
| Project-segment lot size | **Lot-for-lot**, as today | No surplus to place. |
| Make to Order children | **No planned order; demand passes through** | Job creation spawns the subjob. SAP and NetSuite treat phantoms this way. |
| Regeneration write | **Diff-write on a natural key that includes the segment** | Stable ids give idempotency, honest change counts, clean workflow events and stale-row detection. |
| Supply dating | **2a: unchanged. 2b: `projectedCompletionAt`, else the due date** | One function and one view own supply dates. |
| Run cadence | **2b: event-driven with a 30 s debounce; the cron stays as backstop** | A full run costs about 0.3–0.5 s. SAP MRP Live and Dynamics 365 regenerate. |
| Capacity | **2b: rough-cut, one exception per (work center, week), no automatic move** | SAP's capacity app and pMRP. One problem, one row. |
| Capable-to-promise | **2b: extend `runQuoteLeadTimeWhatIf`; write a date only when the user accepts** | It reuses the existing what-if. NetSuite writes the date only on accept. |
| Confidence | **2b: flag actions from unmaintained inputs; leave them out of defaults and digests** | A live plan on dirty data is wrong at high frequency. |
| Automation | **2c: workflow entity and operations, inside pause, dry-run (on by default) and a cap** | Each shop writes its own rules. A bad rule must not create 40 POs overnight. |
| Transfer orders | **Reserve `'Transfer'` in `plannedOrderType`; generate nothing** | Multi-location planning is its own spec. |
| Demand time fence | **None in Phase 2** | Forecast consumption covers most of the need. |
| Make and buy pages | **Two pages, cross-linked in the cascade tree** | A unified page is deferred. |

## Data Model Changes

### Phase 2a

```sql
CREATE TYPE "plannedOrderType" AS ENUM ('Make', 'Buy', 'Transfer');   -- Transfer: reserved, not generated
CREATE TYPE "plannedOrderStatus" AS ENUM ('Planned', 'Firm', 'Converted');

CREATE TABLE "plannedOrder" (
    "id" TEXT NOT NULL DEFAULT id('plo'),
    "companyId" TEXT NOT NULL,

    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "planningSegmentId" TEXT NOT NULL DEFAULT '',      -- '' = common
    "orderType" "plannedOrderType" NOT NULL,
    "status" "plannedOrderStatus" NOT NULL DEFAULT 'Planned',

    "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0), -- lot-sized quantity (good units)
    "scrapQuantity" NUMERIC NOT NULL DEFAULT 0,        -- added to quantity for the explosion
    "quantityTrace" JSONB,                             -- from computePlanningOrders
    "dueDate" DATE NOT NULL,
    "releaseDate" DATE NOT NULL,                       -- working-day offset of dueDate by the lead time
    "periodId" TEXT NOT NULL,                          -- weekly bucket; part of the natural key
    "splitIndex" INTEGER NOT NULL DEFAULT 0,
    "lowLevelCode" INTEGER NOT NULL DEFAULT 0,

    "supplierId" TEXT,                                 -- Buy: resolved preferred supplier
    "makeMethodId" TEXT,                               -- Make: the method the run exploded

    "firmedBy" TEXT REFERENCES "user"("id"),           -- set only by a person
    "firmedAt" TIMESTAMP WITH TIME ZONE,

    "jobId" TEXT,                                      -- set on Convert (Make)
    "purchaseOrderLineId" TEXT,                        -- set on Convert (Buy)

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "plannedOrder_firm_chk" CHECK (("status" = 'Firm') = ("firmedBy" IS NOT NULL)),
    CONSTRAINT "plannedOrder_converted_chk" CHECK (
      ("status" = 'Converted') = ("jobId" IS NOT NULL OR "purchaseOrderLineId" IS NOT NULL)
    )
);
CREATE INDEX "plannedOrder_companyId_idx" ON "plannedOrder" ("companyId");
CREATE INDEX "plannedOrder_item_loc_idx" ON "plannedOrder" ("companyId", "itemId", "locationId");
CREATE INDEX "plannedOrder_status_idx" ON "plannedOrder" ("companyId", "status");
CREATE INDEX "plannedOrder_createdBy_idx" ON "plannedOrder" ("createdBy");
CREATE UNIQUE INDEX "plannedOrder_natural_key_idx" ON "plannedOrder"
  ("companyId", "itemId", "locationId", "planningSegmentId", "orderType", "periodId", "splitIndex")
  WHERE "status" = 'Planned';
```

Other Phase 2a changes:

1. Add the time-fence columns of §2a.4.
2. Add `plannedOrderId` to `planningAction`. Change `planningAction_change_target_chk`:
   - Order and Make: `purchaseOrderLineId` and `jobId` are null. `plannedOrderId` may
     be set.
   - Every change type: exactly one of `purchaseOrderLineId`, `jobId` and
     `plannedOrderId` is set.
3. Add `plannedOrderId` to the `COALESCE` of `planningAction_natural_key_idx`, before
   `periodId`.
4. Make `projectPeg.planningGroupId` and `projectPeg.projectId` nullable. Add a CHECK:
   both are null, or `planningGroupId` is set.
5. Add `'Planned Order'` to `projectPegSupplyType`. Add `'Planned Order'` and
   `'Reorder Policy'` to `demandForecastSourceType`. Put each `ALTER TYPE ... ADD VALUE`
   in its own migration, before the migration that uses the value.
6. Give `plannedOrder` the four RLS policies of `planningAction`: SELECT through
   `get_companies_with_employee_role()`, writes through the production and purchasing
   permissions.
7. Redefine every view that reads `projectPeg`, `location` or `itemPlanning` with
   `SELECT *`, so it picks up the new columns.
8. Add `plannedOrder` to the company backup manifest and to the demo datasets.

### Phase 2b

```sql
CREATE TABLE "planningRun" (
    "id" TEXT NOT NULL DEFAULT id('prun'),
    "companyId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,                           -- 'event' | 'cron' | 'manual'
    "triggerKind" TEXT,
    "triggerReason" TEXT,
    "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "ordersCreated" INTEGER NOT NULL DEFAULT 0,
    "ordersUpdated" INTEGER NOT NULL DEFAULT 0,
    "ordersDeleted" INTEGER NOT NULL DEFAULT 0,
    "ordersUnchanged" INTEGER NOT NULL DEFAULT 0,
    "loadSummary" JSONB,                               -- per (workCenterId, weekStart): available, reserved, planned, contributing order ids
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "planningRun_companyId_idx" ON "planningRun" ("companyId", "createdAt" DESC);

CREATE TABLE "planningState" (                         -- one row per company; service-role writes
    "companyId" TEXT NOT NULL,
    "lastInputAt" TIMESTAMP WITH TIME ZONE,
    "lastInputKind" TEXT,
    "lastInputReason" TEXT,
    PRIMARY KEY ("companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "plannedOrder"
  ADD COLUMN "capacityConstrained" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "planningAction"
  ADD COLUMN "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "confidenceNote" TEXT;
```

`openProductionOrders` exposes `projectedCompletionAt`. `planningState` is SELECT-only
for employees.

### Phase 2c

The 3 `companySettings` columns of §2c.2. `plannedOrder` gets the event-system
record-change trigger, so workflow record events fire.

## API / Service Changes

### Phase 2a

**Engine (`packages/planning/src/mrp/`, `packages/database/src/mrp-engine.ts`,
`packages/utils/src/planning-sizing.ts`)**

- Extend `computePlanningOrders` to size one net requirement for one period and return
  `{ orders, trace }`. Keep every Phase 1 rule. Keep the parity test.
- Extend `explodeBom` (or add `generatePlannedOrders` next to it) to run the §2a.1 step
  per level: buffer seed, sizing, scrap, explosion, surplus carry, segment, fence.
- Read existing `plannedOrder` rows in Phase 1–2 loads. Firm and fence-held rows are
  fixed supply.
- In the Phase 7 transaction, diff-write `plannedOrder` and the pegs (§2a.6, §2a.9).
  Drop the `supplyForecast` delete.
- Extend `deriveChangeActions` to planned-order targets. Make `generatePlanningActions`
  derive Order and Make actions from planned orders.
- Keep every new value-bearing calculation under the `@carbon/checks` precision rules:
  no scale literals, whole units through `round(x, 0, Up)`.

**ERP services (`production.server.ts`, `purchasing.server.ts`, their `.service.ts`
files)**

- `convertPlannedOrder({ id, updatedAt })`: the §2a.7 flow. It binds to the row by id
  and `companyId`, and it accepts only a Planned or Firm row.
- `firmPlannedOrder`, `unfirmPlannedOrder`, `updatePlannedOrder` (an edit firms the
  row), `deletePlannedOrder` (only through an applied Cancel).
- `getPlannedOrders` (the worklist query) and `getPlannedOrderPegs(id)` (the popover).
- The `planning.update` routes act on planned orders. They stop writing
  `supplyForecast`.

**RPCs:** `get_production_planning` and `get_purchasing_planning` follow §2a.8.

### Phase 2b

- `packages/lib/src/events.ts`: the event `carbon/planning.inputs.changed`.
- `production.service.ts`: `notifyPlanningInputsChanged`, called from the §2b.1 call
  sites.
- `packages/jobs`: `markPlanningStaleFunction` and `planningRegenFunction`.
- `rough-cut-capacity.ts`: a pure function over injected inputs. It returns the load per
  (work center, week) and the constrained order set.
- `readiness.ts`: the 4 readiness flags, used by the engine and by
  `getPlanningReadiness`.
- `supply-date.ts`: `jobCompletionDate` per §2b.2.
- `runQuoteLeadTimeWhatIf`: the §2b.4 extension. A route `POST api/planning/what-if`
  calls it (permission `view: "production"`, or `view: "sales"` from a quote).
- `convertPlannedOrderChain(rootId)`, `markPlannedOrdersReviewed(ids)`,
  `getPlannedOrderCascade(rootId)`, `getItemTimePhasedPlan(itemId, locationId)`,
  `getLatestPlanningRun(locationId?)`, `getPlanningState(companyId)`.
- Every planned-order mutation takes the loaded `updatedAt` per row and reports drifted
  rows one by one.
- `NotificationEvent.PlannedOrdersAwaitingRelease`.

### Phase 2c

- Workflow catalog: the entity, moment and operations of §2c.1. Each operation checks
  the §2c.2 rails first.
- `NotificationEvent.PlanningExceptions`.
- Agent: restore the data tools. Run `pnpm run generate:mcp` after the READ
  classification.
- `getSuggestedDemandProjection`.
- `computePlanningOrders`: the Period of Supply branch.

## UI Changes

### Phase 2a

Files: `apps/erp/app/routes/x+/production+/planning.tsx` and the purchasing twin,
`apps/erp/app/modules/{production,purchasing}/ui/Planning/`,
`ProductionPlanningOrderDrawer`, `ItemPlanningForm`, the location form.

1. **Worklist rows.** Each Order and Make row shows its planned order: quantity,
   order-by date, status chip (Planned / Firm), and a fence-held marker. The button
   still says Make or Order, and it converts.
2. **Drawer.** It shows the lot-sizing trace, the peg popover, "quantity without
   source", and Firm / Unfirm. An edit asks *"Keep your numbers through plan
   updates?"*. On Convert of a Make order, it shows the make-method difference when the
   method changed.
3. **Settings.** `planningTimeFenceDays` on the location form and on the item Planning
   tab, with the inherited value as the placeholder.

### Phase 2b

- The live banner and the change banner.
- The capacity strip.
- The readiness panel and its link.
- The cascade tree and the time-phased matrix.
- The "Can we make it?" panel on the quote line and the sales-order line.
- The "All messages" view.

### Phase 2c

The automation settings (pause, dry run, cap) on the production settings page, the
autopilot ledger in the digest, and the suggested-projection rows in
`DemandProjectionForm`.

## Acceptance Criteria

### Phase 2a — core cascade

- [ ] COMMS-001 has a reorder policy and no job. One MRP run creates a planned order for
      COMMS-001 and pegged planned orders or demand for ANT-PATCH-01 (×2 per parent) and
      its materials. No job exists yet.
- [ ] The cascade reaches full depth: COMMS-001 (Make) → ANT-PATCH-01 (Make) →
      MAT-CF-LAM and MAT-KAPTON (Buy). MRP pegs each order to its parent.
- [ ] Need 3, batch size 5, BOM quantity 2: the component demand is 10, not 6
      (regression test for `mrp-engine.ts:428`).
- [ ] The 2 surplus parents count as projected on-hand. A need of 2 next week creates
      no new planned order.
- [ ] Parent `scrapPercentage` 10 on an order of 10: the explosion quantity is 11. The
      component demand equals the job material quantity that `computeJobQuantities`
      gives for the same order.
- [ ] Each of the 3 buffer policies on a Make item creates a planned order that
      explodes. Manual Reorder creates none.
- [ ] `computePlanningOrders` returns a trace whose steps recompute to the final
      quantity. The SQL parity test is green.
- [ ] Batch size, order multiple, `maximumPerOrder`, frozen orders and per-batch dating
      give the same quantities and dates as Phase 1 on the Phase 1 fixtures.

### Phase 2a — segments, supersession, configured BOMs

- [ ] A project parent's component nets in the project segment. It draws common
      surplus only if `allowCommonSupplyForProjects` allows it.
- [ ] A project planned order is lot-for-lot.
- [ ] A parent whose component has a Consume First successor explodes through the
      redirect, in whole assemblies.
- [ ] A configured item explodes only its default configuration's lines.
- [ ] A Make to Order Make child gets no planned order. Its own children get the demand.

### Phase 2a — lifecycle and fence

- [ ] A Firm order survives regeneration with its quantity and dates. It still explodes.
- [ ] Editing a planned order's quantity firms it, with `firmedBy` = the user.
- [ ] Fence 10 days: an existing Planned order with a release date on day 8 keeps its
      quantity and dates across a run that would change them. Its status stays Planned.
      No column stores the hold.
- [ ] Fence 10 days: a new need on day 6 creates a planned order dated on the first
      working day after day 10, and an Expedite action with `suggestedDate` = day 6.
- [ ] Fence 10 days: a fence-held order loses its demand. It stays, and it gets a Cancel
      action. Applying the Cancel deletes it. The next run does not create it again.
- [ ] Outside the fence, the run deletes a Planned order that loses its demand.
- [ ] An item `planningTimeFenceDays` wins over the location value in both directions,
      including an explicit 0.

### Phase 2a — actions, conversion and one number

- [ ] Each Planned and Firm order has one Order or Make action with `plannedOrderId` and
      the same quantity.
- [ ] Converting a Make order creates a Planned job through `insertJob` and
      `upsertJobMethod`. The order becomes Converted, and the action becomes Actioned.
      The next run counts the job once.
- [ ] Converting a Make order whose make method changed after the run shows the
      difference before the user confirms.
- [ ] Converting 3 Buy orders with the same supplier and location gives one Planned PO
      with 3 lines. A different location gives a second PO.
- [ ] A Defer action on a Firm planned order edits it and keeps it Firm.
      `requiresManualAction` is false.
- [ ] For an item with a planned order, `quantityToOrder` in the grid equals the
      planned-order total. An item with no planned order still uses
      `calculate_quantity_to_order`.

### Phase 2a — identity, pegs and atomicity

- [ ] Two runs with unchanged inputs produce identical `plannedOrder` rows, ids
      included, and write no new peg rows.
- [ ] A failed run leaves the previous plan and pegs unchanged (fault-injection test).
- [ ] A common-segment peg has null `planningGroupId` and `projectId`. The
      planning-group tests stay green.
- [ ] `releaseDate` never falls on a closed day for the location.

### Phase 2b

- [ ] An SO line edit stamps `planningState` at once. Within the debounce window, a
      `planningRun` row exists with `trigger = 'event'` and the SO named in the reason.
- [ ] The cron still runs and records `trigger = 'cron'`.
- [ ] A job that the scheduler projects 1 week late, with an on-time due date, gets an
      Expedite action.
- [ ] Planned Make orders over one work center's hours in one week give exactly one
      capacity exception. The contributing orders get `capacityConstrained`. Adding a
      shift clears both on the next run.
- [ ] The what-if returns a promise date, the plan change, the capacity impact, the
      cost and the assumptions. It writes nothing (row counts are identical before and
      after). The quote panel renders the assumptions word for word.
- [ ] With the worklist open, a run that changes 5 rows changes no visible row. The
      banner appears. A batch convert with 2 drifted rows converts 10 and reports 2.
- [ ] An item on the default lead time gives `lowConfidence` actions with a note. They
      are absent from the default filter and the digest.
- [ ] A production user without purchasing rights converts a mixed chain. The Make
      orders convert, the Buy orders become Firm, and purchasing gets the notification.

### Phase 2c

- [ ] With dry run on, an auto-convert workflow logs Skipped and creates nothing. With
      dry run off and a cap of 2, a run with 5 matches converts 2 and queues 3. Pause
      stops the operation.
- [ ] `pnpm run check:workflow-catalog` is green.
- [ ] The digest reaches the planner. Low-confidence actions never notify.
- [ ] The agent answers "why is there a planned order for ANT-PATCH-01?" from the pegs
      and trace. The agent refuses a write tool call.
- [ ] A steady history gives the hand-computed 13-week average. A history with CV above
      0.8 gives the refusal and the sparkline.

### Gates (every part)

- [ ] `pnpm --filter @carbon/planning test`, `pnpm --filter @carbon/utils test` and
      `pnpm --filter @carbon/ee test` are green.
- [ ] The scoped ERP and jobs typecheck is green. `pnpm run generate:types` output is
      committed.
- [ ] `pnpm db:check:datasets` and `pnpm db:check:backups` pass.
- [ ] Browser check on the satellite dataset for the part's UI.
- [ ] The glossary has "Planned Order", "Firm" (with the Dynamics 365 note) and
      "Convert".

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Planned and Planned job read as the same thing | Med | The Terms table, the glossary entries, and status chips that say "Planned order" in full on the worklist. |
| Regeneration churns near-term orders | Med-High | The fence holds them. 2b adds the stable worklist and the change banner. |
| Peg volume grows with every run | Med | `diffPegs` supersedes only changed pegs. An unchanged run writes nothing. |
| `projectPeg` changes break planning groups | Med | The CHECK keeps the group rule. The planning-group tests run in the 2a gate. |
| Lot-sizing drift between TS and SQL | Med | One TS function and the parity test. §2a.8 shrinks the SQL path to no-plan rows. |
| The plan and the converted job disagree | Med | Scrap uses the job rule. Convert shows the make-method difference. |
| Row count grows (every level of every item) | Med | Default filters, paging, and the natural key reuses rows. |
| MRP and the scheduler fight over job dates (2b) | Med-High | MRP recommends only. Job date changes go through `updateJob` and `notifyScheduleInputsChanged`. A loop test covers it. |
| MRP output depends on scheduler freshness (2b) | Med | Fall back to the due date. The scheduler's own wave and nightly replan keep projections fresh. |
| Confidence gating hides a real problem (2b) | Med | Nothing is deleted. "All messages" shows every action. The readiness panel drives the fix. |
| Capable-to-promise read as a guarantee (2b) | Med | The assumptions are part of the result. The label says "plan-based" everywhere. |
| Automation misfires (2c) | Med | Dry run on by default, a cap, a pause and a daily ledger. |
| Workflow and regeneration feed each other (2c) | Med | Converted rows never regenerate. The watch list excludes regenerated flags. A loop test converges in one cycle. |
| Removing `supplyForecast` breaks the grid mid-change | Med | Land `plannedOrder`, the engine and the grid read first. Remove the `supplyForecast` writes last, in the same PR series. |

## Deferred

Each item below is out of Phase 2. Pick one up as its own spec or as a later phase.
"Depends on" names the part that must ship first.

| # | Item | Why deferred | Depends on | Start from |
|---|------|--------------|------------|------------|
| D1 | **Scenario planning.** Saved, named scenarios that change the inputs (demand +20%, quotes as won, a supplier 2 weeks late, an added shift, a new lead time). Each scenario runs MRP and rough-cut capacity on its own copy. The UI compares it with the live plan (extra orders, cost, overloaded weeks, late sales orders). An optional step applies the scenario to the live plan. | Phase 2b's one-line what-if covers the urgent question. Saved scenarios need their own data model and research. | 2b (what-if and rough-cut capacity) | Research SAP pMRP simulation, Dynamics 365 multiple master plans and Oracle plan copies. Reuse `planCompany` (pure) with changed inputs. Follow the scenario rules in `.ai/specs/implemented/2026-08-12-forecast-first-finite-scheduling.md` §7. |
| D2 | **Scenario finite scheduling.** Run the planned orders through the full finite scheduler, stored under `capacityReservation.scenarioId`. | Rough-cut capacity is the Phase 2 answer. | 2b, and D1 for the scenario model | `capacityReservation.scenarioId` (reserved, unused). The bracket scenarios in the finite-scheduling spec §7. |
| D3 | **Partial conversion** of a planned order. | Editing the quantity before Convert covers it. | 2a | SAP partial conversion: the remainder stays Firm with its dependent demand (`.ai/research/mrp-v2-phase-2-planned-orders.md`). |
| D4 | **A per-component "plan in common" switch** under a project parent. | `allowCommonSupplyForProjects` covers drawing common surplus. Planning a component in the common segment is a new rule. | 2a | SAP collective requirements on the BOM item; Oracle "Allow Use of Common Supplies"; Dynamics 365 BOM line types (research file, pattern 8). |
| D5 | **Planned transfers** between locations. | Multi-location netting is its own design. | 2a | `'Transfer'` is reserved in `plannedOrderType`. `warehouseTransfer` is the conversion target. |
| D6 | **A demand time fence.** Inside it, MRP ignores forecast and counts only real orders. | Forecast consumption covers most of the need. | 2a | Oracle and NetSuite demand fences (research file, question 3). |
| D7 | **Statistical forecasting** beyond the trailing average (seasonality, Croston for irregular demand). | The 2c average and its refusal come first. | 2c | `getSuggestedDemandProjection` and its CV refusal. |
| D8 | **A unified make and buy plan page.** | Two cross-linked pages work for Phase 2. | 2b (cascade tree) | The two planning routes and the cascade tree. |
| D9 | **Retiring the SQL grid** (`calculate_quantity_to_order` and the week-column RPCs). | §2a.8 already limits it to items with no planned order. | 2a and 2b, in use for a while | §2a.8. Remove the SQL twin and its parity test together. |

## Open Questions

> All resolved. The record below gives the current answer to each question.

- [x] **Materialize on plan or on conversion?** — A true planned-order layer. A real job
      or PO exists only after Convert. Planned orders are disposable.
- [x] **Buy planned orders?** — Yes. Pegging needs them.
- [x] **One plan page or two?** — Two, cross-linked in the cascade tree (2b).
- [x] **Retire the SQL grid?** — No. It fills only items with no planned order.
- [x] **Can a Firm order be edited?** — Yes. Firm means "a person owns this order".
- [x] **Split Phase 2?** — Yes: 2a, 2b, 2c, as in the table at the top.
- [x] **Reuse Phase 1 code or write new functions?** — Reuse `computePlanningOrders`,
      `deriveChangeActions`, `planningAction`, `projectPeg` and
      `runQuoteLeadTimeWhatIf`.
- [x] **Store fence firming or compute it?** — Compute it on each run. Only a person
      firms an order.
- [x] **A new need inside the fence?** — Plan it at the fence end and raise Expedite.
- [x] **A fence-held order with no demand?** — Keep it and raise Cancel.
- [x] **Components at conversion?** — Read the make method again and show a difference.
- [x] **Where do pegs live?** — In `projectPeg`, extended.
- [x] **A demand time fence?** — Not in Phase 2.
- [x] **Scrap in planned orders?** — Yes, with the `computeJobQuantities` rule.
- [x] **The word for planned order → document?** — Convert. Release stays the Phase 1
      action on a Planned job or PO.
- [x] **Which date does the fence test?** — The release date, in working days.
- [x] **Action messages on real open jobs and POs?** — Yes, through the Phase 1
      `deriveChangeActions`.
- [x] **Live replanning or cron only?** — Live in 2b. The cron stays as backstop.
- [x] **Open-job supply at the due date or the projected finish?** — The projected
      finish in 2b, else the due date.
- [x] **Capacity: none, rough-cut or finite?** — Rough-cut in 2b. Finite scenario
      scheduling is deferred.
- [x] **Capable-to-promise?** — Yes, in 2b, on `runQuoteLeadTimeWhatIf`.
- [x] **Delete-and-recreate or diff-write?** — Diff-write on a natural key.
- [x] **Transfer orders?** — Reserve the enum value. Generate nothing.
- [x] **Date math?** — Working days over the location calendar.
- [x] **Explainability?** — Trace and pegs in 2a. Change banner in 2b. Agent in 2c.
- [x] **Workflow integration?** — 2c, inside the automation rails.
- [x] **Suggested demand projections?** — 2c, with the irregular-demand refusal.
- [x] **Period of Supply lot-sizing?** — 2c, TS only.
- [x] **Does the review lifecycle slow the old one-click flow?** — No. The row button
      still says Make or Order and converts in one click.
- [x] **Does the live plan move under the planner?** — No. 2b uses a banner and an
      explicit Refresh.
- [x] **How do we avoid a wall of red on day one?** — 2b confidence gating and the
      readiness panel.
- [x] **Capacity per order or per bucket?** — Per (work center, week) bucket.
- [x] **Automation blast radius?** — 2c pause, dry run (on by default), cap and ledger.
- [x] **A chain that crosses the make/buy permission boundary?** — Firm the chain,
      convert the permitted side, notify the other team (2b).
- [x] **Two numbers during the debounce window?** — 2a: the grid reads the planned
      order. 2b: one "Plan updating…" indicator.
- [x] **Capable-to-promise over-trust?** — The assumptions are part of the result.

## Changelog

- 2026-08-22: Created; all open questions resolved with Brad (recommendations
  accepted).
- 2026-08-22: Reconsidered against research (`.ai/research/mrp-v2-planner-ui.md`, 8
  systems + APICS). Adopted standard terminology; expanded the action-message model;
  added planning-time-fence/auto-firm and `suggestedDate`/`reviewedAt`; reframed the
  UI to the SMB dated-decision worklist with the six-row matrix as drill-down;
  documented soft-vs-hard pegging and "quantity without source".
- 2026-08-22: Renamed `real-mrp` → `mrp-v2`. Scoped to **robust v1** per Brad —
  pulled every deferral into v1 (time fence, open-order action messages, POQ,
  worklist QoL).
- 2026-08-22: **Game-changer rewrite** (Brad: "build these in v1"). Added the five
  differentiators to v1: continuous event-driven regen (+ `planningRun`),
  capacity-honest netting (`projectedCompletionAt`) + rough-cut capacity,
  `runPlanningWhatIf`/CTP, self-explaining plan (trace, diff-write identity + diff
  banner, agent data tools), programmable release (workflow entity/moment/operations,
  `PlanningExceptions` digest). Fixed from the code review: `jobId` peg source,
  `'Transfer'` reserved, working-day date math, `splitIndex` + partial-unique natural
  key, suggested demand projections. Updated all file references to the
  `@carbon/planning` extraction. Added the **Deferred** list.
- 2026-08-22: **Calm-by-default layer** (Brad: "implement the annoyance fixes").
  New §9 + supporting schema: one-click Release with warnings-only draft
  interposition and plain-language Firm prompt (`firmedBy`/`firmedAt`);
  no-revalidation worklist with `planningState` (new table) + `planningRun` banner
  and per-row optimistic concurrency; confidence-gated exceptions
  (`lowConfidence`/`confidenceNote`) + planning readiness panel; bucket-attributed
  capacity (dropped `'Overload'` from `plannedOrderException`, added
  `capacityConstrained`); orphaned-firm Cancel + return-to-planning sweep; autopilot
  rails (`companySettings` pause/dry-run/cap, dry-run default ON, autopilot ledger);
  cross-permission cascade handoff (`PlannedOrdersAwaitingRelease`); plan/grid
  number coherence (§9h); suggestion CV gate; CTP assumption list in the API result.
  Expanded acceptance criteria ("Calm & control" group) and risks accordingly.
- 2026-08-22: **Time fence placement revised** (Brad): the fence lives on
  `itemPlanning.planningTimeFenceDays` (per-item/location override, NULL = inherit)
  with `location.planningTimeFenceDays` as the plant default — SAP/Oracle/Dynamics
  all fence per item, and `itemPlanning` already owns the planning-behavior fields
  (`reorderingPolicy`, accumulation/rescheduling periods).
- 2026-09-08: **Re-scoped into phases** (Brad). The single "game-changer v1" is split
  so the 80/20 slice ships first. Added **§P1 — Phase 1: Planning Action Messages &
  Buyer/Planner Assignment**: a focused persisted `planningAction` table (enums
  `planningActionType` = Order/Make/Expedite/Defer/Cancel/Increase/Decrease,
  `planningActionStatus`), a unified `responsibleEmployee` inheritance ladder
  (item → item-group → location → company; new columns on `itemPlanning`,
  `itemPostingGroup`, `location`, `companySettings`) with per-row assignee override, a
  single `companySettings.rescheduleToleranceDays` (default 7) noise gate, diff-write
  regen, commitment-gated apply (auto-apply on uncommitted supply, "Review on
  document" on sent POs / released jobs), the two existing planning pages extended
  with a "my actions" worklist, and one printer-style ownership settings screen. All
  Phase-1 open questions resolved with Brad (§P1.11). The prior "game-changer v1"
  (planned-order cascade + Planned→Firm→Released lifecycle, pegging, continuous regen,
  rough-cut capacity, what-if/CTP, self-explaining plan, programmable release, §9
  calm-by-default) is retained below as **Phases 2+**, deferred. Research:
  `.ai/research/mrp-planning-actions.md`; run record:
  `.ai/runs/2026-09-08-mrp-planning-actions.md`.
- 2026-09-09: **Ladder refinement** (Brad): the item-group tier is now
  **location-specific** — the tree is **all → location → item group** (per-item leaf +
  per-message assignee still on top). Item-group ownership moves off a column on
  `itemPostingGroup` into a sparse `itemPostingGroupResponsibility` table keyed
  `(companyId, locationId, itemPostingGroupId)`, mirroring the printer AssignmentsCard
  inheritance tree. Updated §P1.2 (data model), §P1.3 (resolver), §P1.8, §P1.11.
- 2026-09-11: **CodeRabbit review round (PR #1601) folded in.** Generation runs in its
  own atomic transaction after Phase-7 and failures **propagate** (no swallow); **one
  action per target** precedence (Cancel → Expedite/Defer → Increase/Decrease); vanished
  **Dismissed** rows are deleted (retired) so the natural key can't block a returning
  need; tolerance boundary fixed as strictly `>` with `CHECK (>= 0)` + 0–365 validation;
  commitment gate keys on `isPurchaseOrderLocked(status)` only (NOT `orderDate`, which
  defaults to today on insert); apply **binds to the persisted action** by id+companyId
  with `status='Open'` (IDOR guard); job Expedite/Defer = `updateJob({dueDate})` +
  `notifyScheduleInputsChanged("reorder")`, never operation-date writes;
  `itemPostingGroup` needs `UNIQUE ("id","companyId")` before the responsibility FK
  (verified: PK is `("id")` alone); explicit `ENABLE ROW LEVEL SECURITY` on
  `itemPostingGroupResponsibility`; scheduled runs' `userId: "system"` is a real seeded
  user row (`20230123004317_companies-rls.sql`).

- **2026-09-11**: `demandProjection` now DOES gain a column — `consumedQuantity`
  (forecast consumption, migration `20261006130001`), superseding this spec's
  "demandProjection gains no columns" scope note (§ suggested projections, ~line
  1230; that section's own scope is unchanged — suggestions still write ordinary
  rows). Design + rationale: `.ai/specs/implemented/2026-09-11-demand-forecast-consumption.md`.
- **2026-10-04**: Phase 1 (§P1, planning action messages + responsible-employee
  assignment) implemented on `mrp-action-suggestions` (PR #1601; plan
  `.ai/plans/2026-09-08-mrp-planning-actions.md` 12/12). The same branch also ships the
  planning horizon / time fence (`.ai/plans/2026-10-01-planning-horizon.md`) and a
  company-chosen daily MRP run time. Phases 2+ are unchanged and not started, so this
  spec stays out of `implemented/`.
- **2026-11-14**: Phase 2 rewritten from `.ai/research/mrp-v2-phase-2-planned-orders.md`
  and the code on `main`. Split into 2a/2b/2c. Decisions: reuse `computePlanningOrders`,
  `deriveChangeActions`, `planningAction`, `projectPeg` and `runQuoteLeadTimeWhatIf`;
  fence firming computed per run (no `firmedBy='system'`, no orphan sweep); new need
  inside the fence planned at the fence end with Expedite; "Convert" replaces "Release"
  for planned order → document; conversion reads the make method again; scrap with the
  `computeJobQuantities` rule; netting segments, Consume First, configured BOMs and
  Phase 1 sizing rules respected; no demand time fence.
