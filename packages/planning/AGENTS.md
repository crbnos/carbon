# @carbon/planning

Community-licensed (AGPLv3) Material Planning engines: **MRP** (Material
Requirements Planning) and **finite scheduling** (the job scheduler). Both run
**in-process in Node**, inside the ERP or the Inngest worker that calls them. This package
was carved out of `@carbon/ee` so that Material Planning (Purchasing + Production
planning screens) and the scheduler are free — no free user runs Enterprise code
to plan materials.

## Always

- MUST be **dependency-injected**: every entry point takes a caller-created
  `Kysely` handle (and, for MRP, a service-role Supabase client). The caller
  authenticates first; this package never constructs a DB client.
- MUST be imported only from server contexts — route actions, `*.service.ts`,
  `*.server.ts`, or `@carbon/jobs` handlers. **Server-only**: it pulls in
  `pg`/Kysely, so it must never reach a browser bundle.
- MUST reach shared DB logic through `@carbon/database` subpath barrels
  (types → `@carbon/database`, postgres → `@carbon/database/client`,
  `explodeBom` → `@carbon/database/mrp-engine`, the company planning lock →
  `@carbon/database/planning-lock`, plus `./methods`, `./fetch-all`,
  `./supersession-pick`). Date/time math comes from
  `@carbon/utils` (`datetime`); logging from `@carbon/logger`
  (`getLogger("planning", "mrp" | "schedule")`).

## Never

- Never add an entitlement/plan gate here. This is CE — Material Planning is
  ungated. The one exception is the commercial planning groups degrade
  (Projects Phase 3), and it is INJECTED: `runMrp(client, db, payload, deps?)`
  takes `MrpDeps` — `companyHasPlanningGroups` (the `companyHasFeature`
  check) and `writeGroupPegs`. The check runs only for a company that has a
  planning group. Without `deps`, or without `PLANNING_GROUPS`, the members
  net in their own segments and no peg is written. The pegging code itself is
  commercial and stays in `@carbon/ee`. Never copy it here.
- Never import a `.server` module, not even lazily with `await import()`.
  The ERP client graph reaches this package (`production.service.ts`
  imports it), and the React Router build fails with
  "Server-only module referenced by client". Only the client-safe
  `@carbon/ee/pegging` (pure functions, `WriteGroupPegs` type) is allowed.
  Every server-side `runMrp` caller passes `planningGroupMrpDeps`
  (`@carbon/ee/pegging.server`): the ERP's `runMRP`
  (`production.service.ts`, which every ERP caller reaches MRP through), the jobs MRP cron, and `planDemoCompany`
  (which loads it lazily, because under plain tsx `@carbon/auth` does not
  load and the run then degrades). Verify with `pnpm --filter erp build`.
- Never construct a connection/pool inside this package.

## Validation Commands

```bash
pnpm --filter @carbon/planning test
pnpm --filter @carbon/planning typecheck
```

## Key Exports

Single subpath `@carbon/planning` (`./src/index.ts`):

| Export | Provides |
|--------|----------|
| `runMrp(client, db, payload, deps?)` | Material Requirements Planning (`src/mrp/mrp.ts`: each attempt is `loadMrpInputs` → `planCompany` → `writeMrpPlan(trx, …)` → `generatePlanningActions`); `deps` (`MrpDeps`) is the injected planning groups degrade (Never, above) |
| `runLocationSchedule` / `runExpediteWhatIf` | Finite scheduling — regenerate a whole location, or a simulate-only expedite what-if (`src/scheduling/run-schedule.ts`) |
| `runQuoteLeadTimeWhatIf(params)` | Capable-to-promise for a quote line — drives the pure `WorkCenterSelector` with synthetic ops (queued vs front-of-queue contexts) per quantity, returns `QuoteLeadTimeForecast`; persists nothing (`src/scheduling/quote-lead-time.ts`). An optional `routing` (`QuoteLineRouting`) replaces the quote-table read, so a sales order line runs it on its item's own routing |
| `checkDeliveryDates(args)` / `decideDeliveryDate(input)` | The sales order line delivery date check (`src/promising/`): the fence is the item's cumulative lead time through its active BOM (`cumulative-lead-time.ts`); inside it, free stock by week — cumulative ATP with look-ahead, dated as MRP dates its live supply and demand (`available-to-promise.ts`) — and, at the Capacity level, `runQuoteLeadTimeWhatIf` on `loadItemRouting` (`item-routing.ts`). `decideDeliveryDate` is the pure decision. Writes nothing; the ERP stores the result (spec `.ai/specs/2026-11-10-sales-order-delivery-date-check.md`) |
| `loadBuildable(db, args)` / `computeBuildable(args)` | How many of an item a location can make now through every BOM level, and what limits it (`src/promising/buildable.ts`): low-level-code netting so a shared component nets once, a doubling + binary search for the max, each bought component's solo limit. Scrap is added per line as `computeJobQuantities` adds it; a Make to Order line builds its subassembly instead of drawing its stock, as a job does. A BOM line whose unit differs from its item's stock unit (`unitMismatches`) or a BOM cycle (`cycleItems`) nulls the quantities rather than guess. Available = on hand − non-nettable − committed (common-segment open demand MRP nets). The answer is what more can be started. Beside it are the item's own open jobs at the location and whether stock covers what each still has to issue. `loadOpenJobs` reads `job`, not `openProductionOrders` (which leaves out a job made for a sales order): the four open statuses, common-segment materials only, good units left = quantity − received − shipped. A job with a material in another unit than its item's stock gets no verdict (`hasAllParts` null). For the others `coverJobs` (`src/promising/buildable-jobs.ts`, pure) gives stock (on hand less what other demand committed) first to every job it covers in full, the most urgent first, then records what the other jobs lack (`jobs`, `jobShortages`, `quantityReadyToFinish`, `quantityWaitingOnParts`). A job material is drawn from stock, so a short item is listed to make (replenishment Make) or to buy (anything else, as MRP plans Buy and Make), not exploded. The BOM comes from `loadActiveBomLines` (`active-bom.ts`), which the cumulative lead time shares. Writes nothing |
| `resolveLocationWindows` / `resolveWorkCenterWindows` / `subtractIntervals` | Machine/work-center availability window resolvers (`src/scheduling/`) |
| `closeHolidays` / `downtimeOutages` | The engine's holiday closing and open-maintenance outages, so the ERP's Capacity and Coverage views read the same working time (`src/scheduling/machine-availability.ts`) |
| `remainingWorkHours` | The hours an open operation still needs, as the engine counts them: setup + max(labor, machine), netted by quantity complete, setup dropped once it has a production event (`src/scheduling/duration-calculator.ts`) |
| `SCHEDULING_HORIZON_DAYS` | How far ahead the engine places work (`src/scheduling/finite-context.ts`) |
| types (`LadderShiftRow`, `MrpPayload`, `MrpResult`, `LocationScheduleResult`, `ExpediteWhatIfResult`, `NewlyLateJob`, …) | Engine type surface |

`runMrp` keeps the loads and the Phase-7 writes. The pure core between them is
`planCompany(inputs)` (`src/mrp/plan-company.ts`, Phases 3–6, no I/O), which also returns
`commonSurplusDraws` — what each project netting segment takes from the common segment's
true surplus. **Golden test:** `plan-company.test.ts` snapshots `planCompany` on
`__fixtures__/plan-company.basic.json`, a company with no project stock. Never edit that
snapshot to make a test pass; a change there means the change broke the "no project stock,
identical output" invariant. `plan-company.project.json` pins the segment spec case.
`planCompany` also takes `plannedOrderInputs` (MRP v2 Phase 2a) and returns `plannedOrders`,
`heldPlannedOrderIds`, `plannedOrderSignals`, `plannedOrderChangeActions`, `newSupplyByRow` and
`documentChangeActionsByRow` (the engine's change actions on each planned row's open jobs and PO lines, sized with
the held planned orders as supply).
Without the input it plans exactly as before (the golden test runs without it).
Netting segments (`planningSegmentId`, `''` = common) are described in
`.claude/rules/mrp-system.md` → *Project netting segments*. `planCompany` also returns
`groupPegInputs`, one per (planning group, item, location), which is empty for a company
with no group (the golden test asserts it). Planning groups and pegging are in
`.claude/rules/mrp-system.md` → *Planning groups and pegging*.

**Planned orders (MRP v2 Phase 2a)** — internal modules, rule `.claude/rules/mrp-system.md` →
*Planned orders*:

| File | Holds |
|------|-------|
| `src/mrp/planned-orders.ts` | `createPlanSupply(inputs)` (pure): the `planSupply` hook `explodeBom` calls per eligible common key, `extraPlanningKeys`, and the accumulated `result()`; `plannedOrderNaturalKey`; `withPlannedOrderIds`; the input/output types (`PlannedOrderInputs`, `GeneratedPlannedOrder`, `PlannedOrderSignal`, …). Every planned order still to convert — each new one and each held one MRP does not Cancel — is one Order / Make in `newSupplyByRow`, naming it by `plannedOrderKey` and (held, or new once written) `plannedOrderId`; the worklist sums them per type and week into one action that names none |
| `src/mrp/row-sizing.ts` | `sizeRowSupply` — the new-supply sizing of one row, shared by the engine hook and `deriveRowActions` — with `deriveChangeActions`, `convertOrdersToIncreases`, `projectionsWithExpedites`, `isOrderFrozen` (never a planned order), `planningPolicyRowOf` (the one null → 0 coercion of the policy columns, for an RPC row and for `loadPlannedOrderInputs`), and the date helpers: `daysBetween`, `addDays`, `weekIndexOn` (the week holding a date, clamped to the first and last week) and `weekIndexInHorizon` (null past the last week) |
| `src/mrp/planned-order-inputs.ts` | `loadPlannedOrderInputs(db, …)` — the Kysely reads of `PlannedOrderInputs` (policy rows through `planningPolicyRowOf`, fences, scrap rates, open supply); the existing planned orders come from the run's snapshot |
| `src/mrp/open-supply-orders.ts` | `buildOpenSupplyOrders` (pure): open PO lines and jobs as `OpenSupplyOrder`s, with `releaseByDate`, `earlierRelease`, `itemLocationSegmentKey` |
| `src/mrp/planned-order-write.ts` | `diffPlannedOrders` (pure) and `writePlannedOrderDiff(trx, …)` — the first write of `runMrp`'s Phase-7 transaction, after the `mrp:` lock and the newest-run check; takes the planning lock, then, given the run's `snapshot`, throws `PlannedOrdersChangedError` before any write when `plannedOrdersChangedSince` (pure) sees a change; never touches Firm / Converted / held rows. `assertPlannedOrdersUnchanged` is that check. `readPlannedOrderSnapshot(db, companyId, { withOrders }?)` is the one snapshot reader (the database's `now()`, then the Planned and Firm rows): FIRST in each attempt with `withOrders` (also the plan's `ExistingPlannedOrder`s), and at the end of the Phase-7 transaction for what the run committed, which `writePlanningActions` checks against. `retryOnPlannedOrderChange(attempt, { maxAttempts?, pause? })` re-runs `runMrp`'s load → plan → write → worklist up to `MAX_PLAN_ATTEMPTS` (5) times in all, with a random pause of up to `MAX_RETRY_PAUSE_MS` (250 ms) between attempts so overlapping runs stop retrying in step (`pause` replaces it in tests) |
| `src/mrp/planning-action-write.ts` | the worklist's write: `naturalKey` / `keyPeriodFor`, `diffPlanningActions` (pure), `groupPatchUpdates`, `writePlanningActionDiff(trx, …)`, `writePlanningActions(db, …)` (the transaction under the planning lock; it drops a candidate whose job, PO line or planned order is gone, read `FOR KEY SHARE` — `withLiveTargets`), `writePegs` / `withPlannedPegSupplies` |
| `src/mrp/row-actions.ts` | one row's actions (pure): `deriveRowActions` (its `engine` field replaces the RPC row's sizing for a row the engine planned), `deriveReleaseActions`, `plannedOrderActions`, `onePerPlannedOrder` |
| `src/mrp/json-equals.ts` | `jsonEquals` — key-order-free jsonb equality, shared by both diff-writes |
| `src/mrp/planning-action-types.ts` | the shared action types (`PlanningActionCandidate`, `OpenSupplyOrder` with `plannedOrderId`, `ChangeCandidate`) |

`lockCompanyPlanning(trx, companyId)` (`@carbon/database/planning-lock`) is the one per-company advisory lock
(`planning-actions:<companyId>`) every planned-order and planning-action writer takes first, the
ERP's settle / convert / firm / edit / apply included. The module exports only it and `planningLockKey`. Nothing
locks a whole MRP run: a lock held on one connection while the run worked on others hung a run on a one-connection
pool. Runs and a person's changes may overlap; each run's two writes (the Phase-7 transaction and the worklist) take
the planning lock and check the planned orders against the run's snapshot first, and an attempt that sees a change
plans again (`retryOnPlannedOrderChange`). `runMrp` reads the planned orders FIRST
(`readPlannedOrderSnapshot` with `withOrders`: the database's `now()`, then the Planned and Firm rows), then the
other inputs (`loadPlannedOrderInputs`, Kysely), and passes the engine's planned-order outputs to
`generatePlanningActions` as one `plannedOrders` argument. The time fence is `@carbon/utils` `resolvePlanningTimeFenceDays` /
`isPlannedOrderHeld`, shared with the planning drawers.

Internal to the engine, not exported: `newestRunSaves` / `databaseNow` / `lastSavedMrpRunStartedAt`
(`src/run-order.ts`, shared by MRP and the scheduler — newest read wins: an attempt that started before the last saved
run (`companySettings.lastMrpRunStartedAt`, database clock, read under the `mrp:<companyId>` lock its Phase-7
transaction takes before the planning lock) saves nothing and `runMrp` returns `skipped: true`; each retry attempt
reads the clock again with its inputs), `generatePlanningActions(client, db, { companyId, userId, runStartedAt, commonSurplusDraws, planningGroups?, pegging?, plannedOrders?: { newSupplyByRow, documentChangeActionsByRow, changeActions, signals, idByKey, heldIds, snapshot } })`
(`src/mrp/planning-actions.ts`, the reads and the orchestration — the planning action messages, Order / Make / Expedite / Defer /
Increase / Decrease / Cancel / Release / Transfer, one row's set computed by the pure
`deriveRowActions` (`row-actions.ts`; a project segment is lot-for-lot; each draw is a Transfer; a row the engine planned takes its Order / Make from `newSupplyByRow` and its change actions on jobs and PO lines from `documentChangeActionsByRow`, so both come from one sizing that counts held planned orders; `plannedOrderActions` adds the change actions on held planned orders and the fence Expedites), diff-written to `planningAction` in one transaction that holds a
per-company `pg_advisory_xact_lock` across the read and the write (`writePlanningActions`, `planning-action-write.ts`), which first checks the
planned orders against the Phase-7 write's committed snapshot; `runMrp` calls it after its
Phase-7 commit, inside the same retried attempt. With `pegging` (PLANNING_GROUPS only), `memberMoveCandidates` first adds
member Transfer and Borrow actions, and after the action diff the same transaction runs
`writePegs`, which maps planned supply to action ids and calls `writeGroupPegs`), `loadResponsibleEmployeeResolver(db, companyId)` / `resolveResponsibleEmployee(rungs)`
(`src/mrp/responsible-employee.ts` — who owns an item + location's actions: the segment
project's manager (project segments only) → item → location item group → location → company
default, first non-null wins), `consumeForecast` (`src/mrp/forecast-consumption.ts` —
actual demand consumes the demand projection in its own week, then backward, then forward,
per the company's consumption window; the consumed amount is persisted on
`demandProjection.consumedQuantity`), and `purchaseOrderLineArrivalDate` / `jobCompletionDate`
(`src/mrp/supply-date.ts` — when an open PO line arrives: promised date, else required
date, else order date (today when unset) + lead time; when a job completes: due date, else
today + 30 for No Deadline, else today — shared by the projection and the action generator).

## Consumers

- `@carbon/jobs` — `scheduled/mrp.ts` (`runMrp`), `tasks/recalculate.ts` &
  `scheduled/schedule-inputs-changed.ts` (`runLocationSchedule`).
- `apps/erp` — `production.service.ts` (dynamic imports of `runMrp` /
  `runLocationSchedule` / `runExpediteWhatIf`), `forecast.server.ts`,
  `routes/api+/schedule.ts`, `routes/api+/kanban.$id.tsx`,
  `routes/x+/job+/$jobId.status.tsx`.

## Cross-References

- `.claude/rules/mrp-system.md` — MRP run flow and engine internals.
- `.claude/rules/scheduling-data-structures.md` — finite scheduling data model.
- `.claude/rules/supersession-system.md` — supersession redirects MRP consumes.
- `packages/database/AGENTS.md` — the `@carbon/database` subpath barrels this
  engine depends on (`./mrp-engine`, `./client`, `./methods`, …).
