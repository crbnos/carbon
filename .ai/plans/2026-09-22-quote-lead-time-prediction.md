# Quote line lead time prediction — implementation plan

**Spec:** .ai/specs/2026-09-22-quote-lead-time-prediction.md
**Research:** .ai/research/quote-lead-time-prediction.md
**Branch:** nukualofa

Read first: `.claude/rules/scheduling-data-structures.md`, `packages/planning/AGENTS.md`,
`apps/erp/app/modules/sales/AGENTS.md`, `.claude/rules/date-handling.md`,
`.claude/rules/numeric-precision.md`, `.ai/lessons.md` (entry "Kysely returns NUMERIC
as a string", ~line 1011 — `quoteOperation` times and `quoteMaterial.quantity` arrive
as strings through Kysely; coerce with `Number(...)` at the loader boundary).

## Progress
- [x] Task 1: Add an optional `materialReadyAt` floor to finite placement
- [x] Task 2: Extract `buildFiniteContext` into `finite-context.ts`
- [x] Task 3: Pure quote-simulation builders + tests
- [x] Task 4: `runQuoteLeadTimeWhatIf` orchestrator + package export (DB smoke deferred to Task 8 — stack not up)
- [x] Task 5: ERP route, validator and path
- [x] Task 6: `QuoteLeadTimeModal` + button on the pricing grid
- [x] Task 7: Translations, docs
- [ ] Task 8: Browser verification — BLOCKED: no dev stack booted for this worktree
      (no `.env.local`; only shared postgres+redis up). Needs `crbn up` + a
      satellite quote line with a routing. Confirm before booting (shared local
      ports may collide with other worktrees).

## Dependencies
Task 2 needs Task 1 (same file region, avoid conflicts). Task 3 needs Task 1 (the
`materialReadyAt` field). Task 4 needs Tasks 2 and 3. Task 5 needs Task 4. Task 6
needs Task 5. Tasks 7–8 need Task 6. Tasks 1 and 3 could be done in parallel if Task 3
adds the type field itself; simpler to run in order.

---

## Task 1: Add an optional `materialReadyAt` floor to finite placement

**Depends on:** none
**Files:**
- Modify: `packages/planning/src/scheduling/types.ts` — add the field to `BaseOperation`
- Modify: `packages/planning/src/scheduling/work-center-selector.ts` — honor it at both earliest-start sites
- Modify: `packages/planning/src/scheduling/work-center-selector.test.ts` — one new test

**Steps:**
1. In `types.ts`, inside `BaseOperation` (L30-74) add, after `operationLeadTime?`:
   ```ts
   /**
    * Earliest instant this op's material is available (epoch ms). Only set by
    * the quote lead-time what-if for ops that consume a purchased part; never
    * set on job operations, so live scheduling is unchanged.
    */
   materialReadyAt?: number;
   ```
   `ScheduledOperation` extends `BaseOperation` (L120-137), so it inherits the field.
2. In `work-center-selector.ts`, the regular-op earliest-start block (~L527-537,
   `let earliestMs = ctx.now; let dominantDepId ...`): after the dependency loop and
   before `const earliestStart = earliestMs;` add
   ```ts
   if (op.materialReadyAt !== undefined && op.materialReadyAt > earliestMs) {
     earliestMs = op.materialReadyAt;
     dominantDepId = null;
   }
   ```
3. In the Outside Processing branch (~L419-445, `let earliestMs = ctx.now;` followed by
   the `op.startDate` and dependency loop): after the dependency loop add
   ```ts
   if (op.materialReadyAt !== undefined) {
     earliestMs = Math.max(earliestMs, op.materialReadyAt);
   }
   ```
4. In `work-center-selector.test.ts`, copy the smallest existing single-op placement
   test (the one around L112 that builds one op and asserts `placedStart`) and add a
   test "materialReadyAt floors the placement": same fixture, set
   `materialReadyAt = ctx.now + 3 * 24 * 3_600_000`, assert the planned reservation's
   `startAt >= materialReadyAt`. Add a second assertion in the same test that an op
   WITHOUT the field places at the same instant as before (run the fixture twice).

**Verify:**
```bash
pnpm --filter @carbon/planning test
# Expected: all suites pass, including determinism.test.ts and the new test
pnpm exec turbo run typecheck --filter=@carbon/planning
# Expected: no errors
```

**Out of scope:** anything reading `materialReadyAt` on the job path; `need-by-calculator.ts`.

---

## Task 2: Extract `buildFiniteContext` into `finite-context.ts`

**Depends on:** Task 1
**Files:**
- Create: `packages/planning/src/scheduling/finite-context.ts`
- Modify: `packages/planning/src/scheduling/scheduling-engine.ts` — delegate `loadAvailabilityWindows` (L558-616) and `buildFiniteContext` (L673-897) to the new module

**Steps:**
1. Create `finite-context.ts` exporting:
   ```ts
   export type AvailabilityWindows = {
     workCenterIds: Set<string>;
     workCenterAvailability: Map<string, CalendarWindow[]>;
     locationDefaultWindows: CalendarWindow[];
     rangeStart: number;
     rangeEnd: number;
   };

   export async function loadAvailabilityWindows(args: {
     provider: MasterDataProvider;
     workCenterSelector: WorkCenterSelector;
     operations: ScheduledOperation[];
     locationId: string | null;
     now: number;
   }): Promise<AvailabilityWindows>;

   export async function buildFiniteContext(args: {
     provider: MasterDataProvider;
     operations: ScheduledOperation[];
     dependencies: JobOperationDependency[];
     availability: AvailabilityWindows;
     locationId: string | null;
     timeZone: string;
     now: number;
     excludeJobIds: string[];
   }): Promise<FiniteSchedulingContext>;
   ```
   Move the bodies verbatim from the engine. Replace `this.provider` → `provider`,
   `this.now` → `now`, `this.excludeJobIds` → `excludeJobIds`,
   `this.job?.locationId` → `locationId`, `this.timezone` / `this.job?.timezone ?? "UTC"`
   → `timeZone`, `this.dependencies` → `dependencies`,
   `Array.from(this.scheduledOperations.values())` → `operations`,
   `this.workCenterSelector?.getAllCandidateWorkCenterIds(...)` →
   `workCenterSelector.getAllCandidateWorkCenterIds(...)`. Keep every comment.
   Move the helper imports the bodies use (`expandCalendar`, `unionWindows`,
   `buildAbsencesByEmployee`, `subtractAbsences`, `buildPeopleByWorkCenter`,
   `buildAssignmentsByEmployee`, `buildOvertimeByEmployee`, `extendWindowsByOvertime`,
   `buildPeopleBudgets`, `SCHEDULING_HORIZON_DAYS`) — export `SCHEDULING_HORIZON_DAYS`
   from `finite-context.ts` and re-import it in the engine if it is currently defined
   in the engine (L81).
2. In the engine, keep the private methods as thin wrappers so no caller changes:
   `loadAvailabilityWindows()` memoizes on `this.availabilityWindows` and calls the
   new function; `buildFiniteContext()` returns `null` when `this.workCenterSelector`
   is null, else awaits the windows and calls the new function. The need-by pass
   (`computeNeedBys`, L625) keeps using `this.loadAvailabilityWindows()`.
3. Do not change `selectWorkCenters()` or anything after it.

**Verify:**
```bash
pnpm --filter @carbon/planning test
# Expected: every suite passes with no fixture edits — determinism.test.ts,
# envelope.test.ts, batch-scheduler.test.ts, work-center-selector.test.ts
pnpm exec turbo run typecheck --filter=@carbon/planning
# Expected: no errors
git diff --stat packages/planning/src/scheduling/scheduling-engine.ts
# Expected: the file shrinks by roughly 250 lines; no other engine file changes
```

**Out of scope:** changing what the context contains; touching `run-schedule.ts`.

---

## Task 3: Pure quote-simulation builders + tests

**Depends on:** Task 1
**Files:**
- Create: `packages/planning/src/scheduling/quote-lead-time.ts` (builders only in this task)
- Create: `packages/planning/src/scheduling/quote-lead-time.test.ts`
- Copy from (precedent): `scheduling-engine.ts` `createDependencies` (L332-420) for the dependency walk; `envelope.test.ts` `makeOperations` (L35-70) for hand-built ops in tests

**Steps:**
1. Define the input row types (plain objects, already `Number()`-coerced by the loader in Task 4):
   ```ts
   export type QuoteMakeMethodRow = { id: string; parentMaterialId: string | null };
   export type QuoteMaterialRow = {
     id: string; quoteMakeMethodId: string; itemId: string;
     methodType: "Purchase to Order" | "Pull from Inventory" | "Make to Order";
     quantity: number;                    // per parent unit
     quoteOperationId: string | null;     // consuming op
   };
   export type QuoteOperationRow = {
     id: string; quoteMakeMethodId: string; processId: string | null;
     workCenterId: string | null; order: number;
     operationOrder: "After Previous" | "With Previous";
     operationType: string | null; description: string | null;
     setupTime: number; setupUnit: string; laborTime: number; laborUnit: string;
     machineTime: number; machineUnit: string; operationLeadTime: number;
   };
   export type MaterialAvailability = {
     leadTimeDaysByItem: Map<string, number>;   // itemReplenishment.leadTime, default 7
     onHandByItem: Map<string, number>;         // itemStockQuantities at the location
   };
   ```
2. Export the pure builder:
   ```ts
   export function buildQuoteSimulation(args: {
     quoteLineId: string;
     quantity: number;
     makeMethods: QuoteMakeMethodRow[];
     materials: QuoteMaterialRow[];
     operations: QuoteOperationRow[];
     availability: MaterialAvailability;
     now: number;            // epoch ms
   }): {
     jobId: string;                              // `quote:${quoteLineId}:${quantity}`
     operations: BaseOperation[];
     dependencies: JobOperationDependency[];     // { operationId, dependsOnId, jobId }
     materialReadyDays: number;                  // max floor in whole days, 0 if none
     zeroStandardOperationCount: number;         // ops whose three times are all 0
   }
   ```
   Algorithm:
   - Root method = the one with `parentMaterialId === null`. Multiplier of the root = 1.
     For every other method, its `parentMaterialId` names a `QuoteMaterialRow`; the
     method's multiplier = multiplier(material.quoteMakeMethodId's method) ×
     `material.quantity`. Walk parents-first (a loop that resolves any method whose
     parent is resolved, until no progress; a method whose parent never resolves is
     dropped).
   - For each operation: `operationQuantity = quantity × multiplier(method)`,
     `quantityComplete: 0`, `jobId`, `jobMakeMethodId: op.quoteMakeMethodId`,
     `status: "Todo"`, copy `processId, workCenterId, order, operationOrder,
     operationType, description, setupTime/Unit, laborTime/Unit, machineTime/Unit,
     operationLeadTime`.
   - Dependencies: per method `buildOperationDependencies(methodOps)` (from
     `dependency-manager.ts`); for each non-root method, add the edge
     `consumingOp depends on lastOpOfChild` where consumingOp = the parent material's
     `quoteOperationId`, else the parent method's lowest-`order` op; skip when either
     side is missing. Convert with `dependenciesToRecords(map, jobId, "")` and drop
     the `companyId` key (the context only reads `operationId`/`dependsOnId`/`jobId`),
     or build the `JobOperationDependency[]` array directly — either is fine.
   - Material floors: for each material with a resolved method, required =
     `quantity × multiplier(material's method) × material.quantity`; floorDays =
     `leadTimeDaysByItem.get(itemId) ?? 7` when `methodType === "Purchase to Order"`,
     or when `methodType === "Pull from Inventory"` and
     `(onHandByItem.get(itemId) ?? 0) < required`; else none. Consuming op as above.
     Set `op.materialReadyAt = now + floorDays × 24 × 3_600_000` (keep the max when
     two materials hit one op). `materialReadyDays` = max floorDays over all, else 0.
   - `zeroStandardOperationCount` = count of ops with `setupTime === 0 && laborTime === 0 && machineTime === 0`.
3. Export `cloneFiniteContext(ctx: FiniteSchedulingContext): FiniteSchedulingContext`:
   new `capacityByWorkCenter` Map whose values are `{ ...data, reservations: [...data.reservations] }`,
   new `reservationsByEmployee` Map with copied arrays, every other property shared by
   reference. Add a comment citing the type's doc ("Reservation arrays are mutated in-run").
4. Export the pure day math:
   ```ts
   export function calendarDaysFromNow(finishMs: number, nowMs: number, timeZone: string): number
   ```
   using `@internationalized/date`: `toCalendarDate(fromAbsolute(ms, timeZone))` for
   both, `days = finish.compare(today)` (already an integer — no rounding call needed),
   returning `days < 1 ? 1 : days`.
5. Tests in `quote-lead-time.test.ts` (vitest, colocated like the other suites):
   - a root method with two ops "After Previous" → one dependency edge, quantities scale
     (`operationQuantity` = quantity for root ops);
   - a sub-assembly (child method via `parentMaterialId`, material quantity 2, consuming
     op set) → child ops have `operationQuantity = 2 × quantity` and the edge
     `consumingOp ← child's last op`;
   - no `quoteOperationId` on the material → edge goes to the parent's first op;
   - `Purchase to Order` material with lead time 10 → consuming op `materialReadyAt ===
     now + 10 days`, `materialReadyDays === 10`; `Pull from Inventory` with on-hand ≥
     required → no floor; below required → floor;
   - `cloneFiniteContext` → pushing onto a clone's reservations leaves the original untouched;
   - `calendarDaysFromNow` → a finish later the same local day returns 1; a finish two
     local days ahead returns 2; a finish at 23:30 local vs a now at 00:30 next day
     returns 1 (timezone-correct, use `"America/New_York"`).

**Verify:**
```bash
pnpm --filter @carbon/planning test -- quote-lead-time
# Expected: the new suite passes (6+ tests)
pnpm exec turbo run typecheck --filter=@carbon/planning
# Expected: no errors
```

**Out of scope:** any DB access in this file (that is Task 4); scrap quantities.

---

## Task 4: `runQuoteLeadTimeWhatIf` orchestrator + package export

**Depends on:** Tasks 2, 3
**Files:**
- Modify: `packages/planning/src/scheduling/quote-lead-time.ts` — add the loader + orchestrator
- Modify: `packages/planning/src/scheduling/run-schedule.ts` — `export` `loadOrderedBatch` (L73)
- Modify: `packages/planning/src/index.ts` — export the new entry point and types
- Copy from (precedent): `run-schedule.ts` `runExpediteWhatIf` (L242-294)

**Steps:**
1. Export the result types from the spec (`QuoteLeadTimeScenario`, `QuoteLeadTimeForecast`)
   verbatim.
2. Add `loadQuoteLineRouting(db, quoteLineId, companyId)` (module-private): three Kysely
   selects filtered by `quoteLineId` AND `companyId` — `quoteMakeMethod`
   (`id, parentMaterialId`), `quoteMaterial` (`id, quoteMakeMethodId, itemId, methodType,
   quantity, quoteOperationId`), `quoteOperation` (the columns of `QuoteOperationRow`).
   Coerce every numeric with `Number(...)`. Return `null` when there is no make method
   (a `Pull from Inventory` / `Purchase to Order` quote line has no routing).
3. Add `loadMaterialAvailability(db, itemIds, locationId, companyId)`: `itemReplenishment`
   → `leadTimeDaysByItem` (`.select(["itemId","leadTime"]).where("itemId","in",…).where("companyId","=",…)`),
   `itemStockQuantities` → `onHandByItem` (`.select(["itemId","quantityOnHand"]).where("locationId","=",…).where("companyId","=",…)`, the read `mrp.ts:277` uses).
4. Add the orchestrator:
   ```ts
   export async function runQuoteLeadTimeWhatIf(params: {
     db: Kysely<DB>; client: SupabaseClient<Database>;
     companyId: string; userId: string; locationId: string;
     quoteLineId: string; quantities: number[]; dueDate?: string | null;
   }): Promise<QuoteLeadTimeForecast | null>
   ```
   - `now = Date.now()` (the engine's convention for its clock; do not use `Date` for anything else).
   - `timeZone` = `db.selectFrom("location").select("timezone").where("id","=",locationId).where("companyId","=",companyId)` → `?? "UTC"`.
   - `routing = await loadQuoteLineRouting(...)`; return `null` if none.
   - `provider = new KyselyMasterDataProvider(db, client, companyId, { cacheCompanyData: true })`.
   - `batch = await loadOrderedBatch(db, locationId, companyId)`.
   - Batch placements exactly as `runExpediteWhatIf` does (`placeReleasedBatches` with
     `persist: false`, try/catch → null).
   - `selector = new WorkCenterSelector(provider, locationId); await selector.initialize()`.
   - Build the simulation for the FIRST quantity to derive the op set for the windows
     fetch (the op ids and process ids are the same for every quantity), then
     `availability = await loadAvailabilityWindows({ provider, workCenterSelector: selector, operations, locationId, now })`.
   - Build two contexts with `buildFiniteContext`: `queuedCtx` (`excludeJobIds: []`) and
     `bestCtx` (`excludeJobIds: batch`); `dependencies` from the first simulation (same
     graph for every quantity).
   - For each quantity: `sim = buildQuoteSimulation(...)`;
     `ops = Array.from(buildScheduledOperations(sim.operations).values())`
     (`date-calculator.ts`); for each scenario, `selector.setFiniteContext(cloneFiniteContext(ctx))`,
     `selections = selector.selectWorkCentersForOperations(ops, { jobDueDate: dueDate ?? null, batchPlacements })`,
     `finishMs` = max `toInstantMs(selection.placedEnd)` over selections and
     `p.endAt` over `selector.getPlannedReservations()` (the same union
     `selectWorkCenters()` computes, engine L930-945); `cause` = the first non-null
     `selection.conflict`, else the `scheduleNote` of the planned reservation with the
     largest `startAt − earliestStartAt`, else `null`.
     One selector instance is reused for every run: `selectWorkCentersForOperations`
     resets `this.plannedReservations = []` at its start (`work-center-selector.ts:361`),
     and `setFiniteContext` swaps the context, so a clone per run is the only isolation needed.
   - `leadTimeDays = calendarDaysFromNow(finishMs, now, timeZone)`; `finishAt = msToInstantIso(finishMs)`.
   - `target` when `dueDate` is set: `queuedFinishDate = businessDayFromMs(finishMs, timeZone)`
     (the helper `work-center-selector.ts` uses for `outsideEndDate`), verdict `"on-time"` if
     `queuedFinishDate <= dueDate`, else `"expedite"` if the best-case date `<= dueDate`,
     else `"late"`; `slackDays = parseDate(dueDate).compare(parseDate(queuedFinishDate))`.
   - `assumptions`: the three fixed sentences from the spec, with the location name
     interpolated (read `location.name` in the same select as `timezone`).
5. `run-schedule.ts`: add `export` to `loadOrderedBatch`.
6. `index.ts`: add
   ```ts
   export {
     type QuoteLeadTimeForecast,
     type QuoteLeadTimeScenario,
     runQuoteLeadTimeWhatIf
   } from "./scheduling/quote-lead-time.ts";
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/planning
# Expected: no errors
pnpm --filter @carbon/planning test
# Expected: all suites pass
```
Then a one-off smoke against the local database (needs `crbn up`): write a throwaway
script under `.ai/scratch/` (gitignored) that imports `runQuoteLeadTimeWhatIf` from
`@carbon/planning`, points at a satellite-dataset quote line with a routing, and prints
the forecast. Expected: `queued.finishAt` ≥ `bestCase.finishAt`, both non-null,
`leadTimeDays ≥ 1`. Delete the script afterwards.

**Out of scope:** persisting anything; `scenarioId`; changing `runExpediteWhatIf`.

---

## Task 5: ERP route, validator and path

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — add `quoteLeadTimeValidator`
- Modify: `apps/erp/app/utils/path.ts` — add `quoteLineLeadTime` next to `quoteLineRecalculatePrice` (L1973)
- Create: `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.lead-time.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/job+/$jobId.expedite.tsx` (whole file); `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.recalculate-price.tsx` for the quote-scoped reads

**Steps:**
1. `sales.models.ts`, near `selectedLineSchema` (L1058):
   ```ts
   export const quoteLeadTimeValidator = z.object({
     quantities: z.array(z.number().positive()).min(1),
     dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()
   });
   ```
   Export it through the module barrel like the neighbours.
2. `path.ts`: `quoteLineLeadTime: (quoteId: string, lineId: string) => generatePath(`${x}/quote/${quoteId}/${lineId}/lead-time`)`.
3. Route action (POST only, JSON body — the modal submits `fetcher.submit(payload, { method: "post", encType: "application/json" })`):
   - `requirePermissions(request, { view: "sales" })` → `companyId, userId, client`.
   - Parse `quoteLeadTimeValidator.safeParse(await request.json())`; on failure return
     `data({ forecast: null, error: "Invalid request" }, { status: 400 })`.
   - Read the quote under the company: `client.from("quote").select("locationId").eq("id", quoteId).eq("companyId", companyId).single()`; 404 via `throw new Response(null, { status: 404 })` on a miss (the record-id rule from `.claude/rules/workflow-edge-function.md` §5 applies to routes too).
   - Read the line: `client.from("quoteLine").select("id").eq("id", lineId).eq("quoteId", quoteId).eq("companyId", companyId).single()`; 404 on miss.
   - `locationId = quote.locationId ?? (await getUserDefaults(client, userId, companyId)).data?.locationId`
     (`~/modules/users/users.server`); if still null return
     `data({ forecast: null, error: "Set a location on the quote to predict lead time" })`.
   - `const { runQuoteLeadTimeWhatIf } = await import("@carbon/planning")` (routes may
     import it statically too — `kanban.$id.tsx` does; use a static import).
   - Call with `db: getDatabaseClient()` (`~/services/database.server`),
     `client: getCarbonServiceRole()`, the ids and the validated body.
   - Return `data({ forecast, error: null })`; on throw, `console.error` and return
     `data({ forecast: null, error: "Failed to predict lead time" })`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```
With `crbn up` running and an authenticated browser session, from the devtools console on
a quote line page:
```js
fetch(location.pathname.replace(/\/details$/, "") + "/lead-time", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quantities: [1, 10] }) }).then(r => r.json()).then(console.log)
```
Expected: `{ forecast: { quantities: [ { quantity: 1, queued: {...}, bestCase: {...} }, ... ] } }`.

**Out of scope:** writing `leadTime` from this route.

---

## Task 6: `QuoteLeadTimeModal` + button on the pricing grid

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Quotes/QuoteLeadTimeModal.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteLinePricing.tsx` — button on the Lead Time row (L749-753), modal mount, fetcher
- Copy from (precedent): `JobExpediteModal` in `apps/erp/app/modules/production/ui/Jobs/JobHeader.tsx` (L1163-1260) for the modal shell, loading state, "Bottleneck" alert; the pricing table itself (`QuoteLinePricing.tsx` L738-746) for the quantity-column table; `apps/erp/app/modules/production/ui/Schedule/People/TimeOffDialog.tsx` for a `DatePicker` from `@carbon/react` inside a dialog

**Steps:**
1. Modal props:
   ```ts
   {
     quoteId: string; lineId: string; quantities: number[]; isEditable: boolean;
     onApply: (leadTimeByQuantity: Record<number, number>) => Promise<void>;
     onClose: () => void;
   }
   ```
   Inside: `useFetcher<typeof action>()` (import the action type from the route file);
   on mount `fetcher.submit({ quantities }, { method: "post", encType: "application/json", action: path.to.quoteLineLeadTime(quoteId, lineId) })`.
   Local state `constraint: "queued" | "bestCase" | "target"` (default `"queued"`) and
   `targetDate: CalendarDate | null`. Changing the target date resubmits with
   `dueDate: date.toString()`; the forecast for the other two constraints is already in
   the same response, so switching between them re-renders without a request.
2. Header: the constraint picker is `Tabs` / `TabsList` / `TabsTrigger` from
   `@carbon/react`, copied from the view switcher in
   `apps/erp/app/modules/production/ui/Schedule/People/PeopleHeader.tsx` (L16-18, L107)
   but bound to local state instead of `?view=` (three triggers: "End of queue",
   "Best case", "Target date"). When "Target date" is
   selected, a `DatePicker` from `@carbon/react` (precedent `TimeOffDialog.tsx`) appears
   beside it.
3. Body while loading: spinner + "Predicting lead time…" (copy the expedite modal's
   118px block). On `error`: the message in an `Alert`. On `forecast === null` without
   error: "This line has no routing to schedule." Otherwise ONE `Table` whose rows are
   the quantity breaks and whose columns depend on the constraint:
   - queued / bestCase: Quantity · Materials ("N days" or "—") · Finish
     (`formatDate(finishAt.slice(0,10))`) · Lead time ("N days", the value that will be
     written) · Bottleneck (`cause`, or "—").
   - target: Quantity · Materials · Queued finish · Best-case finish · Verdict (a
     `Badge`: `variant="green"` "On time", `variant="orange"` "Needs expedite",
     `variant="red"` "Not feasible", with "N days of slack" / "N days short" beneath) ·
     Lead time ("N days" = `parseDate(targetDate).compare(today)`, identical on every row).
   Under the table: the `assumptions` as a muted `<ul>`; when
   `zeroStandardOperationCount > 0` an extra muted line "N operations have no time
   standards". Numbers are shown plainly, never in parentheses.
4. Footer: "Apply to all quantities" (`isEditable` only; disabled while loading, while
   no forecast, under "target" with no date, or under "target" while any row's verdict is
   `"late"` — with a `Tooltip` "One or more quantities cannot meet this date") and
   "Close". Apply builds `{ [quantity]: leadTimeDays }` for every row from the selected
   constraint, awaits `onApply(map)`, then calls `onClose()`.
5. `QuoteLinePricing.tsx`: add `onUpdateLeadTimes` next to `onUpdatePrice` (L495). It
   must NOT loop over `onUpdatePrice` — that callback snapshots `editableFields.prices`
   per call and replaces the whole map in `setEditableFields`, so a loop would keep only
   the last quantity's value in state. Implementation:
   ```ts
   const onUpdateLeadTimes = useCallback(
     async (leadTimeByQuantity: Record<number, number>) => {
       const prices = { ...editableFields.prices };
       const missing: number[] = [];
       for (const [key, days] of Object.entries(leadTimeByQuantity)) {
         const quantity = Number(key);
         if (prices[quantity]) {
           prices[quantity] = { ...prices[quantity], leadTime: days };
         } else {
           missing.push(quantity);
           prices[quantity] = { /* the same blank row onUpdatePrice builds, leadTime: days */ } as unknown as QuotationPrice;
         }
       }
       setEditableFields((prev) => ({ ...prev, prices }));
       const writes = Object.entries(leadTimeByQuantity).map(([key, days]) => {
         const quantity = Number(key);
         return missing.includes(quantity)
           ? carbon?.from("quoteLinePrice").insert({ ...prices[quantity], quoteLineId: lineId, quantity })
           : carbon?.from("quoteLinePrice").update({ leadTime: days, quoteLineId: lineId, quantity }).eq("quoteLineId", lineId).eq("quantity", quantity);
       });
       const results = await Promise.all(writes);
       if (results.some((r) => r?.error)) {
         logger.error("Failed to update quote line lead times", { errors: results.map((r) => r?.error).filter(Boolean) });
         toast.error(t`Failed to update lead times`);
       }
     },
     [editableFields.prices, carbon, lineId, quoteId, exchangeRate, userId, t]
   );
   ```
   Then add `const [leadTimeModalOpen, setLeadTimeModalOpen] = useState(false)`; on the
   Lead Time row header `HStack` (L750-753) render, when `isEmployee && hasCalculatedCost`,
   an `IconButton` `aria-label="Predict lead time"` `icon={<LuCalendarClock />}`
   `variant="ghost"` `size="sm"` that opens the modal. Mount
   `<QuoteLeadTimeModal … onApply={onUpdateLeadTimes} />` when open, passing
   `quantities` and `isEditable`. Every string goes through Lingui
   (`<Trans>` / `t\`…\``).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm run lint
# Expected: no new Biome findings
```

**Out of scope:** the share page, the PDF, `QuoteToOrderDrawer`.

---

## Task 7: Translations, docs

**Depends on:** Task 6
**Files:**
- Modify: `packages/locale/locales/*/*.po` via `/translate`
- Modify: `.claude/rules/scheduling-data-structures.md` — under "Where it lives" add `finite-context.ts` and `quote-lead-time.ts` (`runQuoteLeadTimeWhatIf`: synthetic ops through the pure selector; two contexts, queued vs front-of-queue; `materialReadyAt` floor, unset for jobs); under "Gotchas" note the selector's reservation arrays must be cloned per simulation
- Modify: `packages/planning/AGENTS.md` — list the new entry point next to `runExpediteWhatIf`
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — Quote Line Pricing concept: lead time can be predicted from the schedule (`QuoteLeadTimeModal`, route `$quoteId.$lineId.lead-time.tsx`); the write goes through `onUpdateLeadTimes`

**Steps:**
1. Run `pnpm lingui:extract` (or the command `.claude/rules/i18n-lingui-system.md` names), then `/translate`.
2. Make the three doc edits above; keep each under ten lines.

**Verify:**
```bash
git diff --stat packages/locale .claude/rules packages/planning/AGENTS.md apps/erp/app/modules/sales/AGENTS.md
# Expected: .po files gain the new msgids with non-empty msgstr; three doc files touched
```

**Out of scope:** the public docs site.

---

## Task 8: Browser verification

**Depends on:** Task 7
**Files:** none

**Steps:**
1. `crbn up`; `pnpm --filter @carbon/jobs dev:jobs` is not needed (no Inngest path).
2. `/auth`, open a satellite-dataset quote with a Make to Order line that has a routing
   (any line with operations in its Bill of Process) → Pricing card.
3. Click the calendar icon on the Lead Time row. Expected: modal with "End of queue"
   selected, a row per quantity break with a finish date and "N days"; switch to
   "Best case" → every finish is the same day or earlier, no request is made
   (network tab); a bottleneck sentence appears when the shop has open jobs on the
   same work centers.
4. Switch to "Target date": with no date the Apply button is disabled. A date earlier
   than the best case → every row "Not feasible" and Apply stays disabled with the
   tooltip; a date between the two → "Needs expedite", Apply enabled; a date after the
   queued finish → "On time".
5. Back on "End of queue", click "Apply to all quantities" → the modal closes and EVERY
   Lead Time cell in the grid shows its row's value (not only the last quantity); a
   reload shows them persisted. Click the markup "Recalculate" → the values survive
   (`resolvePreservedQuoteLinePriceFields`).
6. Screenshot the modal for the PR.

**Verify:** `/test` playbook cached at `.ai/playbooks/quote-lead-time-prediction.md`; the
five expectations above hold.

**Out of scope:** load testing.
