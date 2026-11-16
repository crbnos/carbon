# MRP v2: Planned-Order MRP — Generation, Cascade, Capacity & Simulation

> Status: **Phase 1 implemented** (PR #1601). **Phase 2a implemented** on the MRP v2
> Phase 2a PR. 4 parts moved to 2b (§2b.7). Phases 2b and 2c are designed and not
> started.
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
>   cascade, lot-sized explosion, Firm, the time fence and Convert (2a). Then pegging,
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
| Reorder-sizing home | **Pure TS function shared by engine + client** (four existing policies) | The engine must produce the Order/Make quantity the grid shows; today the logic is duplicated in SQL (`calculate_quantity_to_order`) + client (`calculateOrders`). Phase 2a sizes the planned orders with `sizeRowSupply`, the row sizing of the worklist, which calls `computePlanningOrders`; POQ is Phase 2c. |
| UI | **Extend the two existing planning pages** + one printer-style settings screen | Copy precedent; no new module. |

## P1.9 Relationship to the Phase 2 planned-order model

Phase 1 is forward-compatible with the `plannedOrder` design below:

- Phase 2 adds no action types. It reuses `planningActionType` (§2a.5).
- Phase 2a adds `plannedOrderId` to `planningAction`. Only a change action on a Firm
  or fence-held planned order sets it. An Order or Make action names no planned order.
  An order placed against it converts the planned orders of its week. The assignment
  ladder, worklist, filters and apply flow of Phase 1 stay unchanged.
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
> | **2a** | `plannedOrder` in the common segment, buffer-policy cascade, lot-sized explosion with scrap, Firm, time fence, Convert, one Order / Make number on the worklist and the drawer | Built. 4 parts moved to 2b. |
> | **2b** | The 4 parts moved from 2a (pegging, the `supplyForecast` replacement, planned orders in the grid SQL, working-day dates), live replanning, open jobs dated at the scheduler's projected finish, rough-cut capacity, capable-to-promise, the cascade tree and time-phased matrix, the calm worklist | Designed. Starts after 2a. |
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
| **Fence-held** | A Planned order whose release date falls inside the planning time fence. MRP treats it like a Firm order for the run. Nothing stores this state. MRP computes it on each run. |
| **Held** | A Firm or a fence-held planned order. MRP keeps its quantity and dates and counts it as fixed supply. |
| **Convert** | Create the Planned job or Planned PO line from a planned order. SAP uses the same word. |
| **Release** | The existing Phase 1 action: move a Planned job or Planned PO to its next status. Phase 2 does not change it. |
| **Lot-sized quantity** | The order quantity after the item's reorder policy and order rules round the net requirement. |
| **Explosion quantity** | The lot-sized quantity plus the item's scrap allowance. MRP explodes this quantity to the components. |
| **Netting segment** | `planningSegmentId`: `''` for common stock, a project id, or a planning-group id. |
| **Peg** | A `projectPeg` row: it links one piece of supply to the demand it covers. Planned-order pegs are 2b. |

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
still. In 2a, planned orders exist only in the common segment, for the items that are
rows of the planning grid.

Phases 2b and 2c build on this layer. 2b pegs every planned order to the demand it
covers, so the planner can see why it exists. 2b also makes the plan live and
capacity-aware. 2c makes it programmable.

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
| **Black-box distrust.** A suggestion with no derivation gets ignored. | 2a: the lot-sizing trace. 2b: pegs and the change banner. 2c: the agent. |
| **Exception fatigue on dirty inputs.** Defaulted lead times and stale POs flood the worklist. | 2b: confidence-gated actions and the readiness panel. |

Carbon is the only surveyed system whose MRP and finite scheduler share one process,
one language and one package (`@carbon/planning`). Phase 2b uses that.

## Proposed Solution — Phase 2a

> **Status: implemented** on the MRP v2 Phase 2a PR (plan
> `.ai/plans/2026-11-14-mrp-v2-phase-2a.md`). This part describes the code as built.
>
> 4 parts of the first 2a design moved to 2b (agreed 2026-11-14). §2b.7 holds them:
>
> 1. Pegging through `projectPeg`.
> 2. The replacement of `supplyForecast`. The `planning.update` routes still write it,
>    and MRP still deletes it.
> 3. Quantity changes in the grid SQL functions. Only the Actions filter changed (§2a.8).
> 4. Working-day dates. In 2a the dates and the time fence count calendar days, as
>    Phase 1 does.

### 2a.1 The engine sweep

MRP still plans each (location, segment, item) once, in low-level-code order, in the
level loop of `explodeBom`. The cycle break stays: MRP plans cycle members last, as
leaves.

2a adds optional inputs to `explodeBom` (`packages/database/src/mrp-engine.ts`):

| Input | Purpose |
|-------|---------|
| `planSupply` | The hook. It plans the new supply of one common key. `explodeBom` calls it once per key, when the gross demand of the key is complete. If it returns null, the key runs the Phase 1 path. |
| `extraPlanningKeys` | Common keys that the level loop visits even with no gross demand. |
| `scrapRateByItem` | The scrap rate of each child, for a planned explosion. |

Without these inputs, `explodeBom` behaves as in Phase 1.

`planCompany` builds the hook with `createPlanSupply`
(`packages/planning/src/mrp/planned-orders.ts`) when it gets `plannedOrderInputs`.
`runMrp` always passes them. Without them, `planCompany` plans as in Phase 1. The golden
test runs without them, and its snapshot did not change.

For each eligible common key (§2a.2), the hook does these steps:

1. Build the projection: on-hand plus open supply plus held planned orders, less gross
   demand. It is cumulative per week and not floored.
2. Add the held planned orders (§2a.4) to the open jobs and PO lines of the key. Each
   one carries its `plannedOrderId`.
3. Size the key with `sizeRowSupply` (`row-sizing.ts`). This is the sizing of the
   worklist, moved out of `deriveRowActions` with no change of behavior.
4. Keep each change action that targets a held planned order.
5. Move each new Order or Make that starts inside the time fence to the fence end
   (§2a.4).
6. Record each new Order or Make as a planned order, with its natural key, its trace
   and its split index.
7. For a Make key, return the explosions. Each new planned order, each held Make order,
   and each Increase on a job or a Make planned order gives one.

Then `explodeBom` explodes each explosion to the children of the key:

- **Quantity.** The explosion quantity is the lot-sized quantity plus the scrap of the
  parent (`scrapAllowance`: whole units, rounded up, from
  `itemReplenishment.scrapPercentage`). A child gets `child.quantity × explosion
  quantity`, plus its own scrap. A Make to Order child that is made adds no scrap,
  because its own job adds it.
- **Date.** The child demand goes into the release week of the planned order: the week
  that holds its release date. Phase 1 moved child demand earlier by the lead time of
  the child. A planned order already carries the lead time in its dates.
- **Contributors.** The children take the demand contributors of the week that MRP
  sized the order for, scaled by the BOM quantity. Each BOM line takes them once per
  week.
- **Balance.** The running balance of the key stays as in Phase 1. Planned supply never
  enters it, so the common surplus that a project segment can draw does not change.

A Buy planned order carries no scrap and explodes nothing. A "Buy and Make" item plans
purchases, as in Phase 1.

The raw-need path adds scrap too in an MRP run, because `runMrp` always passes
`scrapRateByItem`. This path serves every Make key with no planned order, for example
the project and planning-group segments and the Make to Order children. The rules are
the same as for job creation (`computeJobQuantities`):

1. The parent explodes its net requirement plus its own scrap.
2. Each child adds its own scrap.
3. A Make to Order child that is made adds no scrap there. It adds its scrap when its
   own net requirement explodes.

Before this change, a part under a Make to Order subassembly was short by the scrap
of the subassembly. The scrap rates come from `itemReplenishment.scrapPercentage` of
the items that have an `itemPlanning` row. Every other item has the rate 0. Without
`scrapRateByItem`, `explodeBom` adds no scrap.

Rules:

- **Explode the explosion quantity.** This is the core fix. It follows SAP and
  Dynamics 365: lot-size first, then explode.
- **Buffer needs join at the item's own level.** `extraPlanningKeys` holds each eligible
  key with a reorder point above 0 on Fixed Reorder Quantity or Maximum Quantity. These
  are the stock-driven rows of the planning RPCs. It also holds each key with a held
  planned order, so a held order with no demand still explodes and gets its Cancel.
  Demand-Based Reorder safety stock sizes an order only for a key with demand or
  supply, as the RPC row does.
- **Surplus is stock.** If an order of 5 covers a need of 3, the 2 extra units are
  projected stock for the next weeks.
- **One sizing function.** The engine and the worklist both call `sizeRowSupply`. The
  Phase 1 sizing rules stay: batch size, order multiple, `maximumPerOrder`, frozen
  orders (`isOrderFrozen`), and per-batch dating for Demand-Based Reorder (#1912). The
  SQL `calculate_quantity_to_order` does not change.
- **A planned order is never frozen.** `isOrderFrozen` returns false for an open order
  with a `plannedOrderId`. No document exists, so nothing is in production or on the
  way. A Firm order due inside its lead time therefore still gets an Expedite or an
  Increase.
- **Dates are calendar days.** The release date is the due date less the lead time in
  calendar days (the `latestOrderDate` of the sizing). Working days move to 2b (§2b.7).
- **Open-job supply keeps its current date.** `jobCompletionDate` (`supply-date.ts`)
  does not change until 2b.
- **Horizon.** The engine plans 72 weeks (`WEEKS_TO_FORECAST`). The worklist reads 48
  weeks (`WEEKS_TO_PLAN`). The Risks table records the gap.

### 2a.2 Which items get planned orders

A key gets planned orders only when the planning worklist has a row that sizes new
supply for it. Each condition below must be true (`eligibleOf` in `planned-orders.ts`):

| Condition | Source |
|-----------|--------|
| The segment is common (`planningSegmentId = ''`). | The hook returns null for every other segment. |
| The item has an `itemPlanning` row at the location. | `runMrp` reads `itemPlanning` ⋈ `item` ⋈ `itemReplenishment` with inner joins, as the RPCs do. |
| The item is active and not Non-Inventory. | `item.active`, `item.itemTrackingType` |
| The replenishment is Make (production) or Buy / Buy and Make (purchasing). | `item.replenishmentSystem` |
| The item has no supersession row. | the `supersessions` input of `planCompany` |
| No BOM line builds the item as Make to Order while the item is Make. | `inlineProductionItemIds` (`plan-company.ts`) |
| The item has no Consume First redirect. | `explodeBom` calls the hook only for a key with no redirect. |

Every other key keeps the Phase 1 path, unchanged:

- **Project and planning-group segments** stay lot-for-lot (`deriveRowActions`) and
  explode the raw need. The common-surplus draws do not change.
- **Superseded items** keep the Phase 1 supersession and Consume First paths.
- **Make to Order children** get no planned order. Their demand passes through to
  their own children. Job creation spawns their subjob when the parent converts. SAP
  and NetSuite treat a phantom the same way.
- **Configured BOMs.** Both paths read children through `bomChildren`, so a quantity-0
  configuration line never explodes.

The Deferred table (D10) lists planned orders for these keys as later work.

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
  a change action on the order (§2a.5). `firmedBy` and `firmedAt` hold the user and the
  time. The CHECK `plannedOrder_firm_chk` allows `firmedBy` only on a Firm row. A
  manual edit of the quantity or the due date firms the order, as in SAP.
- **Unfirm.** The order becomes Planned again, with no firm stamp. If MRP planned
  another Planned order on the same natural key in the meantime, the row takes the next
  free `splitIndex` of its week. The next run then deletes it, unless the fence holds
  it.
- **Converted.** The Planned job or Planned PO line exists. `jobId` or
  `purchaseOrderLineId` points at it. Conversion clears `firmedBy` and `firmedAt`. MRP reads the document as supply and never touches the row again. A
  Converted row goes with its job or PO line (`ON DELETE CASCADE`).

Only a person firms an order. The drawer does not ask the user to learn "Firm" first.
If a planner edits the quantity or the due date of a Planned order, the drawer asks
once: *"Keep your numbers through plan updates?"* Yes saves the edit, and the edit
firms the order. The status chip then says "Firm".

### 2a.4 The planning time fence

The fence keeps near-term orders still. It is a number of calendar days from today:

```sql
ALTER TABLE "location"     ADD COLUMN "planningTimeFenceDays" INTEGER NOT NULL DEFAULT 0
  CHECK ("planningTimeFenceDays" >= 0);
ALTER TABLE "itemPlanning" ADD COLUMN "planningTimeFenceDays" INTEGER
  CHECK ("planningTimeFenceDays" IS NULL OR "planningTimeFenceDays" >= 0);  -- NULL = use the location's value
```

MRP resolves the fence per item and location: the item value, else the location value,
else 0. `0` means no fence. An explicit item `0` takes a volatile item out of a
location-wide fence. SAP, Oracle and Dynamics 365 all set the fence per item. The
fence is not `planningHorizonDays`, which is a display filter
(`20261006130004_planning-horizon.sql`).

One rule in `@carbon/utils` (`planning-time-fence.ts`) gives the fence days
(`resolvePlanningTimeFenceDays`) and the hold (`isPlannedOrderHeld`). The engine and the
drawer both call it, so the "Fence" marker always shows what MRP holds.

A planned order is **held** in a run when one of these is true:

1. Its status is Firm.
2. Its status is Planned, the fence is above 0, and its release date is on or before
   today + the fence days.

A held order keeps its quantity and dates and counts as fixed supply. A held Make order
still explodes. A held order is also part of the Order or Make of its week, so a person
can convert it (§2a.5). Nothing stores the hold of a Planned order. MRP computes it again on
each run, as SAP does with fence firming. The drawer marks a held Planned order with
"Fence".

Inside the fence:

1. **A new need creates an order at the fence end.** If a new Order or Make would start
   before today + the fence days, MRP moves its release date to that day. It moves the
   due date by the same number of days, and the order goes to the week that holds the
   new due date. The worklist raises an Expedite on the planned order, to the date of
   the real need. The Expedite date is never earlier than today. This is SAP firming
   type 1.
2. **A held order with no demand stays.** MRP raises a Cancel on it. It does not delete
   the order silently, because someone may already have bought parts for it. Applying
   the Cancel deletes the order.

An order that MRP moved to the fence end is held on the next run, because its release
date is then inside the fence. Because the fence is computed, a fence-held order cannot
outlive its demand without a visible Cancel action. No cleanup sweep is necessary.

### 2a.5 Planning actions over planned orders

2a reuses the Phase 1 worklist (`planningAction`). It adds no action types.

| Action | 2a source | Applying it |
|--------|-----------|-------------|
| **Order** / **Make** | The planned orders of the row that are still to convert (`newSupplyByRow`), summed per week as in Phase 1. These are the new planned orders and the held planned orders that MRP does not cancel. The action names no planned order. It covers every planned order of its week. | Creates the Planned jobs or PO lines and converts the planned orders that they stand for (§2a.7). |
| **Expedite** / **Defer** / **Increase** / **Decrease** / **Cancel** on an open job or PO line | `deriveChangeActions`, as in Phase 1. | As in Phase 1. |
| **Expedite** / **Defer** / **Increase** / **Decrease** / **Cancel** on a held planned order | `sizeRowSupply`, with the held order as an open order. `plannedOrderId` names it. | Edits the planned order, and the edit firms it. Cancel deletes it. Never `requiresManualAction`. |
| **Expedite** on a planned order that the fence moved | The fence signal (§2a.4). | Moves the due date and the release date, and firms the order. |
| **Release**, **Transfer**, **Borrow** | Unchanged. A planned order gets no Release. | Unchanged. |

Rules:

- Only a change action on a planned order carries `plannedOrderId`. The CHECK
  `planningAction_change_target_chk` refuses a target on an Order or Make.
- Each planned order gets one change action at most. Cancel wins, then Expedite or
  Defer, then Increase or Decrease (`onePerPlannedOrder`).
- MRP raises a change action on a planned order even when the item has no planning RPC
  row in the run (`plannedOrderActions`).
- The worklist takes the Order or Make of a row from its planned orders only when the
  engine planned the row. The worklist sizes every other row from its RPC row, as in
  Phase 1.
- Each engine Order or Make candidate stands for one planned order. A held one names
  its `plannedOrderId`. A new one gets its id from `withPlannedOrderIds` after the
  write. The worklist drops the id when it sums the candidates into the stored action.
- A held order adds no new order. Sizing already counted it as supply. It joins the
  Order or Make of its week with its own quantity and dates, and with the policy of its
  stored `quantityTrace`.
- The owner ladder, the tolerance gate (`rescheduleToleranceDays`) and the read-time
  horizon apply unchanged. The frozen-order rule applies to jobs and PO lines only
  (§2a.1).

So the Order or Make quantity of a week equals the total of its planned orders that are
still to convert. The row's Order / Make button, the drawer and the worklist show one
number.

### 2a.6 Persistence and regeneration

`plannedOrder` is the durable output of the sweep. A Planned row is unique on its
natural key `(companyId, itemId, locationId, planningSegmentId, orderType, periodId,
splitIndex)`, through the partial index `plannedOrder_natural_key_idx`
(`WHERE "status" = 'Planned'`). `periodId` is the week of the due date. `splitIndex`
numbers the new orders of one type in one week, by due date and then quantity. It skips
the indexes of held Planned rows.

Each attempt of a run reads the planned orders before all other inputs
(`loadPlannedOrderSnapshot` in `mrp.ts`). The snapshot holds the database clock `now()`
and the id, status and `updatedAt` of each Planned and Firm row.

The Phase 7 transaction of `runMrp` calls `writePlannedOrderDiff`
(`planned-order-write.ts`) as its first statement:

1. Take the company planning lock (below).
2. Compare the planned orders with the snapshot (`plannedOrdersChangedSince`). If a
   person or another run changed them, throw `PlannedOrdersChangedError` before any
   write.
3. Read the Planned rows of the company at the planned locations.
4. If a generated order matches a Planned row on the natural key, update the row only
   when a value changed. The id and `createdAt` stay.
5. Insert each generated order that matches no row.
6. Delete each Planned row that matches no generated order, unless it is held.
7. Leave Firm, Converted and held rows alone. Each DELETE and UPDATE checks
   `status = 'Planned'` on the row again.
8. Return the id of each natural key, for the worklist.

Step 2 finds these changes with no clock compare in TypeScript:

| Change | What step 2 sees |
|--------|------------------|
| Firm, unfirm, edit | A different `updatedAt` or status on a loaded row |
| Convert | A loaded row that is no longer Planned or Firm |
| Cancel | A loaded id that is gone |
| An insert by another run | A row created after the snapshot `now()` |

The error rolls back the Phase 7 transaction. `retryOnPlannedOrderChange` then reads,
plans and writes again, after a random pause of up to 250 ms. After 5 attempts
(`MAX_PLAN_ATTEMPTS`) the run fails with the message "Run MRP again". It retries no
other error. No lock spans a whole run: a lock held on one connection while the run
worked on another hung a run on a one-connection pool. Without the check, a convert that
committed between the read and the write of a run was lost. The run planned the
converted week again, which gave a second Make.

The writes are set-based: one DELETE, one `UPDATE … FROM (VALUES …)` and one INSERT per
500 rows, each scoped by `companyId`. Two runs with the same inputs write nothing the
second time, so the ids stay.

The same transaction still writes `demandForecast` and the actuals. If the run fails,
the previous plan stays. `generatePlanningActions` runs after the commit, in its own
transaction, as in Phase 1.

**The planning lock.** Each writer of planned orders or planning actions first takes
`pg_advisory_xact_lock(hashtextextended('planning-actions:<companyId>', 0))`. One
helper holds it: `lockCompanyPlanning` in `@carbon/database/planning-lock`. The
planning package and the ERP both import it, so no writer can use another key.

| Writer | Where |
|--------|-------|
| The planned-order write of a run | `writePlannedOrderDiff` |
| The worklist write | `generatePlanningActions` |
| The settle and the convert | `settleNewSupplyPlanningActions` (`production.service.ts`) |
| Firm, unfirm, edit, and apply on a planned order | `firmPlannedOrder`, `unfirmPlannedOrder`, `updatePlannedOrders`, `applyPlannedOrderPlanningActions` (`production.service.ts`) |

The lock puts the writes in a sequence. The run reads its inputs before it takes the
lock. So a change by a person after that read does not get lost: step 2 sees it, and
the run plans again.

`supplyForecast` stays in 2a. The `planning.update` routes still write it, and MRP
still deletes it in Phase 7. §2b.7 replaces it.

### 2a.7 Convert

An order placed against an Order or Make action converts the planned order that it
stands for. The row's Order / Make button and the drawer's button both place orders
through `orderPlannedJobs` or `orderPlannedPurchases`, as in Phase 1. 2a adds no
separate Convert button.

**Suggested orders.** In the common segment, the drawer offers one suggested order for
each unconverted planned order (Planned or Firm) of the action's week. Each suggested
order has the quantity, the dates and the `plannedOrderId` of its planned order. They
are in due-date order, then in `splitIndex` order. A week with no planned order splits
its action by its policy, as in Phase 1.

- The action of the current week (the first period of the page) also takes each
  overdue planned order (`plannedOrderWeekIndex`, `@carbon/utils`). MRP sizes an overdue
  order in the current week and sums it into that action. If an Open or Dismissed action
  of a past week is still on the row, that action keeps the overdue orders instead. The planned order keeps the week of its
  due date (`periodId`).
- The drawers get the planned orders from `DrawerPlannedOrders` (`onOrdersLoaded`). The
  drawer reads them again after an order is placed (`refreshKey`).
- A bulk Make or Order on rows that no drawer opened reads them with
  `getRowPlannedOrders` (`production.utils.ts`), 100 items per request.

**The steps.**

1. The order operation creates the Planned jobs (`insertJob`, then `upsertJobMethod`)
   or the PO lines, as in Phase 1. One PO per supplier per week collects the lines
   (`findPlanningPurchaseOrder`).
2. The operation sends each order with its `plannedOrderId`, and `asOf` = the
   location's today, to `settleNewSupplyPlanningActions`.
3. `settleNewSupplyPlanningActions` settles each action by the quantity ordered against
   it.
4. In the same transaction, under the planning lock, `convertPlannedOrdersForActions`
   reads the candidate planned orders `FOR UPDATE`.
5. The pure `matchPlannedOrdersToDocuments` gives each document its planned order (the
   rules below).
6. Each matched row becomes Converted, with its `jobId` or `purchaseOrderLineId`. A Firm
   row loses its firm stamp.
7. `convertPlannedOrdersForActions` deletes the Open and Dismissed change actions on
   each converted row. The job or PO line is the order now. MRP raises its actions on
   that document.

**The match rules.** No planned order converts twice.

1. If a document names its planned order, it converts that one. The row must still be
   Planned or Firm, with the same item, location and type. A stale id converts nothing.
2. Each other document takes a planned order of the week of the action that it settled,
   with the same item, location, segment and type. The current week (the period that
   holds `asOf`) also holds each overdue planned order.
3. In that week, a document first takes a planned order of equal quantity. A Planned
   order comes before a Firm order, then the lower `splitIndex` comes first.
4. A document with no equal quantity takes the next Planned order by `splitIndex`.

A Firm order converts only by its id or by an equal quantity. The Firm quantity is the
planner's number, so a smaller job never takes it.

If no document is left for a planned order, the order stays as it is. The next MRP run
sizes it again. Two orders merged into one PO line are two orders placed, so both
planned orders point at that line.

Job creation reads the make method of the item again. 2a shows no difference between
that method and the method that the run exploded (D11).

**Partial conversion is deferred** (D3). To convert part of an order, edit the
quantity first. The edit firms the order.

### 2a.8 One number on the planning pages

The grid SQL functions keep their quantities. `get_production_planning`,
`get_purchasing_planning` and `calculate_quantity_to_order` do not change. The grids
already show the Order / Make quantity as the sum of the open Order and Make actions
(`orderQuantity`). Those actions now come from the planned orders (§2a.5).

Migration `20261117063504_planning-grid-planned-order-actions.sql` makes the one SQL
change. It redefines `get_production_planning_grid` and `get_purchasing_planning_grid`.
Their Actions filter, their Assignee filter and their `latestOrderDate` now also count
an action on a planned order of the page's type. That type is Make for production and
Buy for purchasing. Before the change, an Actions filter hid a row whose only action
was on a planned order.

The base RPC column `quantityToOrder` changes in 2b (§2b.7).

### 2a.9 Pegging

Pegging moved to 2b (§2b.7). 2a writes no peg for a planned order.
`demandForecastSource` keeps the Phase 1 demand lineage.

### 2a.10 Explain the number

Each planned order stores its trace in `quantityTrace`: `{ policyName, triggerValues,
quantity, scrapQuantity, explosionQuantity }`. The Planned Orders grid of the drawer
shows it as one line in the quantity tooltip, for example *"Projected stock -3 → Fixed
Reorder Quantity 5 → scrap +1 → explode 6"*. The peg popover moves to 2b with the pegs.

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

### 2b.7 Parts moved from 2a

The 2a build moved 4 parts to 2b (agreed 2026-11-14). Each part keeps the design that
the first 2a spec gave it:

1. **Pegging.** Extend `projectPeg` for planned orders (below).
2. **Replace `supplyForecast`.** `plannedOrder` replaces `supplyForecast` on the
   planning path. The `planning.update` routes stop writing `supplyForecast`, and MRP
   drops its unconditional delete in Phase 7.
3. **The grid SQL reads planned orders.** `get_production_planning` and
   `get_purchasing_planning` read `plannedOrder` as the plan. For an item with a current
   planned order, `quantityToOrder` is the planned-order total.
   `calculate_quantity_to_order` fills only the items that have no planned order, for
   example an item that got demand after the last run.
4. **Working-day dates.** `releaseDate` uses the location calendar and the same day
   math as the need-by pass of the scheduler (`calendar-utils`). A Buy lead time stays
   in calendar days, and the release date moves back to the nearest working day. The
   time fence counts working days.

**Pegging design.** 2b extends the existing `projectPeg` table instead of adding a
second peg table.

- `planningGroupId` and `projectId` become nullable. A peg in the common segment has
  both null. A CHECK keeps the planning-group rules for pegs in a group segment.
- `projectPegSupplyType` gains `'Planned Order'`. `supplyId` holds the id of the
  planned order.
- `demandForecastSourceType` gains `'Planned Order'`. The peg of a component names its
  parent planned order as the demand. `parentPegId` links the chain up to the
  independent demand.
- A buffer need pegs to a demand source of type `'Reorder Policy'` (new enum value),
  with the `itemPlanning` row as `demandSourceId`.
- The table name stays `projectPeg`. The planning-group writer, the views, the RLS
  policies and the backup manifest all use that name. A rename adds risk and changes no
  behavior.
- The MRP writer supersedes only the pegs whose values changed, with the existing
  `diffPegs`. A run with no changes writes no peg rows. The common-segment writer lives
  in `@carbon/planning`. The planning-group logic stays in `@carbon/ee/pegging`.
- A lot-size surplus pegs to nothing. The drawer shows it as "quantity without source",
  the SAP term.
- A peg popover in the drawer answers "why does this exist?" (the demand it covers) and
  "what does it drive?" (its child planned orders).

Pegs are soft: one supply can serve many demands. A Make to Order job linked to a sales
order line stays the hard-peg case, as today.

Data model for these parts:

1. Make `projectPeg.planningGroupId` and `projectPeg.projectId` nullable. Add a CHECK:
   both are null, or `planningGroupId` is set.
2. Add `'Planned Order'` to `projectPegSupplyType`. Add `'Planned Order'` and
   `'Reorder Policy'` to `demandForecastSourceType`. Put each `ALTER TYPE ... ADD VALUE`
   in its own migration, before the migration that uses the value.
3. Redefine each view that reads `projectPeg` with `SELECT *`, so it picks up the
   changed columns.

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
SQL twin, because the grid SQL reads planned orders from 2b (§2b.7).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Phasing | **2a / 2b / 2c**, as in the table at the top | 2a fixes both defects with the smallest new surface. The live, capacity and automation layers need 2a's planned orders first. |
| Planned order entity | **New `plannedOrder` table** | `supplyForecast` is a weekly aggregate with no identity, status or peg. A planned order must be firmable, convertible, peggable and diffable. |
| Sweep | **One low-level-code sweep**, reusing the `explodeBom` loop and its cycle break | The low-level code puts every parent first. One pass is enough. |
| Explosion quantity | **Lot-sized quantity plus scrap** | SAP and Dynamics 365 lot-size first, then explode. Scrap matches `computeJobQuantities`, so the plan and the job agree. |
| Buffer needs | **Plan buffer needs at the item's own level.** The keys with a reorder point (Fixed Reorder Quantity, Maximum Quantity) are visited with no demand. | SAP MRP and Dynamics 365 treat safety stock as a requirement. Their planned orders explode like any other. |
| Sizing home | **`sizeRowSupply`**, moved out of `deriveRowActions`. The engine and the worklist both call it. The SQL twin stays. | The worklist already sizes every row with it, and it calls `computePlanningOrders`. One function gives one number. A third copy would drift. |
| Planned-order scope (2a) | **The common segment, for the rows of the planning grid only.** Every other key keeps the Phase 1 path. | These are the rows that the worklist already sizes, so the engine and the worklist agree. Project segments are lot-for-lot already. |
| Child demand date | **The release week of the parent's planned order** | The dates of the planned order already carry the lead time. Phase 1 used the lead time of the child. |
| Concurrency | **One company planning lock** (`planning-actions:<companyId>`) for each writer of planned orders and planning actions | A change by a person never lands between the read and the write of a run. |
| Firm meaning | **Firm = MRP must not change it** (SAP, Oracle) | It is the standard meaning. The glossary notes that Dynamics 365 says "Approved". |
| Who firms | **Only a person.** A manual edit firms the order. | SAP sets its firm flag on a manual change. |
| Time fence | **Computed on each run, never stored.** Per item, with a location default. Calendar days in 2a, working days in 2b. Tested on the release date. | SAP computes fence firming per run. A stored system firm outlives its demand and needs a cleanup sweep. |
| New need inside the fence | **Order at the fence end plus an Expedite action** (SAP firming type 1) | The planner gets an order to act on. Creating nothing hides it. |
| Fence-held order with no demand | **Keep it and raise Cancel** | Someone may have bought parts for it. A silent delete hides that. |
| Turning a planned order into a document | **"Convert"**, not "Release" | Carbon already uses Release for a Planned job or PO. SAP calls this step conversion. |
| Components at conversion | **Read the make method again.** The difference view is deferred (D11). | It reuses the job-creation path. The difference covers the risk that SAP's copy-by-default avoids. |
| PO grouping | **One PO per supplier per week at the location**, the Phase 1 rule of the planning Order | Every vendor groups by supplier. Location keeps receiving correct. A PO per week can be finalized on its own. |
| Partial conversion | **Deferred.** Edit the quantity first. | SAP supports it, but the edit-then-convert path covers it. |
| Planning actions | **Reuse `planningAction`.** An Order or Make covers every planned order of its week and names none. A change action names its planned order (`plannedOrderId`). No new action types. | One worklist, one owner ladder, one tolerance. Phase 1 already sums the new supply of a week in one action. Expedite already covers a late job. |
| Pegging | **2b: extend `projectPeg`**: nullable group and project, a `'Planned Order'` supply type | One peg model and one id prefix. Its supersede history is a better design than a new table. |
| Peg history volume | **2b: supersede only changed pegs** (`diffPegs`) | A run with no changes writes no rows. |
| Segment of a component | **The parent's segment**, with the existing common-surplus rule | It matches Carbon's segment rule and Oracle Fusion's netting order. A component in a project segment keeps the Phase 1 path in 2a. |
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

Migration `20261117063500_planned-order.sql`, as built:

```sql
CREATE TYPE "plannedOrderType" AS ENUM ('Make', 'Buy', 'Transfer');   -- Transfer: reserved, not generated
CREATE TYPE "plannedOrderStatus" AS ENUM ('Planned', 'Firm', 'Converted');

CREATE TABLE "plannedOrder" (
  "id" TEXT NOT NULL DEFAULT id('plo'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "planningSegmentId" TEXT NOT NULL DEFAULT '',      -- '' = common; 2a writes only ''
  "orderType" "plannedOrderType" NOT NULL,
  "status" "plannedOrderStatus" NOT NULL DEFAULT 'Planned',
  "quantity" NUMERIC NOT NULL CHECK ("quantity" > 0), -- lot-sized quantity (good units)
  "scrapQuantity" NUMERIC NOT NULL DEFAULT 0,        -- Make: added to quantity for the explosion
  "quantityTrace" JSONB,                             -- { policyName, triggerValues, quantity, scrapQuantity, explosionQuantity }
  "dueDate" DATE NOT NULL,
  "releaseDate" DATE NOT NULL,                       -- dueDate less the lead time, calendar days
  "periodId" TEXT NOT NULL,                          -- the week of dueDate; part of the natural key
  "splitIndex" INTEGER NOT NULL DEFAULT 0,
  "lowLevelCode" INTEGER NOT NULL DEFAULT 0,
  "supplierId" TEXT,                                 -- Buy: the preferred supplier
  "firmedBy" TEXT REFERENCES "user"("id"),           -- set only by a person
  "firmedAt" TIMESTAMP WITH TIME ZONE,
  "jobId" TEXT,                                      -- set on Convert (Make)
  "purchaseOrderLineId" TEXT,                        -- set on Convert (Buy)
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "plannedOrder_pkey" PRIMARY KEY ("id", "companyId"),
  -- companyId, itemId, locationId, periodId: ON DELETE CASCADE
  -- jobId, purchaseOrderLineId: ON DELETE CASCADE (a Converted row goes with its document)
  -- supplierId: ON DELETE SET NULL
  CONSTRAINT "plannedOrder_firm_chk" CHECK (("status" = 'Firm') = ("firmedBy" IS NOT NULL)),
  CONSTRAINT "plannedOrder_converted_chk" CHECK (
    ("status" = 'Converted') = ("jobId" IS NOT NULL OR "purchaseOrderLineId" IS NOT NULL)
  )
);
-- an index on companyId, (companyId, itemId, locationId), (companyId, status) and each FK
CREATE UNIQUE INDEX "plannedOrder_natural_key_idx" ON "plannedOrder"
  ("companyId", "itemId", "locationId", "planningSegmentId", "orderType", "periodId", "splitIndex")
  WHERE "status" = 'Planned';
```

The first design had a `makeMethodId` column. 2a does not add it, because job creation
reads the make method again.

Other Phase 2a changes:

1. The time-fence columns of §2a.4, in the same migration.
2. `planningAction.plannedOrderId`, with the foreign key `(plannedOrderId, companyId)`
   → `plannedOrder` `ON DELETE CASCADE`. A deleted planned order takes its actions
   with it.
3. `planningAction_change_target_chk`:
   - Order, Make, Transfer and Borrow: `purchaseOrderLineId`, `jobId` and
     `plannedOrderId` are null.
   - Every change type: exactly one of the 3 is set.
4. `planningAction_natural_key_idx` puts `plannedOrderId` in its `COALESCE`, before
   `periodId`.
5. The authz manifest rule `plannedOrder: company("production", { read:
   anyOf("production_view", "purchasing_view"), create: false, update: false, delete:
   false })`, shipped in `20261117063502_planned-order-authz.sql`. The API can only read
   the table. MRP writes it through Kysely, and the ERP writes it with the service role
   after its own checks.
6. A company backup keeps `plannedOrder`, because a Firm row is planner state. A dataset
   apply drops it with the other MRP output (`TRANSIENT_MRP_TABLES` in
   `datasets/wipe.ts`). The demo datasets seed no planned orders. MRP fills the table.
7. The MRP cron also plans a company that has a Firm planned order
   (`companiesWithPlanningWork`, `mrp-companies.ts`).
8. Migration `20261117063504_planning-grid-planned-order-actions.sql` redefines the two
   grid RPCs for the Actions filter (§2a.8).

The `projectPeg` changes moved to 2b (§2b.7).

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
for employees. The `projectPeg` changes of §2b.7 also land in 2b.

### Phase 2c

The 3 `companySettings` columns of §2c.2. `plannedOrder` gets the event-system
record-change trigger, so workflow record events fire.

## API / Service Changes

### Phase 2a

**Engine (`packages/planning/src/mrp/`, `packages/database/src/mrp-engine.ts`)**

| File | Change |
|------|--------|
| `mrp-engine.ts` | `explodeBom` takes the optional `planSupply`, `extraPlanningKeys` and `scrapRateByItem`. New type `PlannedSupplyResult`. With `scrapRateByItem`, the raw-need path adds scrap too (§2a.1). |
| `row-sizing.ts` (new) | `sizeRowSupply(input)` → `{ changeActions, newSupply }`, moved out of `deriveRowActions`, with `deriveChangeActions`, `convertOrdersToIncreases` and their helpers. |
| `open-supply-orders.ts` (new) | `buildOpenSupplyOrders(...)`, moved out of `generatePlanningActions`, with `releaseByDate`, `earlierRelease` and the commitment checks. |
| `planned-orders.ts` (new) | `createPlanSupply(inputs)` → `{ planSupply, extraPlanningKeys, result }`, `plannedOrderNaturalKey` and `withPlannedOrderIds`. |
| `plan-company.ts` | Input `plannedOrderInputs`. Outputs `plannedOrders`, `heldPlannedOrderIds`, `plannedOrderSignals`, `plannedOrderChangeActions` and `newSupplyByRow`. |
| `mrp.ts` | `loadPlannedOrderSnapshot` reads the database clock and the Planned and Firm planned orders first. `loadPlannedOrderInputs` then reads the policies, the fences, the tolerance and the open-supply details through Kysely. Phase 7 calls `writePlannedOrderDiff` first. `retryOnPlannedOrderChange` runs each attempt (`loadPlanAndWrite`). The `supplyForecast` delete stays. |
| `planned-order-write.ts` (new) | `diffPlannedOrders` (pure) and `writePlannedOrderDiff(trx, …)` (§2a.6). Also `plannedOrdersChangedSince` (pure), `PlannedOrdersChangedError`, `retryOnPlannedOrderChange` and `MAX_PLAN_ATTEMPTS` (3). |
| `planning-actions.ts` | `deriveRowActions` takes `engineSupply`. New: `plannedOrderActions`, `onePerPlannedOrder`. The natural key targets `purchaseOrderLineId ?? jobId ?? plannedOrderId`, and the diff writes `plannedOrderId`. |
| `row-sizing.ts` | `isOrderFrozen` is false for a planned order. |
| `packages/database/src/planning-lock.ts` (new, `@carbon/database/planning-lock`) | `lockCompanyPlanning(db, companyId)` and `planningLockKey`: the one company planning lock (§2a.6). |
| `packages/utils/src/planning-time-fence.ts` (new, `@carbon/utils`) | `resolvePlanningTimeFenceDays`, `planningTimeFenceDate` and `isPlannedOrderHeld`: the one time-fence rule (§2a.4). |

Every new value-bearing calculation follows the `@carbon/checks` precision rules: no
scale literals, whole units through `scrapAllowance`.

**ERP services**

| Function | File | What it does |
|----------|------|--------------|
| `settleNewSupplyPlanningActions(db, …)` | `production.service.ts` | Takes `asOf` and a `plannedOrderId` per order. It settles the actions, then converts in the same transaction (§2a.7). |
| `convertPlannedOrdersForActions(db, …)` | `production.service.ts` | Converts the planned order of each new job or PO line, and deletes the open change actions on it (§2a.7). `settleNewSupplyPlanningActions` calls it in its transaction. |
| `matchPlannedOrdersToDocuments` | `production.service.ts` | Pure. The match rules of §2a.7. |
| `readPlannedOrderForChange(ctx, id)` | `production.service.ts` | Reads one planned order by `id` and `companyId`. It refuses a Transfer or Converted row. It checks `update: production` for Make and `update: purchasing` for Buy. |
| `firmPlannedOrder` / `unfirmPlannedOrder` | `production.service.ts` | Planned → Firm with the firm stamp, and back. Unfirm takes the next free `splitIndex` when its key is taken. |
| `updatePlannedOrders(db, …)` | `production.service.ts` | One statement for many edits. Each edit firms its row. A new due date moves the release date by the same days and moves the row to the week that holds it. A new Make quantity restates `scrapQuantity`. |
| `applyPlannedOrderPlanningActions(db, …)` | `production.service.ts` | Applies change actions on planned orders in one transaction: lock, claim, one edit statement, one DELETE for the Cancels, then the release of refused claims. |
| `firmPlannedOrder`, `unfirmPlannedOrder`, `updatePlannedOrder` | `production.server.ts` | The operations. `permission: {}`, because the type of the planned order decides the permission inside the body. Not published to MCP. |
| `applyPlanningActions` | `production.server.ts`, `purchasing.server.ts` | Sends each action with `plannedOrderId` to `applyPlannedOrderPlanningActions` (Make or Buy). A Cancel on a planned order needs no delete permission, because a planned order is not a document. |
| `getDrawerPlannedOrders`, `getPlanningTimeFenceDays` | `production.utils.ts` | The browser reads of the drawer. |
| `getRowPlannedOrders` | `production.utils.ts` | The browser read of a bulk Make or Order: the planned orders of many items, 100 items per request. |
| `productionOrdersFromActions`, `plannedOrdersFromActions` | `ui/Planning/planned-orders-from-actions.ts` | Take `plannedOrders` and `currentWeek`. They give one suggested order per planned order of the week (§2a.7). |

The two `planning.update` routes accept the actions `firmPlannedOrder`,
`unfirmPlannedOrder` and `updatePlannedOrder`. The purchasing route calls the
production operations.

`itemPlanningValidator` and `locationValidator` accept `planningTimeFenceDays`, and
`productionOrderValidator` and the purchasing `plannedOrderValidator` accept
`plannedOrderId`. `upsertItemPlanning` and `upsertLocation` save the fence. The column
of `location` is NOT NULL:

- `upsertLocation` inserts a new location with no fence as 0.
- An update without the fence keeps the stored value. So an API or MCP call to
  `updateLocation` with no fence does not clear it.
- The location form route always sends the fence. An empty field saves 0.

These functions of the first design are not built in 2a:

- `convertPlannedOrder`. The Order and Make buttons convert.
- `deletePlannedOrder`. An applied Cancel deletes the planned order.
- `getPlannedOrders` and `getPlannedOrderPegs`. They move to 2b, with the pegs.

**RPCs:** the Actions filter change of §2a.8. The base RPCs change in 2b (§2b.7).

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
- The parts of §2b.7:
  - the common-segment peg writer in `@carbon/planning`, `getPlannedOrders` and
    `getPlannedOrderPegs(id)`;
  - `get_production_planning` and `get_purchasing_planning` read `plannedOrder`;
  - the `planning.update` routes stop writing `supplyForecast`, and MRP drops its
    delete;
  - working-day dates for `releaseDate` and the time fence.

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

Files: `apps/erp/app/modules/production/ui/Planning/` (`DrawerPlannedOrders.tsx`,
`PlanningOrderGrids.tsx`, `PlanningActionLines.tsx`, `planning-review.ts`), the two
order drawers, `ItemPlanningForm`, `LocationForm`.

1. **Drawer.** Both order drawers show a Planned Orders section above Suggested Jobs or
   Suggested Orders (`DrawerPlannedOrders`, `PlannedOrdersGrid`). It lists the Planned
   and Firm planned orders of the item at the location, common segment only. It has 6
   columns:
   - the status chip (Planned / Firm),
   - the release date,
   - the due date,
   - the quantity, with the trace tooltip,
   - the Firm / Unfirm button,
   - the action on the order.

   A held Planned order shows "Fence". A cell edit of the quantity or the due date
   saves at once. For a Planned order, the drawer first asks *"Keep your numbers
   through plan updates?"*.
2. **Suggested orders.** Suggested Jobs and Suggested Orders show one row per
   unconverted planned order of the action's week (§2a.7). Each row converts its own
   planned order when the planner places it.
3. **Worklist lines.** An action on a planned order shows "Planned order" as its
   target. It is always Apply, never "Review on document" (`planningActionNeedsReview`).
   It can be dismissed, reopened and assigned like any change action.
4. **Settings.** `planningTimeFenceDays` on the location form, and on the item Planning
   form in its "Planning window" group, with the location value as the placeholder. A
   new item revision does not copy the item value.

Not built in 2a:

- the planned-order chip and the fence marker on the worklist rows of the grid,
- the peg popover and "quantity without source" (2b),
- the make-method difference on Convert (D11).

### Phase 2b

- The live banner and the change banner.
- The capacity strip.
- The readiness panel and its link.
- The cascade tree and the time-phased matrix.
- The "Can we make it?" panel on the quote line and the sales-order line.
- The "All messages" view.
- The peg popover and "quantity without source" in the drawer (§2b.7).

### Phase 2c

The automation settings (pause, dry run, cap) on the production settings page, the
autopilot ledger in the digest, and the suggested-projection rows in
`DemandProjectionForm`.

## Acceptance Criteria

Evidence for 2a: `planned-orders.test.ts`, `planned-order-write.write.test.ts`,
`planning-actions.test.ts`, `mrp-engine.test.ts`, `planning-time-fence.test.ts`
(`@carbon/utils`), `apps/erp/test/planned-orders-from-actions.test.ts`, and the
database tests `planned-order-write.database.test.ts`, `convert-planned-orders.test.ts`,
`planned-order-firm.test.ts`, `planning-grid-planned-order-actions.test.ts` and
`location-planning-fence.test.ts`. A database test runs only with a local database. The baseline compare
of Task 15 (`.context/mrp-baseline/compare.md`, Carbon Development) explained every
changed action. The criteria that moved to 2b are under Phase 2b.

### Phase 2a — core cascade

- [x] A Make item with a reorder policy and no job: one MRP run creates a planned order
      for it and demand for its components. No job exists yet. (`planned-orders.test.ts`
      "plans a buffer need with no demand and explodes it to the child"; SAT-1000 in the
      baseline compare.)
- [x] The cascade reaches full depth: a Make parent → a Make child with its own planned
      order → bought parts. (`planned-orders.test.ts` "plans a Make child from the
      parent's buffer order, and its bought part from the child's order")
- [x] Need 3, batch size 5, BOM quantity 2: the component demand is 10, not 6.
      (`mrp-engine.test.ts` "explodes a planned order of 5 for a need of 3…";
      `planned-orders.test.ts` "explodes the lot-sized quantity at the release week…")
- [x] The surplus parents count as projected stock. A need of 2 the next week creates
      no new planned order. (same `planned-orders.test.ts` case)
- [x] Parent scrap rate 0.1 on an order of 10: the explosion quantity is 11.
      (`planned-orders.test.ts` "explodes the parent's scrap with the order")
- [x] The component demand equals the job material quantity that `computeJobQuantities`
      gives for the same order. The part under a Make to Order child matches the
      subjob too. (`planned-orders.test.ts` "explosion parity with job creation")
- [x] A child gets its own scrap, except a Make to Order child that is made.
      (`mrp-engine.test.ts` "adds a child's scrap to a planned explosion…")
- [x] Each buffer policy on a Make item creates a planned order that explodes. Manual
      Reorder creates none. (`planned-orders.test.ts` "buffer policies": Maximum
      Quantity and Fixed Reorder Quantity plan and explode with no demand. Manual
      Reorder and Demand-Based Reorder plan nothing with no demand, as §2a.1 says.)
- [x] Each planned order stores a trace whose values give its quantity, scrap and
      explosion quantity. The SQL parity test is green. (`planned-orders.test.ts`
      "stores a trace whose quantity, scrap and explosion give the order";
      `planning-sizing.test.ts` "parity with SQL calculate_quantity_to_order".)
- [x] With no fence and no held orders, the engine gives the same Make quantities as
      the worklist sizing. (`planned-orders.test.ts` "sizes the same Make quantities as
      the planning worklist with no fence"; the `deriveRowActions` tests did not change
      in the `sizeRowSupply` extraction.)

### Phase 2a — scope, segments, supersession, configured BOMs

- [x] A project segment keeps the Phase 1 path and gets no planned order.
      (`planned-orders.test.ts` "leaves a project segment to the Phase 1 path")
- [x] A superseded item gets no planned order. (`planned-orders.test.ts` "plans no order
      for a superseded item")
- [x] An item with no planning row keeps the Phase 1 explosion.
      (`planned-orders.test.ts` "keeps the Phase 1 explosion for an item with no
      planning row")
- [x] A Make to Order Make child gets no planned order. Its own children get the demand.
      (`planned-orders.test.ts` "plans no order for a child built as Make to Order")
- [x] A configured item explodes only the lines of its default configuration.
      (`planned-orders.test.ts` "never gives demand to a quantity-0 BOM line")

### Phase 2a — lifecycle and fence

- [x] A Firm order survives regeneration with its quantity and dates. It still
      explodes. (`planned-orders.test.ts` "keeps a Firm order's quantity and explodes it
      in full"; `planned-order-write.write.test.ts` "never touches a Firm or Converted
      row…")
- [x] Editing a planned order firms it, with `firmedBy` = the user. A new due date
      moves the release date by the same days. (`planned-order-firm.test.ts` "an edit
      firms the order…")
- [x] A moved due date moves the order to the week that holds it.
      (`planned-order-firm.test.ts`)
- [x] Unfirm takes a free `splitIndex` when MRP planned the same week meanwhile.
      (`planned-order-firm.test.ts`)
- [x] A held Planned order keeps its values across a run. Its status stays Planned. No
      column stores the hold. (`planned-order-write.write.test.ts` "deletes a Planned
      row no generated order matches, but keeps a held one"; the diff never matches a
      held row.)
- [x] Fence 10 days: a new need inside the fence creates a planned order at the fence
      end. The worklist raises an Expedite to the real need date. (`planned-orders.test.ts`
      "starts a new order at the end of the time fence…"; `planning-actions.test.ts`
      "turns a fence signal into an Expedite on the planned order")
- [x] A held order with no demand stays, and gets a Cancel. It still explodes. Applying
      the Cancel deletes it and its action. (`planned-orders.test.ts` "cancels a held
      planned order nothing needs…"; `planned-order-firm.test.ts` "an applied Cancel
      deletes the planned order and its action")
- [x] The next run does not create the cancelled order again. (`planned-orders.test.ts`
      "does not plan a cancelled order again")
- [x] Outside the fence, the run deletes a Planned order that lost its demand.
      (`planned-order-write.write.test.ts`)
- [x] An item `planningTimeFenceDays` wins over the location value in both directions,
      including an explicit 0. (`planning-time-fence.test.ts` "resolvePlanningTimeFenceDays";
      `planned-orders.test.ts` "an explicit item fence of 0 opts out of the location's"
      and "a missing item fence takes the location's")
- [x] An update of a location without the fence keeps the stored fence.
      (`location-planning-fence.test.ts`)

### Phase 2a — actions, conversion and one number

- [x] The Order or Make action of a week sums the planned orders of the week that are
      still to convert, new and held, and names no planned order.
      (`planning-actions.test.ts` "uses the engine's orders, summed per week, naming no
      planned order" and "sums a held planned order into its week's Make";
      `planned-orders.test.ts` "offers a held order for conversion as its week's Make")
- [x] A planned order is never frozen. A Firm order due inside its lead time gets an
      Increase, not a second Make. (`planned-orders.test.ts` "increases a Firm order
      due inside its lead time")
- [x] Each planned order gets one change action at most. A Cancel beats an Expedite.
      (`planning-actions.test.ts` "keeps one action per planned order…")
- [x] A Make that creates 2 jobs converts both planned orders, in split order. A Firm
      order converts by its id and loses its firm stamp. Another week's order is left
      alone. (`convert-planned-orders.test.ts`)
- [x] A job that names its planned order converts that one. A stale or mismatched id
      converts nothing. A job with no id converts the planned order of its own quantity
      first, and a smaller job never converts a Firm order. The current week's job
      converts an overdue planned order of an older week. Converting deletes the Open
      and Dismissed change actions on the order. (`convert-planned-orders.test.ts`)
- [x] The suggested orders are one per unconverted planned order of the week, Firm
      included. The current week's action also offers the overdue planned orders.
      (`planned-orders-from-actions.test.ts` "suggestions from the week's planned
      orders")
- [x] An Order converts its Buy planned order to the PO line.
      (`convert-planned-orders.test.ts`)
- [x] The next run counts the converted job once. (`planned-orders.test.ts` "counts a
      converted order once, as its job")
- [x] A Defer applied on a planned order moves both dates and firms the order. A
      Converted order refuses the action, and the action stays Open.
      (`planned-order-firm.test.ts`)
- [x] The type of the planned order decides the permission. (`planned-order-firm.test.ts`
      "the planned order's type decides the permission")
- [x] An Actions filter keeps a grid row whose only action is on a planned order.
      (`planning-grid-planned-order-actions.test.ts` "keeps each row whose only action is
      on a planned order of the grid's type")

### Phase 2a — identity and atomicity

- [x] Two runs with unchanged inputs write no planned-order row the second time. The
      ids stay. (`planned-order-write.write.test.ts` "sends no write for a matched row
      whose values did not change")
- [x] The planned-order write takes the company planning lock before any other
      statement. (`planned-order-write.write.test.ts`)
- [x] A failed run leaves the previous planned orders unchanged (fault-injection test).
      (`planned-order-write.database.test.ts` "leaves the previous planned orders
      unchanged when a later statement fails")
- [x] A run whose planned orders changed after its read writes nothing and plans again,
      up to 5 attempts. (`planned-order-write.write.test.ts` "the planned-order check
      before the write", "plannedOrdersChangedSince" and "retryOnPlannedOrderChange")

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
- [ ] (moved from 2a) The cascade pegs each planned order to its parent. Two runs with
      unchanged inputs write no new peg rows. A common-segment peg has null
      `planningGroupId` and `projectId`. The planning-group tests stay green.
- [ ] (moved from 2a) For an item with a planned order, `quantityToOrder` in the grid
      equals the planned-order total. An item with no planned order still uses
      `calculate_quantity_to_order`.
- [ ] (moved from 2a) `releaseDate` never falls on a closed day for the location. The
      fence counts working days.
- [ ] (moved from 2a) The `planning.update` routes write no `supplyForecast`, and MRP no
      longer deletes it.

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
- [x] The glossary has "Planned Order", "Firm" (with the Dynamics 365 note) and
      "Convert" (`docs/content/src/glossary/terms.ts`, 2a).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Planned and Planned job read as the same thing | Med | The Terms table, the glossary entries, and status chips that say "Planned order" in full on the worklist. |
| Regeneration churns near-term orders | Med-High | The fence holds them. 2b adds the stable worklist and the change banner. |
| Peg volume grows with every run (2b) | Med | `diffPegs` supersedes only changed pegs. An unchanged run writes nothing. |
| `projectPeg` changes break planning groups (2b) | Med | The CHECK keeps the group rule. The planning-group tests run in the 2b gate. |
| Lot-sizing drift between TS and SQL | Med | The engine and the worklist share `sizeRowSupply`, with the parity test. In 2a the base RPC `quantityToOrder` still sizes in SQL, but no grid column shows it. §2b.7 shrinks the SQL path to no-plan rows. |
| A Firm order of an item that later becomes ineligible (2a) | Med | MRP neither counts it as supply nor deletes it, because only eligible keys read held orders. The drawer still lists it. Unfirm or Convert it by hand. A later change counts it as supply (D10). |
| The engine plans 72 weeks, the worklist reads 48 (2a) | Low | A planned order due after week 48 gets no action and no Order or Make on the worklist. It stays in `plannedOrder` until a run moves it inside 48 weeks. |
| Scrap is not tested on demo data (2a) | Low | No item in the demo datasets has a scrap percentage, so the baseline compare showed no scrap. Unit tests cover the parent scrap, the child scrap and the parity with job creation (`computeJobQuantities`). |
| Calendar-day dates in 2a | Low | A release date or a fence end can fall on a closed day. §2b.7 moves both to working days. |
| People change planned orders during each attempt of a run (2a) | Low | The run plans again after each change, up to 5 attempts with a random pause. Then it fails with "Run MRP again", and the next run picks up the changes. |
| The plan and the converted job disagree | Med | Scrap uses the job rule. Convert shows the make-method difference. |
| Row count grows (every level of every item) | Med | Default filters, paging, and the natural key reuses rows. |
| MRP and the scheduler fight over job dates (2b) | Med-High | MRP recommends only. Job date changes go through `updateJob` and `notifyScheduleInputsChanged`. A loop test covers it. |
| MRP output depends on scheduler freshness (2b) | Med | Fall back to the due date. The scheduler's own wave and nightly replan keep projections fresh. |
| Confidence gating hides a real problem (2b) | Med | Nothing is deleted. "All messages" shows every action. The readiness panel drives the fix. |
| Capable-to-promise read as a guarantee (2b) | Med | The assumptions are part of the result. The label says "plan-based" everywhere. |
| Automation misfires (2c) | Med | Dry run on by default, a cap, a pause and a daily ledger. |
| Workflow and regeneration feed each other (2c) | Med | Converted rows never regenerate. The watch list excludes regenerated flags. A loop test converges in one cycle. |
| Removing `supplyForecast` breaks the grid mid-change (2b) | Med | Land the grid read of `plannedOrder` first. Remove the `supplyForecast` writes last, in the same PR series. |

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
| D9 | **Retiring the SQL grid** (`calculate_quantity_to_order` and the week-column RPCs). | §2b.7 limits it to items with no planned order. | 2b, in use for a while | §2b.7. Remove the SQL twin and its parity test together. |
| D10 | **Planned orders for the keys that 2a leaves on the Phase 1 path:** project and planning-group segments, superseded items (Consume First), Make to Order children, and items with no planning row. Also: count a Firm order as supply after its item becomes ineligible. | 2a plans only the rows that the worklist sizes, so the engine and the worklist agree (§2a.2). Project segments are lot-for-lot already. | 2a | `eligibleOf` and `createPlanSupply` (`planned-orders.ts`), and the null return of the hook. Consume First needs a lot-sized explosion through the redirect, in whole assemblies. |
| D11 | **The make-method difference at conversion.** If the make method changed after the run that exploded the planned order, the drawer shows the difference before the user confirms. | Job creation reads the method again, so the job is correct. The difference only explains it. | 2a | §2a.7. The first design of the 2a drawer. |

## Open Questions

> All resolved. The record below gives the current answer to each question.

- [x] **Materialize on plan or on conversion?** — A true planned-order layer. A real job
      or PO exists only after Convert. Planned orders are disposable.
- [x] **Buy planned orders?** — Yes. Pegging needs them.
- [x] **One plan page or two?** — Two, cross-linked in the cascade tree (2b).
- [x] **Retire the SQL grid?** — No. From 2b it fills only items with no planned order.
- [x] **Can a Firm order be edited?** — Yes. Firm means "a person owns this order".
- [x] **Split Phase 2?** — Yes: 2a, 2b, 2c, as in the table at the top.
- [x] **Reuse Phase 1 code or write new functions?** — Reuse `sizeRowSupply` (the
      worklist sizing, which calls `computePlanningOrders`), `deriveChangeActions`,
      `planningAction`, `projectPeg` (2b) and `runQuoteLeadTimeWhatIf`.
- [x] **Store fence firming or compute it?** — Compute it on each run. Only a person
      firms an order.
- [x] **A new need inside the fence?** — Plan it at the fence end and raise Expedite.
- [x] **A fence-held order with no demand?** — Keep it and raise Cancel.
- [x] **Components at conversion?** — Read the make method again. The difference view
      is deferred (D11).
- [x] **Where do pegs live?** — In `projectPeg`, extended, in 2b.
- [x] **A demand time fence?** — Not in Phase 2.
- [x] **Scrap in planned orders?** — Yes, with the `computeJobQuantities` rule.
- [x] **The word for planned order → document?** — Convert. Release stays the Phase 1
      action on a Planned job or PO.
- [x] **Which date does the fence test?** — The release date. Calendar days in 2a,
      working days in 2b.
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
- [x] **Date math?** — Calendar days in 2a. Working days over the location calendar in
      2b.
- [x] **Explainability?** — Trace in 2a. Pegs and the change banner in 2b. Agent in 2c.
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
- [x] **Two numbers during the debounce window?** — 2a: the Order / Make quantity of
      the grid is the sum of the actions, which come from the planned orders. 2b: one
      "Plan updating…" indicator.
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
- **2026-11-14**: Phase 2a implemented on the MRP v2 Phase 2a PR (plan
  `.ai/plans/2026-11-14-mrp-v2-phase-2a.md`). The spec now describes the code. 4 parts
  moved to 2b (§2b.7): pegging, the `supplyForecast` replacement, the grid SQL
  quantities and working-day dates. Changes from the first 2a design:
  1. Planned orders exist only in the common segment, for the rows of the planning
     grid (§2a.2).
  2. The engine sizes with `sizeRowSupply`, through an optional `planSupply` hook on
     `explodeBom`.
  3. Child demand goes into the release week of the parent.
  4. An Order or Make covers every planned order of its week. Only a change action
     names a planned order.
  5. Conversion runs in the settle transaction, by `splitIndex`.
  6. One company planning lock serves every writer.
  7. The grid Actions filter counts actions on planned orders.

  Added D10, D11 and the 2a risks.
