# Planning and scheduling lessons

MRP, the scheduler, demand, supersession, promising.

## A helper that models a chain must be tested with a loop (2026-09-16)

```scope
id: a-helper-that-models-a-chain-must-be-tested-with-a-loop-2026
paths: ["apps/erp/app/modules/inventory/supersession-pick.ts","packages/database/src/supersession-pick.ts"]
triggers: ["buildConsumeFirstHops","successorItemId","parentMaterialId"]
```

- **Context:** `buildConsumeFirstHops` walked one Consume First hop at a time
  and guarded against loops only while collapsing through non-Consume-First
  hops. A two-item Consume First loop passed straight through, and in the
  engine both items would sit on one cycle level and hand demand to an item
  already planned — silently lost.
- **Problem:** the guard was written for the path being walked, not for the
  property that matters ("does this chain terminate?"), and the first test
  I wrote for it was the one that caught it.
- **Rule:** any function that follows successor / parent / next pointers
  gets a cycle test of the smallest loop (two nodes) before anything else,
  and the guard checks termination of the WHOLE chain, not just the part the
  function happens to traverse.
- **Applies to:** `lib/supersession-pick.ts` chain builders, BOM walkers,
  anything keyed on `successorItemId` or `parentMaterialId`.

## A reservation class that must outlive job status needs an explicit escape in EVERY snapshot filter

```scope
id: a-reservation-class-that-must-outlive-job-status-needs-an-ex
paths: ["packages/planning/src/scheduling/master-data-provider.ts"]
triggers: ["getLiveReservations","capacityHoldingJobStatuses","capacityReservation","jobOperationBatchId"]
```

**Context:** Batch release schedules a Released operation batch as one coalesced `capacityReservation` anchored (for the NOT NULL `jobId`/`operationId`) on an arbitrary member — whose job may legitimately still be `Draft` (membership handoff pulls members ahead of their jobs).

**Problem:** `getLiveReservations` quietly filters `j."status" IN capacityHoldingJobStatuses` at the END of the query builder — separate from the `excludeJobIds` filter that had already been made batch-aware. The batch row vanished from every snapshot whenever its anchor job was unreleased: the machine looked free and every other job over-booked straight through the batch window.

**Rule:** When a reservation (or any capacity-holding row) must survive independently of its anchor row's status, grep EVERY filter in the read path — not just the one you were pointed at — and give each an explicit escape (`OR "jobOperationBatchId" IS NOT NULL`). A snapshot read with two filters a hundred lines apart is two bugs, not one.

**Applies to:** `packages/ee/src/planning/scheduling/master-data-provider.ts` `getLiveReservations`, any future scenario/what-if reservation reads, and generally any row whose lifecycle is owned by a different entity than its FK anchor.

## A scheduler decision is only stored when every write-back guard agrees

```scope
id: a-scheduler-decision-is-only-stored-when-every-write-back-gu
paths: ["packages/planning/src/scheduling/apply-work-center-selections.ts","packages/planning/src/scheduling/run-overlay.ts","packages/planning/src/scheduling/scheduling-engine.ts"]
triggers: ["applyWorkCenterSelections","placementWrites","buildWrites"]
```

**Context:** The scheduler balances an operation that has not started onto any work center of its process (F10, 2026-10-26).

**Problem:** Two separate "never overwrite a stored work center" guards sat between the decision and the database: one in `applyWorkCenterSelections`, one in the engine's `buildWrites`. Fixing the first one alone changed nothing in the database. The `capacityReservation` row named the chosen station while `jobOperation.workCenterId` kept the old one, and every unit test still passed.

**Rule:** When you change what the scheduler decides, trace the value to the write (`placementWrites`, `run-overlay.ts`). Test the decision and the write together, then remove the write fix and confirm a test goes red.

**Applies to:** `packages/planning/src/scheduling/` — `apply-work-center-selections.ts`, `run-overlay.ts`, `scheduling-engine.ts`.

## A supply figure that includes scrap cannot be written back as the order quantity

```scope
id: a-supply-figure-that-includes-scrap-cannot-be-written-back-a
paths: ["packages/planning/src/mrp/planning-actions.ts"]
triggers: ["generatePlanningActions","updatePlanningJob","quantityToReceive","openProductionOrders","openPurchaseOrderLines"]
```

**Context:** Planning actions measure each open job against demand and suggest Decrease /
Increase. The job's supply came from `openProductionOrders.quantityToReceive`, which is
`productionQuantity − received`, and `productionQuantity` is the generated `quantity + scrapQuantity`.

**Problem:** Apply writes the suggested figure to `job.quantity`, the good units. A job of 80
with scrap 4 counted as 84 against a demand of 80: "Only 80 of 84 is required", every run, for
every job on an item with a scrap rate — and applying it changed nothing, so it came back.
An Increase was 4 too high the same way. No test covered a job with scrap.

**Rule:** Measure a document in the unit the action will WRITE. If the engine reads a derived
total (with scrap, with a conversion factor), either convert at the boundary or read the base
column. And when a write changes a base quantity, restate what rides on it (the scrap
allowance), as the insert path does — a patch that sets one column of a pair is the bug class
`.claude/rules/supersession-system.md` describes for `itemScrapPercentage`.

**Applies to:** `generatePlanningActions` (`packages/planning/src/mrp/planning-actions.ts`),
`updatePlanningJob` (`production.service.ts`), any engine that reads `openProductionOrders`
or `openPurchaseOrderLines` and writes a document quantity back.

## A creation-time swap must be keyed by its provenance column at every later lookup

```scope
id: a-creation-time-swap-must-be-keyed-by-its-provenance-column
paths: ["apps/erp/app/modules/inventory/supersession-pick.ts","packages/planning/src/mrp/mrp.ts"]
triggers: ["substitutedFromItemId","redirectedFromItemId","generatePickingList","get_picking_schedule","resolvePickRule"]
```

**Context:** Supersession swaps a `jobMaterial` to its successor when the job is created (`substitutedFromItemId` records the predecessor). Picking then looked up `itemSupersession` by `jobMaterial.itemId` — which is now the successor, which has no row — so `resolvePickTarget` returned "pick the item unchanged" and `Consume First` never consumed the predecessor's stock. The picking-side branch was dead code for every job created after the effectivity date, and the unit tests (which passed a material still on the predecessor) could not see it. A second writer appeared later: a line pulled back onto a stocked predecessor stores the SUCCESSOR in `substitutedFromItemId`. Picking looked the rule up on that column first. That was correct for the forward case. But when the successor had a rule of its own (NEW → NEWER), the pulled-back line resolved NEW's rule, the roles inverted, and the pick went back to NEW.

**Problem:** The rule lives on the OLD item; the row already names the NEW one. Any later stage that re-reads the rule by the row's current item silently finds nothing, and "no rule" is a valid, quiet outcome. "Column set ⇒ rule lives there" was true only until the second writer appeared. The only thing that distinguishes the two shapes is the relation between the row's own item and the column: on a pulled-back line, the row's own rule NAMES the column as its successor.

**Rule:** When a row is rewritten by a rule and carries a provenance column (`substitutedFromItemId`, `redirectedFromItemId`, …), every downstream lookup of that rule must use the provenance column, in BOTH the TS and SQL mirrors. When only one direction of a swap writes the column, key on `COALESCE(provenance, current)`. When more than one direction can write it, resolve by relation, not by presence: prefer the row's own rule when it points at the column; only then fall back to the column's rule. Mirror the precedence in every SQL twin (`ORDER BY (own AND successor = column) IS TRUE DESC, …`). Or give the two directions distinct columns. Test the swapped shape explicitly, in each direction — a fixture that stops at "rule set, nothing swapped yet" proves nothing about what happens after the swap.

**Applies to:** `apps/erp/app/modules/inventory/supersession-pick.ts` (`resolvePickRule`) / `generatePickingList`, `get_picking_schedule`, `packages/ee/src/planning/mrp/mrp.ts` (redirected BOM children), any reader of `jobMaterial.substitutedFromItemId` / `redirectedFromItemId`.

## A degenerate-input guard on a scheduling surface is a silent-vanish bug, not defensive coding

```scope
id: a-degenerate-input-guard-on-a-scheduling-surface-is-a-silent
paths: ["packages/planning/src/scheduling/**"]
triggers: ["isPlaceholder","conflictReason","capacityReservation"]
```

**Context:** The batch pre-pass had `if (durationSeconds <= 0) continue;` — a released batch whose member operations all carry zero setup/labor/machine time (routinely true for freshly-authored routings) was skipped entirely: no reservation, no auto work-center selection, nothing on the reservation-driven Forecast. The user released BAT000005 and it simply didn't exist anywhere schedule-shaped, indistinguishable from the (separate) dead-Inngest failure being debugged at the same time.

**Problem:** Zero/empty/unsized work still EXISTS. On surfaces whose only rendering source is a derived row (the Forecast draws `capacityReservation` rows and nothing else), a "skip nonsense input" guard doesn't degrade gracefully — it erases the entity, and the erasure reads as any of five other failures (event bus down, filter bug, RLS, wrong week, stale registration).

**Rule:** In the scheduling engine, degenerate input never `continue`s past a persistence step — it emits the flagged placeholder shape (`isPlaceholder = true`, honest `workHours`, a `conflictReason` naming the DATA gap and its fix) so the entity stays visible and self-diagnosing. Match the unplaceable-op precedent; give the placeholder a nominal drawable window when true content is zero.

**Applies to:** `packages/ee/src/planning/scheduling/batch-scheduler.ts`, `work-center-selector.ts` placeholder branches, and any future pre-pass/what-if that turns entities into reservations or timeline rows.

## Consume First is one rule for bought and made parts (2026-09-16)

```scope
id: consume-first-is-one-rule-for-bought-and-made-parts-2026-09
paths: ["packages/database/src/mrp-engine.ts","packages/planning/src/mrp/mrp.ts"]
triggers: ["consumeFirstRedirect","explodeBom","settleConsumeFirstLines","loadSupersessionRedirect","Consume First"]
```

- **Context:** the Consume First stock-netting was written for bought parts
  only. A made predecessor always swapped to its successor — at job creation
  (`loadSupersessionRedirect`'s Make exclusion) and in MRP (full BOM swap) —
  because the post-explosion pass that moved the bought shortfall could not
  explode a made successor's BOM.
- **Problem:** stocked old sub-assemblies were never used: a job named the new
  bracket while old brackets sat on the shelf, and planning bought the new
  bracket's ingredients for the whole quantity. The two "made" special cases
  were a workaround for where the netting lived, not a product decision.
- **Rule:** put the netting where the successor can still be planned as
  itself. In MRP that is INSIDE `explodeBom` (`consumeFirstRedirect`): the old
  part nets its running balance and moves the shortfall to the successor,
  which then explodes or buys at a deeper level (a synthetic leveling edge
  keeps it below the predecessor). In job creation the per-line settle pass is
  the authority for every Pull from Inventory line, and the item-level filter
  is provisional. When a rule has a replenishment-specific exception, ask
  whether the exception is a product decision or an artefact of where the
  code sits.
- **Applies to:** `lib/mrp-engine.ts`, `packages/ee/src/planning/mrp/mrp.ts`,
  `get-method` `settleConsumeFirstLines` / `loadSupersessionRedirect`.

## `openProductionOrders` is MRP supply, not "the open jobs for an item"

```scope
id: openproductionorders-is-mrp-supply-not-the-open-jobs-for-an
paths: ["apps/erp/app/modules/items/ui/Item/ItemBuildable.tsx"]
triggers: ["openProductionOrders"]
```

**Context:** The Buildable Quantity card lists an item's open jobs and whether stock covers what each still has to issue.

**Problem:** The jobs were read from `openProductionOrders`. That view leaves out every job made for a sales order (`salesOrderId IS NULL`) and every `consumeToProject` job, and its `quantityToReceive` is `productionQuantity` (quantity + scrap) less received. An item made to order showed no jobs in production, and a job with a scrap allowance showed more units than it will make.

**Rule:** To list an item's open jobs, read `job` with the four open statuses. The good units left are `quantity − quantityReceivedToInventory − quantityShipped`, as `openSalesOrderLines` nets a job. Use `openProductionOrders` only where the question is "what supply does MRP count".

**Applies to:** Any report, card or check that shows jobs in production or work in process for an item.

## A condition added to one branch is tested on its mirror

```scope
id: a-condition-added-to-one-branch-is-tested-on-its-mirror
paths: ["packages/planning/src/promising/**"]
triggers: ["checkDeliveryDates"]
```

**Context:** The delivery date check decides two things from the same free stock: whether a date passes, and the earliest date it suggests.

**Problem:** The rule "goods are usable from the day they arrive" went into the earliest date only. A date in the week of a delivery, but before it, still passed. In the same change, the whole-order check left every line it checked out of the order's demand. An undated line is never checked, so its demand disappeared and a dated line could be promised its stock.

**Rule:** For each condition you add, list every other place that decides the same thing (the verdict and the suggestion; the rows you exclude because "they are handled elsewhere" and the rows that really are handled there). Test the case that falls between them.

**Applies to:** Decision engines that return both a verdict and a suggested value, and any exclusion justified by another step.

## A copy of an engine's rule reads the engine first

```scope
id: a-copy-of-an-engine-s-rule-reads-the-engine-first
paths: ["packages/planning/src/mrp/bom-children.ts","packages/planning/src/mrp/mrp.ts"]
triggers: ["bomChildren","methodCorrectionId","WITH RECURSIVE"]
```

**Context:** The sales order delivery date check walks the bill of materials with its own SQL to add up the cumulative lead time.

**Problem:** MRP's explosion (`bomChildren`, `packages/planning/src/mrp/bom-children.ts`, and the `methodCorrectionId IS NULL` filter in `mrp.ts`) leaves out quantity-0 lines and correction materials. The copy did not. A configured item's other configurations, which sit at quantity 0, added their lead time: one test item went from 67 days to 407.

**Rule:** Before you write a calculation that another engine already does (BOM explosion, stock netting, supply and due dates), read that engine and apply the same filters. Name the engine in a comment beside the copy, so the two stay in step.

**Applies to:** Order promising, quote lead time, and any read outside MRP that walks a BOM or nets stock.

## Consume First splits are per assembly, not per unit (2026-09-15)

```scope
id: consume-first-splits-are-per-assembly-not-per-unit-2026-09-1
paths: ["packages/database/src/supersession-pick.ts"]
triggers: ["consumableInWholeAssemblies","Consume First","supersessionMode"]
```

- **Context:** the Consume First partial-stock split picked the predecessor for
  every unit the warehouse had and the successor for the rest.
- **Problem:** with 2 per assembly and 3 on the shelf that put one old and one
  new part on the same unit. A customer would rather leave the odd part in
  stock than fit a mismatched pair; units of a batch may differ, one unit never.
- **Rule:** round a predecessor's usable on-hand DOWN to a multiple of the
  line's per-assembly quantity (`consumableInWholeAssemblies`) everywhere the
  split is computed — job creation, picking, the SQL schedule, the job
  materials note, Order Status, the planning list, MRP. A quantity rule that
  lives in seven places needs one helper, or the sites drift.
- **Applies to:** any allocation of a per-unit component across a batch.
