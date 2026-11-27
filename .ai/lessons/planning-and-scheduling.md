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
- **Applies to:** `packages/database/src/supersession-pick.ts` chain builders, BOM walkers,
  anything keyed on `successorItemId` or `parentMaterialId`.

## A reservation class that must outlive job status needs an explicit escape in EVERY snapshot filter

```scope
id: a-reservation-class-that-must-outlive-job-status-needs-an-ex
paths: ["packages/planning/src/scheduling/master-data-provider.ts"]
triggers: ["getLiveReservations","capacityHoldingJobStatuses","capacityReservation","jobOperationBatchId"]
```

**Context:** Batch release schedules a Released operation batch as one coalesced `capacityReservation` anchored (for the NOT NULL `jobId`/`operationId`) on an arbitrary member — whose job may legitimately still be `Draft` (membership handoff pulls members ahead of their jobs).

**Problem:** `getLiveReservations` quietly filters `j."status" IN capacityHoldingJobStatuses` at the END of the query builder — separate from the `excludeJobIds` filter that had already been made batch-aware. The batch row vanished from every snapshot whenever its anchor job was unreleased: the machine looked free and every other job over-booked straight through the batch window.

**Rule:** When a reservation (or any capacity-holding row) must survive independently of its anchor row's status, grep EVERY filter in the read path — not just the one you were pointed at — and give each an explicit escape. A snapshot read with two filters a hundred lines apart is two bugs, not one. The rest is in `.claude/rules/scheduling-data-structures.md` ("Three predicate rules keep the coalesced row alive").

**Applies to:** `packages/planning/src/scheduling/master-data-provider.ts` `getLiveReservations`, any future scenario/what-if reservation reads, and generally any row whose lifecycle is owned by a different entity than its FK anchor.

## A scheduler decision is only stored when every write-back guard agrees

```scope
id: a-scheduler-decision-is-only-stored-when-every-write-back-gu
paths: ["packages/planning/src/scheduling/apply-work-center-selections.ts","packages/planning/src/scheduling/run-overlay.ts","packages/planning/src/scheduling/scheduling-engine.ts"]
triggers: ["applyWorkCenterSelections","placementWrites","buildWrites"]
```

**Context:** The scheduler balances an operation that has not started onto any work center of its process (F10, 2026-10-26).

**Problem:** Two separate "never overwrite a stored work center" guards sat between the decision and the database: one in `applyWorkCenterSelections`, one in the engine's `buildWrites`. Fixing the first one alone changed nothing in the database. The `capacityReservation` row named the chosen station while `jobOperation.workCenterId` kept the old one, and every unit test still passed.

**Rule:** When you change what the scheduler decides, test the decision and the write together, then remove the write fix and confirm a test goes red. The rest is in `.claude/rules/scheduling-data-structures.md`.

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

**Context:** Supersession swaps a `jobMaterial` to its successor when the job is created, and picking first looked the rule up by the row's current item. The unit tests passed a material still on the predecessor, so they could not see it. A second writer (a line pulled back onto a stocked predecessor) later stored the SUCCESSOR in `substitutedFromItemId`.

**Problem:** The rule lives on the OLD item; the row already names the NEW one. Any later stage that re-reads the rule by the row's current item silently finds nothing, and "no rule" is a valid, quiet outcome. "Column set ⇒ rule lives there" was true only until the second writer appeared. The only thing that distinguishes the two shapes is the relation between the row's own item and the column: on a pulled-back line, the row's own rule NAMES the column as its successor.

**Rule:** When a row is rewritten by a rule and carries a provenance column (`substitutedFromItemId`, `redirectedFromItemId`, …), every downstream lookup of that rule must use the provenance column, in BOTH the TS and SQL mirrors. When only one direction of a swap writes the column, key on `COALESCE(provenance, current)`. When more than one direction can write it, resolve by relation, not by presence, or give the two directions distinct columns. Test the swapped shape explicitly, in each direction — a fixture that stops at "rule set, nothing swapped yet" proves nothing about what happens after the swap. The rest (the `resolvePickRule` precedence and its SQL twin) is in `.claude/rules/supersession-system.md`.

**Applies to:** `apps/erp/app/modules/inventory/supersession-pick.ts` (`resolvePickRule`) / `generatePickingList`, `get_picking_schedule`, `packages/planning/src/mrp/mrp.ts` (redirected BOM children), any reader of `jobMaterial.substitutedFromItemId` / `redirectedFromItemId`.

## A degenerate-input guard on a scheduling surface is a silent-vanish bug, not defensive coding

```scope
id: a-degenerate-input-guard-on-a-scheduling-surface-is-a-silent
paths: ["packages/planning/src/scheduling/**"]
triggers: ["isPlaceholder","conflictReason","capacityReservation"]
```

**Context:** The batch pre-pass had `if (durationSeconds <= 0) continue;` — a released batch whose member operations all carry zero setup/labor/machine time (routinely true for freshly-authored routings) was skipped entirely: no reservation, no auto work-center selection, nothing on the reservation-driven Forecast. The user released BAT000005 and it simply didn't exist anywhere schedule-shaped, indistinguishable from the (separate) dead-Inngest failure being debugged at the same time.

**Problem:** Zero/empty/unsized work still EXISTS. On surfaces whose only rendering source is a derived row (the Forecast draws `capacityReservation` rows and nothing else), a "skip nonsense input" guard doesn't degrade gracefully — it erases the entity, and the erasure reads as any of five other failures (event bus down, filter bug, RLS, wrong week, stale registration).

**Rule:** In the scheduling engine, degenerate input never `continue`s past a persistence step — it emits the flagged placeholder shape (`isPlaceholder = true`, honest `workHours`, a `conflictReason` naming the DATA gap and its fix) so the entity stays visible and self-diagnosing. Match the unplaceable-op precedent; give the placeholder a nominal drawable window when true content is zero.

**Applies to:** `packages/planning/src/scheduling/batch-scheduler.ts`, `work-center-selector.ts` placeholder branches, and any future pre-pass/what-if that turns entities into reservations or timeline rows.

## Consume First is one rule for bought and made parts (2026-09-16)

```scope
id: consume-first-is-one-rule-for-bought-and-made-parts-2026-09
paths: ["packages/database/src/mrp-engine.ts","packages/planning/src/mrp/mrp.ts"]
triggers: ["consumeFirstRedirect","explodeBom","settleConsumeFirstLines","loadSupersessionRedirect","Consume First"]
```

- **Context:** the Consume First stock-netting was written for bought parts
  only, so a made predecessor always swapped to its successor, at job
  creation and in MRP.
- **Problem:** stocked old sub-assemblies were never used. The two "made"
  special cases were a workaround for where the netting lived, not a product
  decision.
- **Rule:** when a rule has a replenishment-specific exception, ask whether
  the exception is a product decision or an artefact of where the code sits.
  The rest (where MRP and job creation net Consume First) is in
  `.claude/rules/supersession-system.md`.
- **Applies to:** `packages/database/src/mrp-engine.ts` (`explodeBom`),
  `packages/planning/src/mrp/mrp.ts`, `settleConsumeFirstLines` /
  `loadSupersessionRedirect` in `apps/erp/app/modules/production/production.service.ts`.

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

## Fix a quantity rule in the view every reader shares

```scope
id: fix-a-quantity-rule-in-the-view-every-reader-shares
paths: ["packages/planning/src/mrp/**", "packages/planning/src/promising/**", "apps/erp/app/modules/items/ui/Item/ItemPlanningChart.tsx", "apps/erp/app/routes/api+/items.$id.$locationId.forecast.ts"]
triggers: ["openProductionOrders"]
```

**Context:** MRP counted a job's scrap allowance as supply, because `openProductionOrders.quantityToReceive` is `productionQuantity − received`.

**Problem:** The fix added a side read of `job` in `runMrp` and computed good units there. Available-to-promise, the buildable check and the item planning chart read the same view column, so they kept counting scrap and now disagreed with MRP.

**Rule:** Before you change what a number means, grep every reader of its source column (`grep -rn '"quantityToReceive"'` across the view's readers, TS and SQL). Fix it at the source, the view or RPC, so every reader gets the same value. A side read that corrects one consumer is a symptom fix: delete it once the source is right.

**Applies to:** `openProductionOrders` and the other planning views, `@carbon/planning` (`mrp/`, `promising/`), the item planning chart route.

## A new scheduler state must reach every output, and the last op is the test

```scope
id: a-new-scheduler-state-must-reach-every-output-and-the-last-o
paths: ["packages/planning/src/scheduling/work-center-selector.ts", "packages/planning/src/scheduling/scheduling-engine.ts", "packages/planning/src/scheduling/quote-lead-time.ts"]
triggers: ["applyWorkCenterSelections", "WorkCenterSelection"]
```

**Context:** An operation with no candidate work center used to vanish. The fix gave it a conflict and made its successors wait.

**Problem:** The live test put the op in the middle of a job, so the chain hid the gap. As the LAST op it has no placement and no reservation, so the job's projected completion, the lateness check and the quote lead time all ended at the op before it.

**Rule:** When the selector gains a new state, list every consumer of a selection (projected completion, newly-late, quote lead time, the Forecast, dispatch numbering, `applyWorkCenterSelections`) and decide each one. Test the op first, in the middle and last in its job.

**Applies to:** `scheduling/work-center-selector.ts`, `scheduling-engine.ts`, `quote-lead-time.ts`.

## A new output decides each field; it never passes a stored id through

```scope
id: a-new-output-decides-each-field-it-never-passes-a-stored-id
paths: ["packages/planning/src/scheduling/apply-work-center-selections.ts", "packages/planning/src/scheduling/priority-calculator.ts"]
triggers: ["WorkCenterSelection", "applyWorkCenterSelections"]
```

**Context:** A pinned outside-processing op started emitting a placement so it counts in the forecast.

**Problem:** The selection carried `op.workCenterId`, which can be a stale in-house machine. The op joined that machine's affected work centers and its dispatch numbering, shifting the real queue by one.

**Rule:** When code starts producing a record it did not produce before, set each field on purpose. For an id copied from storage, find every downstream reader of that field before passing it through.

**Applies to:** `WorkCenterSelection` producers, `applyWorkCenterSelections`, `priority-calculator.ts`.

## Order events from two processes with one clock

```scope
id: order-events-from-two-processes-with-one-clock
paths: []
triggers: ["scheduleOutdatedAt"]
```

**Context:** A schedule run clears only the stale marks stamped before it started.

**Problem:** The run's start came from the app server's clock and the mark from the job worker's clock. A few seconds of skew decided which marks were cleared.

**Rule:** When timestamps written by different processes are compared to order events, take both from the database (`now()` in SQL, or `SELECT now()` once at the start). Never compare `Date.now()` from one host with a timestamp another host wrote.

**Applies to:** `job.scheduleOutdatedAt` writers (MARK, nightly replan), schedule and MRP run starts, any cross-process "happened before" check.

## A save lock stops duplicates, not stale overwrites

```scope
id: a-save-lock-stops-duplicates-not-stale-overwrites
paths: ["packages/planning/src/mrp/mrp.ts", "packages/planning/src/scheduling/run-schedule.ts"]
triggers: ["runMrp", "runLocationSchedule"]
```

**Context:** MRP and the scheduler rebuild their output from scratch, and two runs can overlap.

**Problem:** An advisory lock at save time stopped double inserts. A run that read its inputs earlier could still save after a newer run, replacing the newer plan with an older one, and the newer run had already cleared the marks that would have replanned it.

**Rule:** For a delete-and-rewrite job, record when each run started reading (database clock). Under the save lock, skip the save when a run that started later has already saved, and record the start of each run that does save. Newest read wins.

**Applies to:** `runMrp`, `runLocationSchedule`, any regenerate-and-replace job.

## A stored value joins a candidate set only through the pool's own rule

```scope
id: a-stored-value-joins-a-candidate-set-only-through-the-pool-s
paths: ["packages/planning/src/scheduling/finite-context.ts", "packages/planning/src/scheduling/work-center-selector.ts", "apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx", "apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx", "apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx"]
triggers: ["isValidWorkCenter", "startedOperationWorkCenter", "workCenterForProcess"]
```

**Context:** The scheduler picks a work center from the process pool (active centers at the job's location) and falls back to the op's stored work center.

**Problem:** The capacity set took in every op's stored work center, from any location and whatever its process. So the fallback and the "started ops stay put" rule could book a machine at another plant, or one that does not run the process. A form that kept a stale hidden `workCenterId` after a process change fed it that data.

**Rule:** When a stored value can stand in for a computed choice, check it with the same predicate that built the choice (`isValidWorkCenter`), in one function every path calls. When a form field's options depend on another field, clear or re-check the dependent value when that field changes (`workCenterForProcess`).

**Applies to:** `finite-context.ts`, `work-center-selector.ts`, `startedOperationWorkCenter`, and the job, quote and make-method Bill of Process forms.

## Time without a resource still runs on a calendar

```scope
id: time-without-a-resource-still-runs-on-a-calendar
paths: ["packages/planning/src/scheduling/work-center-selector.ts", "packages/planning/src/scheduling/quote-lead-time.ts", "apps/erp/app/routes/x+/scheduling+/forecast.tsx"]
triggers: ["nonWorkingIntervalsByLane"]
```

**Context:** An op with no work center gets a placeholder so its successors and the job's finish wait for it.

**Problem:** Its work was added as continuous clock hours, so 40 hours ended in under two days, and the job read "early" when it was late. On the Forecast the same row was split at every night, like a machine's hours, so one op read as five.

**Rule:** Lay work with no resource on the location's working calendar (the one people with no shifts use). Draw a row that has no resource as one bar, with no non-working split of its own.

**Applies to:** `work-center-selector.ts` (the no-candidate branch), `quote-lead-time.ts`, `forecast.tsx` `nonWorkingIntervalsByLane`.

## A hold reserves every resource the work will use

```scope
id: a-hold-reserves-every-resource-the-work-will-use
paths: ["packages/planning/src/scheduling/run-overlay.ts", "packages/planning/src/scheduling/master-data-provider.ts"]
triggers: ["startedOperationHolds", "holdStartedOperations"]
```

**Context:** A started operation holds its machine before the scheduler places other jobs.

**Problem:** The hold reserved the machine but not the operator, and could land on a machine the op would not run on. An earlier job took the operator, so the running op waited and the held machine sat idle.

**Rule:** A reservation made on an op's behalf holds every finite resource the op will use (machine and operator), and only on the resource the placement will actually choose. Apply the selector's own eligibility rule rather than the stored value.

**Applies to:** `startedOperationHolds`, `holdStartedOperations`, any pre-pass that reserves ahead of placement.

## A lock held across a whole run hangs on a one-connection pool

```scope
id: a-lock-held-across-a-whole-run-hangs-on-a-one-connection-poo
paths: ["packages/planning/src/mrp/mrp.ts", "packages/planning/src/mrp/planned-order-write.ts", "packages/database/src/planning-lock.ts"]
triggers: ["lockCompanyPlanning", "retryOnPlannedOrderChange", "loadPlanAndWrite"]
```

- **Context:** An MRP run held a transaction advisory lock for its whole length, on one connection, so two runs of a company could not overlap.
- **Problem:** The run did its reads and writes on other connections while that one stayed checked out. On a pool of one connection (a database test), the run waited for a connection that its own lock held, and hung.
- **Rule:** Do not hold a lock across work that runs on other connections. Take the lock in the transaction that writes. Read a snapshot first, check it under the lock before the first write, and on a change roll back and try again (a bounded number of attempts, with a short random pause).
- **Applies to:** `runMrp` (`loadPlanAndWrite`, `retryOnPlannedOrderChange`), `lockCompanyPlanning`, and any job that coordinates through `pg_advisory_xact_lock`.

## A period list must come back sorted

```scope
id: a-period-list-must-come-back-sorted
paths: ["apps/erp/app/modules/shared/shared.service.ts", "packages/planning/src/mrp/mrp.ts"]
triggers: ["getOrCreatePeriods", "getOrCreateDemandPeriods"]
```

- **Context:** MRP and the planning pages read the weekly `period` rows for the window and create the missing ones.
- **Problem:** The read had no ORDER BY, and the weeks created were appended after the weeks read. Callers take week 1 by position, so a gap in the period table put a later week first.
- **Rule:** A function that returns a period list returns it sorted by start date, after any create. Never rely on the order a read or an insert happens to give.
- **Applies to:** `getOrCreatePeriods` (`shared.service.ts`), `getOrCreateDemandPeriods` (`packages/planning/src/mrp/mrp.ts`), any list a caller indexes by position.
