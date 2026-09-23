# Quote line lead time prediction (capable-to-promise)

**Status:** design resolved, awaiting veto
**Research:** `.ai/research/quote-lead-time-prediction.md`
**Plan:** `.ai/plans/2026-09-22-quote-lead-time-prediction.md`
**Related:** `.ai/specs/implemented/2026-08-12-forecast-first-finite-scheduling.md` §7
(names "capable-to-promise on a quote — inject a shadow job, run the sim, don't
persist" as the v1.x candidate); `.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md`
§4 (the rough-cut, plan-based what-if — a different, later layer).

## Problem

`quoteLinePrice.leadTime` (days, per quantity break) is typed by hand. Every
system-priced row seeds it at 0 (`sales.service.ts:4590/4684/4783`,
`functions/lib/methods.ts:861`), the finalize gate only warns when it is still 0
(`QuoteFinalizeModal.tsx:121-138`), and on conversion it becomes
`salesOrderLine.promisedDate = today + leadTime` (`convert/index.ts:696-701`),
which then becomes the job's due date. So the number that drives the customer
promise, the job deadline and MRP's demand date is a guess, made without looking
at the shop.

The shop's state is already known: the finite scheduler holds every open job's
`capacityReservation` rows, the work-center calendars, the manning board, and a
proven simulate-without-persist seam (`runExpediteWhatIf`). A quote line carries
a full routing (`quoteOperation` has the same time model as `jobOperation`) and
BOM (`quoteMakeMethod` / `quoteMaterial`). Nothing joins the two.

## Goal

From the quote line pricing grid, the estimator picks ONE constraint, sees the
answer it gives for every quantity break, and applies it to all of them at once.
A quote never mixes constraints across its breaks — a customer reading "10 pcs
in 12 days, 50 pcs in 9 days" would be looking at one row promised as best case
and another as queued. The three constraints:

| Answer | Question it answers | How |
|---|---|---|
| **End of queue** | If we order this today and it waits its turn behind everything already released, when is it done? | Forward-ASAP finite placement of the quote's routing against the LIVE reservation snapshot (`excludeJobIds: []`) |
| **Best case** | If we put it at the front of the line? | Same placement with the location's open jobs excluded from the snapshot (exactly what `runExpediteWhatIf` does for a job) |
| **Target date** | Can we hit the customer's date? | Compare both finishes with the entered date: on time as queued / only by expediting / not even then, with the days of slack or shortfall |

Every answer carries the bottleneck sentence the engine already composes
(conflict reason or the largest wait attribution), and the materials floor
(the longest purchased-material lead time that gates an operation) is reported
separately so an estimator can see whether the number is capacity-bound or
material-bound.

Nothing is persisted by the simulation. Applying writes `quoteLinePrice.leadTime`
for every quantity break in one state update plus one write per row (a new
`onUpdateLeadTimes` beside the grid's `onUpdatePrice`, which is single-cell and
snapshots state per call), so the preservation contract
(`resolvePreservedQuoteLinePriceFields`) and every downstream reader are untouched.
Under the target-date constraint the value written is the same for every break
(days from today to the date); the per-row verdict says whether the shop can
actually meet it, and applying is blocked while any break is not feasible.

## Design

### The simulation is the finite scheduler's pure core, fed synthetic operations

`SchedulingEngine.initialize()` reads a job by id and cannot take operations in.
But the placement core is already pure and test-driven with hand-built inputs:
`WorkCenterSelector.selectWorkCentersForOperations(operations, { jobDueDate })`
over an injected `FiniteSchedulingContext` (`determinism.test.ts`,
`envelope.test.ts`). The feature drives that seam:

1. **Load the quote line's routing** (`quoteMakeMethod`, `quoteMaterial`,
   `quoteOperation` for the line, under `companyId`) with Kysely.
2. **Build synthetic `BaseOperation`s per quantity break.** `operationQuantity` =
   quantity × the product of `quoteMaterial.quantity` down the make-method chain
   (the same walk `buildCostEffects` does for costing). `quantityComplete = 0`,
   `jobId = "quote:<quoteLineId>:<quantity>"`, ids are the `quoteOperation` ids.
   Durations then come from the engine's own `calculateDurationHours`
   (`setup + max(labor, machine)`, per-piece units scaled by quantity, `Total
   Hours` fixed per run) — one duration model for jobs and quotes.
3. **Build dependencies** exactly as `createDependencies` does for a job:
   `buildOperationDependencies` inside each make method ("After Previous" /
   "With Previous"), plus the assembly edge from a child method's last operation
   to the parent's consuming operation (`quoteMaterial.quoteOperationId` of the
   material whose id is the child's `parentMaterialId`, else the parent's first
   operation).
4. **Build the finite context once per scenario** from the location-wide reads
   (`buildFiniteContext`, lifted out of the engine into a shared module so the
   engine and the quote what-if cannot drift). Two scenarios: live snapshot
   (`excludeJobIds: []`) and front-of-queue (`excludeJobIds` = the location's
   ordered open-job batch, mirroring `runExpediteWhatIf`). Released batches keep
   their reservations in both, as they do for the expedite what-if.
5. **Place, once per (quantity, scenario)**, on a cloned context — the selector
   mutates reservation arrays as it places, so every run gets fresh copies.
   Projected finish = the max placed end. Lead time = calendar days from today
   to the finish, both in the location's timezone, minimum 1.
6. **Report**, never persist.

### Material readiness is a per-operation floor, not a separate number

A purchased part gates the operation that consumes it, and only that operation:
downstream ops shift, parallel branches do not. The engine has no such floor
today (jobs assume material is on hand). This spec adds an **optional**
`materialReadyAt` (epoch ms) on `BaseOperation`, honored at the two
earliest-start sites in `work-center-selector.ts` as
`earliestMs = max(earliestMs, op.materialReadyAt)`. The job path never sets it,
so live scheduling is byte-identical (pinned by the determinism suite).

For the quote: a `Purchase to Order` material floors its consuming op at
`now + itemReplenishment.leadTime` days (default 7, the same fallback MRP uses);
a `Pull from Inventory` material floors it only when `itemStockQuantities`
on-hand at the location is below the required quantity (the same aggregate
`runMrp` reads at `mrp.ts:277`); a `Make to Order` material is a child make
method and is scheduled, not floored. `materialReadyDays` in the result is the
largest floor, so the modal can say "materials gate this at N days" next to
the capacity answer.

### Where it lives

- `packages/planning/src/scheduling/finite-context.ts` — `buildFiniteContext`
  and `loadAvailabilityWindows` extracted from `scheduling-engine.ts` into a
  standalone function the engine delegates to. Refactor only; no behavior change.
- `packages/planning/src/scheduling/quote-lead-time.ts` — the pure builders
  (`buildQuoteSimulation`: quote rows → operations + dependencies + material
  floors per quantity), `cloneFiniteContext`, and the orchestrator
  `runQuoteLeadTimeWhatIf`. Exported from `@carbon/planning` next to
  `runExpediteWhatIf`.
- `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.lead-time.tsx` — POST action,
  `view: "sales"` (read-only what-if, same reasoning as `$jobId.expedite.tsx`),
  re-reads the quote under `companyId`, resolves the location, calls the
  what-if, returns `{ forecast }`.
- `apps/erp/app/modules/sales/ui/Quotes/QuoteLeadTimeModal.tsx` — precedent
  `JobExpediteModal` in `JobHeader.tsx`; opened from a button on the "Lead Time"
  row of `QuoteLinePricing.tsx`; applies a chosen value through the existing
  `onUpdatePrice("leadTime", quantity, days)`.

### Result shape

```ts
type QuoteLeadTimeScenario = {
  finishAt: string | null;      // ISO instant of the last placed end
  leadTimeDays: number | null;  // calendar days from today (location tz), min 1
  cause: string | null;         // first conflict, else the longest wait's note
};
type QuoteLeadTimeForecast = {
  quoteLineId: string;
  locationId: string;
  computedAt: string;
  quantities: Array<{
    quantity: number;
    materialReadyDays: number;          // 0 when nothing gates
    queued: QuoteLeadTimeScenario;      // end of queue
    bestCase: QuoteLeadTimeScenario;    // front of queue
    target: {                            // present only when a dueDate was sent
      date: string;                      // YYYY-MM-DD
      verdict: "on-time" | "expedite" | "late";
      slackDays: number;                 // negative = short, vs the queued finish
    } | null;
  }>;
  assumptions: string[];   // rendered verbatim in the modal
};
```

`assumptions` is fixed copy from the engine, e.g. "Placed after every job
already released at {location}", "Purchased material is available after its
item lead time; stock is netted at {location} only", "No shipping buffer is
added" — the number must not silently become a guarantee (the same rule the
MRP v2 spec applies to its plan-based promise).

## Decisions (recommendations applied; veto any)

| Decision | Choice | Why |
|---|---|---|
| Engine seam | Drive `WorkCenterSelector` directly with synthetic ops; do not teach `SchedulingEngine` to accept a fake job | `initialize`/`assignMaterials`/`createDependencies` read job tables with raw Kysely; faking a job means faking four tables. The selector is already the pure, tested unit. |
| Shared context builder | Extract `buildFiniteContext` from the engine into `finite-context.ts` | Two copies of a 220-line loader would drift on the next people-board or calendar change; the determinism suite pins the extraction. |
| Material floor | Optional per-op `materialReadyAt` in the selector, unset for jobs | Floors belong on the consuming op, and the change is invisible to live scheduling. A separate "max material lead time" number would be wrong for any routing with work before the purchased part is needed. |
| Unit of the answer | Calendar days from today, location timezone, minimum 1 | `convert` turns `leadTime` into `promisedDate = today + N`, so calendar days is the only unit that round-trips; finalize treats 0 as unfilled. |
| Modes | End of queue + best case, plus a target-date verdict; no "infinite capacity" mode | Infinite capacity is what the manual guess already is. Best case is the expedite what-if the shop already trusts. |
| Persistence | None from the sim; accept writes `leadTime` via `onUpdatePrice` | Zero migration, zero new preservation cases. A `leadTimeSource` column (mirroring `priceSource`) is a follow-up if provenance is wanted. |
| Apply granularity | One constraint, applied to every quantity break together; no per-cell accept | A quote's breaks must be promised on the same basis. Per-cell buttons invite mixing best case on one row with queued on another. (Brad, 2026-09-22) |
| Trigger | Manual button on the Lead Time row, not auto-fill on price recalc | Recalc runs on every markup change; a sim per recalc would be wasted work and a moving number under the estimator's cursor. |
| Location | `quote.locationId`, else the user's default location, else a clear error | The reservation snapshot, calendars and stock are per location; there is no company-wide answer. |
| Shipping / safety buffer | None in v1 | No company setting exists for it; adding one is a separate decision. The modal says so in `assumptions`. |
| Scope of routing | Every make method in the quote line's tree, including sub-assemblies | Sub-assembly edges are the same as the job engine's; omitting them would under-promise every assembly. |
| Outside processing | Placed as the engine places it (calendar time from `operationLeadTime`) | Same code path, no special case. |
| Scenario reservations | Not written (`capacityReservation.scenarioId` stays unused) | Nothing reads scenarios yet; writing them buys a Gantt overlay nobody asked for. |

## Out of scope

- Auto-filling `leadTime` on quote creation or price recalculation.
- Quote-time capacity reservations (soft booking) and their expiry.
- A `leadTimeSource` / provenance column on `quoteLinePrice`.
- Customer share page or PDF changes — they already render `leadTime`.
- Working-day (vs calendar-day) conversion of the customer-facing number.
- The MRP v2 plan-based what-if (`runPlanningWhatIf`) — a different layer.
- Ability-gated labor for the quote's ops beyond what the context already
  models (the sim uses the same gating the job engine does; no extra work).

## Risks

- **Quotes with no times.** An operation with zero time standards places
  instantly; a routing of only zeros yields "1 day". The modal shows the
  operation count with zero standards so the estimator knows the number is
  hollow. (Task 5 renders `assumptions` and the zero-standard count.)
- **Quote location without calendars.** The ladder falls back to the stock
  Mon–Fri 8h week, as it does for jobs.
- **Cost.** One context build per scenario (two per request) plus one pure
  placement per (quantity × scenario); the envelope test places 2000 ops in
  under 10 s, a quote routing is tens of ops.
