# Demand Forecast Consumption — implementation plan

**Spec:** .ai/specs/2026-09-11-demand-forecast-consumption.md
**Research:** .ai/research/demand-forecast-consumption.md
**Audit:** .ai/runs/2026-09-11-demand-forecast-consumption-audit.md
**Branch:** mrp-action-suggestions (worktree kelowna)

Core idea (read the spec first): actual demand consumes the authored forecast
(`demandProjection`) per weekly bucket — own bucket, then backward
`forecastConsumptionBackwardPeriods` weeks, then forward
`forecastConsumptionForwardPeriods` weeks. Computed regeneratively in `runMrp`,
persisted as `demandProjection.consumedQuantity`, subtracted with
`GREATEST(forecastQuantity - consumedQuantity, 0)` at every read site.

## Progress
- [x] Task 1: Pure `consumeForecast` function + unit tests (e24cc547b6)
- [x] Task 2: Migration — columns, view column, three function forks (322288b5be)
- [x] Task 3: Apply migration + regenerate types (322288b5be; dataset/backup hook checks skipped — no DB connection at commit time, rerun in Task 10)
- [x] Task 4: Wire consumption into `runMrp` (Phase 1/4/7) (42c3a86f5c)
- [x] Task 5: Net projections in `generatePlanningActions` (201a87040b)
- [x] Task 6: Net projections in `getItemDemand` + item planning chart (a592b29b80 — merged in the forecast loader, not the chart, so Outgoing card + Supply & Demand list fix too)
- [x] Task 7: Settings service fn + planning settings card (committed; + ui/Planning barrel export)
- [x] Task 8: Consumed annotation in the forecast edit grid (committed; useQuantityFormatter is a callable, not Intl — used directly)
- [x] Task 9: Docs/rules/spec sync (committed with design artifacts; KB regenerated from docs source per agent-knowledge-base rule)
- [ ] Task 10: Validation gates + browser verification

## Dependencies
- Task 1 is independent (pure TS, no generated types) — may run in parallel with Task 2.
- Task 3 needs Task 2. Tasks 4–8 need Task 3 (generated types); Task 4 also needs Task 1.
- Tasks 5, 6, 7, 8 are mutually independent (parallelizable).
- Task 9 independent of code tasks (doc text), but write it after Task 4 so it describes reality.
- Task 10 last.

---

## Task 1: Pure `consumeForecast` function + unit tests

**Depends on:** none
**Files:**
- Create: `packages/ee/src/planning/mrp/forecast-consumption.ts`
- Create: `packages/ee/src/planning/mrp/forecast-consumption.test.ts`
- Copy from (precedent): `packages/ee/src/planning/mrp/planning-actions.test.ts` (pure-unit vitest style, named imports from sibling)

**Steps:**
1. Create `forecast-consumption.ts` with exactly this exported API (JSDoc welcome, no classes):

```ts
export type ConsumptionWindow = {
  /** How many periods BEFORE the actual's period may be consumed (0 = own period only). */
  backwardPeriods: number;
  /** How many periods AFTER the actual's period may be consumed. */
  forwardPeriods: number;
};

export type ConsumptionResult = {
  /** periodIndex -> quantity consumed from that period's forecast (0 ≤ consumed ≤ forecast). */
  consumedByPeriod: Map<number, number>;
  /** periodIndex -> forecast − consumed, floored at 0. Every input forecast period has an entry. */
  remainderByPeriod: Map<number, number>;
};

export function consumeForecast(args: {
  /** periodIndex -> authored forecast quantity (entries may be 0; negative treated as 0). */
  forecast: Map<number, number>;
  /** periodIndex -> total consuming actual quantity (SO quantityToConsume + job-material quantityToIssue). */
  actuals: Map<number, number>;
  window: ConsumptionWindow;
}): ConsumptionResult;
```

Algorithm (implement exactly):
- Initialize `remaining = new Map(forecast)` clamping negatives to 0; `consumedByPeriod` starts with 0 for every forecast key.
- Sort actual period indices ascending. For each actual index `p` with quantity `q > 0`:
  - Visit candidate periods in this order: `p`, then `p−1, p−2, … p−backwardPeriods`, then `p+1, … p+forwardPeriods` (skip negative indices; indices need not exist in `forecast` — just skip missing ones).
  - At each candidate `c`: `take = Math.min(q, remaining.get(c) ?? 0)`; if `take > 0`, decrement `remaining[c]`, increment `consumedByPeriod[c]`, decrement `q`. Stop early when `q === 0`.
  - Leftover `q` consumes nothing else (it stands as real demand — caller's concern).
- `remainderByPeriod` = clamped forecast − consumed per key.
- Pure function: do NOT mutate the input maps.

2. Create `forecast-consumption.test.ts` (vitest, `describe`/`it`/`expect` like the precedent) with at minimum these cases (window `{backwardPeriods: 4, forwardPeriods: 1}` unless stated):
   - Same-bucket: F={2:10}, A={2:10} → remainder {2:0}; A+remainder totals 10.
   - Under: F={2:10}, A={2:5} → remainder {2:5} (total demand 5+5=10).
   - Over: F={2:10}, A={2:12} → remainder {2:0} (total 12).
   - The user's gap: F={2:10, 4:10}, A={3:10}, backward 1 → consumed {2:10}, remainder {2:0, 4:10}.
   - Backward preference: F={1:10, 3:10}, A={2:6}, backward≥1/forward≥1 → consumes period 1 (backward) not 3.
   - Forward reach: F={2:10}, A={1:10}, backward 4/forward 1 → consumed {2:10}.
   - Window exhaustion: F={0:5}, A={6:10}, backward 4 → nothing consumed (period 0 is out of reach), remainder {0:5}.
   - Backward spill across multiple periods: F={1:4, 2:4}, A={3:10}, backward 2 → consumes 4+4, remainder both 0.
   - `{0,0}` window ≡ per-bucket max: F={2:10}, A={1:10, 2:3} → remainder {2:7}; nothing consumed by period 1's actual.
   - Earlier actual wins: F={2:10}, A={1:8, 3:8}, backward 1/forward 1 → period-1 actual (forward) takes 8 first, period-3 actual (backward) gets remaining 2.
   - Inputs not mutated; negative forecast clamped to 0.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- forecast-consumption
# Expected: all tests pass, including "gap" and "earlier actual wins" cases; 0 failures
```

**Out of scope:** any import from `mrp.ts` or generated DB types (keep it dependency-free); rounding (caller rounds at persist).

---

## Task 2: Migration — columns, view column, three function forks

**Depends on:** none
**Files:**
- Create: via `pnpm db:migrate:new demand-forecast-consumption` → `packages/database/supabase/migrations/<timestamp>_demand-forecast-consumption.sql`
- Copy from (sources to fork — copy the NEWEST definition, change only what is listed):
  - `packages/database/supabase/migrations/20260811123619_widen-sales-production-scale.sql` lines ~290-324 (`openSalesOrderLines`)
  - `packages/database/supabase/migrations/20260715195226_planning-reads-demand-projections.sql` (`get_production_planning`)
  - `packages/database/supabase/migrations/20260831190142_purchasing-planning-reads-demand-projections.sql` (`get_purchasing_planning`)
  - `packages/database/supabase/migrations/20260716142907_restore-inventory-quantities-tags.sql` (`get_inventory_quantities` — the NEWEST def; NOT `20260316000000`)

**Steps:**
1. `pnpm db:migrate:new demand-forecast-consumption` (never hand-pick the timestamp; HHMMSS must not be `000000`).
2. Section 1 — columns (idempotent):

```sql
-- Forecast consumption: MRP-computed, derived state. Never user-authored.
ALTER TABLE "demandProjection"
  ADD COLUMN IF NOT EXISTS "consumedQuantity" NUMERIC NOT NULL DEFAULT 0;

-- Company-level consumption window, in weekly periods (0/0 = same-week netting only)
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "forecastConsumptionBackwardPeriods" INTEGER NOT NULL DEFAULT 4
    CHECK ("forecastConsumptionBackwardPeriods" >= 0),
  ADD COLUMN IF NOT EXISTS "forecastConsumptionForwardPeriods" INTEGER NOT NULL DEFAULT 1
    CHECK ("forecastConsumptionForwardPeriods" >= 0);
```

(Precedent for the CHECK-on-ALTER shape: `rescheduleToleranceDays` in `20260911041811_mrp-planning-actions.sql:109-110`. `NUMERIC` bare — no precision spec. `ADD COLUMN ... DEFAULT` is metadata-only, no table rewrite.)

3. Section 2 — `openSalesOrderLines`: `DROP VIEW IF EXISTS "openSalesOrderLines";` then recreate by copying the 20260811123619 definition **verbatim**, adding ONE column directly after the existing `END AS "quantityToSend",` line:

```sql
    -- Pre-job-dedup open quantity: what this line CONSUMES from the demand
    -- forecast. An MTO line fully covered by its linked job still consumed
    -- the forecast that predicted it; only its residual drives new supply.
    sol."quantityToSend" AS "quantityToConsume",
```

Keep `WITH (security_invoker=true)` and every other column/join/filter identical. Add a `-- Forked from 20260811123619_widen-sales-production-scale.sql` comment.

4. Section 3 — `get_production_planning`: `DROP FUNCTION IF EXISTS get_production_planning(TEXT, TEXT, TEXT[]);` then copy the ENTIRE function from `20260715195226` verbatim (same signature, same RETURNS TABLE), changing ONLY the third UNION arm of `demand_data` (lines ~152-158 of the source) to:

```sql
      UNION ALL
      -- Top-level manual projections, net of forecast consumption: actual
      -- demand consumed them during the MRP run (demandProjection.consumedQuantity),
      -- so only the unconsumed remainder still drives demand here.
      SELECT "itemId", "periodId", NULL as "actualQuantity",
             GREATEST("forecastQuantity" - "consumedQuantity", 0) AS "forecastQuantity"
      FROM "demandProjection"
      WHERE "companyId" = company_id
        AND "locationId" = location_id
        AND "periodId" = ANY(periods)
```

5. Section 4 — `get_purchasing_planning`: same treatment, source `20260831190142`. Add `DROP FUNCTION IF EXISTS get_purchasing_planning(TEXT, TEXT, TEXT[]);` before the `CREATE OR REPLACE` (the source file omits it; signature is unchanged so this is belt-and-braces idempotency). Change ONLY the third UNION arm of its `demand_data` CTE (source lines ~133-141) to the same `GREATEST` form. Note this function's RETURNS list differs from production's (`"purchasingBlocked"` vs `"manufacturingBlocked"`) — copy ITS OWN list, do not cross-pollinate.
6. Section 5 — `get_inventory_quantities`: `DROP FUNCTION IF EXISTS get_inventory_quantities(TEXT, TEXT, TEXT);` then copy the ENTIRE function from `20260716142907` verbatim (signature `(company_id TEXT, location_id TEXT, item_id TEXT DEFAULT NULL)`), changing ONLY the `demand_forecast` CTE (source lines ~279-292) by appending a third UNION arm inside its `combined` subquery, matching that CTE's own column aliasing:

```sql
      UNION ALL
      SELECT "itemId", GREATEST("forecastQuantity" - "consumedQuantity", 0) AS qty
      FROM "demandProjection"
      WHERE "companyId" = company_id AND "locationId" = location_id
```

(If the source CTE uses table aliases like `da`/`df`, alias this arm `dp` consistently. This arm ADDS projections to inventory demand — they were previously omitted entirely; the spec calls this fix out explicitly.)
7. Re-read the finished file top to bottom checking idempotency: every ALTER guarded with IF NOT EXISTS, every DROP guarded with IF EXISTS, no `NUMERIC(x,y)`, no `CURRENT_DATE`.

If any of the four source definitions has drifted (a newer migration now defines it — check with `grep -rl "get_production_planning\|get_purchasing_planning\|get_inventory_quantities\|openSalesOrderLines" packages/database/supabase/migrations/ | sort | tail`), STOP and report — do not fork a stale definition.

**Verify:**
```bash
ls packages/database/supabase/migrations/ | tail -3
# Expected: the new <timestamp>_demand-forecast-consumption.sql is the newest file
grep -c "GREATEST(\"forecastQuantity\" - \"consumedQuantity\", 0)" packages/database/supabase/migrations/*demand-forecast-consumption.sql
# Expected: 3 (two planning fns + inventory fn)
grep -c "quantityToConsume" packages/database/supabase/migrations/*demand-forecast-consumption.sql
# Expected: >= 1
```

**Out of scope:** RLS changes (existing policies cover new columns); `TABLE_RENAMES` (nothing renamed/dropped); touching `demandForecast`/`demandActual` DDL; the older `get_inventory_quantities` definitions.

---

## Task 3: Apply migration + regenerate types

**Depends on:** Task 2
**Files:**
- Modify (generated): `packages/database/src/types.ts` (via script — never hand-edit)

**Steps:**
1. `pnpm db:migrate` (applies pending migrations to the local DB and regenerates types + swagger). If the local DB is unreachable, STOP and report — do not attempt a DB rebuild.

**Verify:**
```bash
grep -n "consumedQuantity" packages/database/src/types.ts | head -3
# Expected: consumedQuantity appears in the demandProjection Row/Insert/Update types
grep -n "quantityToConsume" packages/database/src/types.ts | head -3
# Expected: quantityToConsume appears in the openSalesOrderLines view Row type
grep -n "forecastConsumptionBackwardPeriods" packages/database/src/types.ts | head -2
# Expected: present on companySettings
```

**Out of scope:** committing (that happens per-task via check-and-commit at execute time).

---

## Task 4: Wire consumption into `runMrp` (Phase 1/4/7)

**Depends on:** Tasks 1, 3
**Files:**
- Modify: `packages/ee/src/planning/mrp/mrp.ts` — Phase 1 settings load; Phase 4 loop reorder + consumption; Phase 7 persist

**Steps:**
1. Import `consumeForecast` from `./forecast-consumption` and `round` from `@carbon/utils`.
2. **Phase 1** (near the existing 5-way `Promise.all` at ~lines 125-183): also load the window settings — a single-row read, alongside (not inside) the fetchAll batch:

```ts
const consumptionSettings = await client
  .from("companySettings")
  .select("forecastConsumptionBackwardPeriods, forecastConsumptionForwardPeriods")
  .eq("id", companyId)
  .maybeSingle();
const consumptionWindow = {
  backwardPeriods: consumptionSettings.data?.forecastConsumptionBackwardPeriods ?? 4,
  forwardPeriods: consumptionSettings.data?.forecastConsumptionForwardPeriods ?? 1
};
```

3. **Phase 4 restructure** (current code: projections loop `:442-477`, SO loop `:480-515`, JM loop `:518-552`). New order: SO loop, JM loop, THEN projections+consumption. Build a period index first:

```ts
const periodIndexById = new Map<string, number>();
periods.forEach((p, i) => { if (p.id) periodIndexById.set(p.id, i); });
// locationId␟itemId (makeLocationItemKey) -> periodIndex -> consuming quantity
const consumptionActuals = new Map<string, Map<number, number>>();
```

4. **SO loop changes**: the loop currently skips on `!line.quantityToSend`. Change the guard so a line with `quantityToConsume > 0` still consumes even when its demand residual is 0 (the MTO-covered case):
   - Skip only when `!line.itemId || !line.locationId`, or when BOTH `(line.quantityToSend ?? 0) <= 0` AND `(line.quantityToConsume ?? 0) <= 0`.
   - Keep every existing demand-side write (`grossDemand`, `salesDemandByKey`, `topLevelContributors`) gated on `line.quantityToSend > 0` exactly as today.
   - Additionally, when `(line.quantityToConsume ?? 0) > 0` and the period resolved, accumulate into `consumptionActuals` under `makeLocationItemKey(line.locationId, line.itemId)` at `periodIndexById.get(period.id)`.
5. **JM loop changes**: same accumulation using `line.quantityToIssue` (its existing demand quantity — job materials have no dedup split), same key/period shape. No change to its demand-side writes.
6. **Projections loop replacement**: group loaded projections per `makeLocationItemKey(projection.locationId, projection.itemId)`. Per group:

```ts
const forecast = new Map<number, number>(); // periodIndex -> forecastQuantity
// (skip rows whose periodId is not in periodIndexById — defensive; Phase 1 already filters to horizon)
const { consumedByPeriod, remainderByPeriod } = consumeForecast({
  forecast,
  actuals: consumptionActuals.get(locationItemKey) ?? new Map(),
  window: consumptionWindow
});
```

   For each projection row: its remainder (`remainderByPeriod.get(periodIndex) ?? clampedForecast`) replaces `projection.forecastQuantity` in the existing body — `grossDemand` add and the `Demand Projection` contributor both use the remainder, and a remainder of 0 adds neither. Keep the existing null-guards (`!projection.itemId || !projection.locationId`) and the `> 0` gate. Rename the vestigial `netDemand` local to `remainder` and update the stale comment block at `:438-441` (it still describes the old no-netting design) plus the wrong migration filename in the comment at `:464` (`20260527115843_demand-projection-source.sql` → `20260527110002_demand-forecast-source.sql`).
   Also collect persist rows for EVERY loaded projection (consumed 0 included):

```ts
// itemId, locationId, periodId, consumedQuantity (round() at persist — internal scale)
consumptionUpserts.push({ itemId, locationId, periodId, consumedQuantity: round(consumedByPeriod.get(periodIndex) ?? 0) });
```

7. **Phase 4.5 untouched**: consumption runs entirely BEFORE the supersession redirect (spec decision — authored identity). Do not move or modify Phase 4.5.
8. **Phase 7 persist** (inside the existing `db.transaction().execute` at `:938`, after the existing upsert loops, same `BATCH_SIZE = 500`): batched `UPDATE ... FROM (VALUES ...)` — an UPDATE, not an upsert, so a projection deleted mid-run can never be resurrected:

```ts
import { sql } from "kysely"; // top of file if not present
for (let i = 0; i < consumptionUpserts.length; i += BATCH_SIZE) {
  const batch = consumptionUpserts.slice(i, i + BATCH_SIZE);
  await sql`
    UPDATE "demandProjection" AS dp
    SET "consumedQuantity" = v."consumedQuantity"::numeric,
        "updatedAt" = ${datetime.timestamp()},
        "updatedBy" = ${userId}
    FROM (VALUES ${sql.join(
      batch.map((r) => sql`(${r.itemId}, ${r.locationId}, ${r.periodId}, ${r.consumedQuantity})`)
    )}) AS v("itemId", "locationId", "periodId", "consumedQuantity")
    WHERE dp."itemId" = v."itemId"
      AND dp."locationId" = v."locationId"
      AND dp."periodId" = v."periodId"
      AND dp."companyId" = ${companyId}
  `.execute(trx);
}
```

(Precedent for the VALUES-batch shape: `packages/jobs/src/workflows/retention.ts` pass 3. `datetime.timestamp()` matches the existing Phase-7 upserts' `updatedAt`.)
9. If `makeLocationItemKey` or the Phase-7 structure differs from what this task describes, STOP and report — do not improvise around a drifted `mrp.ts`.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: all suites pass (forecast-consumption, planning-actions, responsible-employee, scheduling)
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0, no type errors
```

**Out of scope:** Phase 4.5 supersession logic; `explodeBom` / `mrp-engine.ts`; `demandActual` write semantics (still the deduped demand quantities); `generatePlanningActions` (Task 5).

---

## Task 5: Net projections in `generatePlanningActions`

**Depends on:** Task 3
**Files:**
- Modify: `packages/ee/src/planning/mrp/planning-actions.ts` — the demand union (~lines 527-575)

**Steps:**
1. In the three-way `Promise.all` (~line 529), add `"consumedQuantity"` to the `demandProjection` select:

```ts
db.selectFrom("demandProjection")
  .select(["itemId", "locationId", "periodId", "forecastQuantity", "consumedQuantity"])
  .where("companyId", "=", companyId)
  .execute()
```

2. In the projections loop of the union (~lines 566-574), change the added quantity to the net remainder:

```ts
addDemand(
  row.itemId,
  row.locationId,
  row.periodId,
  Math.max((Number(row.forecastQuantity) || 0) - (Number(row.consumedQuantity) || 0), 0)
);
```

3. Update the union's header comment (`── demand per (item, location, period): actual + forecast + projection…`) to say the projection arm is net of consumption, matching the RPCs.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- planning-actions
# Expected: existing planning-actions tests still pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** `deriveChangeActions` internals; the supply queries; `rescheduleToleranceDays` handling.

---

## Task 6: Net projections in `getItemDemand` + item planning chart

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/items/items.service.ts` — `getItemDemand` (~lines 647-683)
- Modify: `apps/erp/app/routes/api+/items.$id.$locationId.forecast.ts` and/or the `ItemPlanningChart` component (find via `grep -rn "getItemDemand" apps/erp/app`) — merge projections into the demand series

**Steps:**
1. Add a third query to `getItemDemand`'s `Promise.all`, same filter shape as the existing two:

```ts
client.from("demandProjection").select("*")
  .eq("itemId", itemId).eq("locationId", locationId)
  .eq("companyId", companyId).in("periodId", periods)
```

Return `{ actuals, forecasts, projections }` (projections raw rows — netting happens at the merge point so the caller can also show gross if it wants).
2. In the consumer that assembles per-period demand for the chart (follow `getItemDemand`'s callers), add the net projection quantity per period to the demand value: `Math.max((forecastQuantity ?? 0) - (consumedQuantity ?? 0), 0)`, summed into the same period bucket as `demandForecast` rows. The resulting series must equal what the planning RPC's `demand_data` computes for the same item.
3. If the chart's data shape makes the merge ambiguous (e.g. it renders actual and forecast as separate series), merge the net projection into the FORECAST series (it is forecast demand) and STOP AND REPORT only if neither series fits.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "projections" apps/erp/app/modules/items/items.service.ts | head -3
# Expected: getItemDemand now returns projections
```

**Out of scope:** chart visual redesign; other `items.service.ts` functions.

---

## Task 7: Settings service fn + planning settings card

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — new fn next to `setRescheduleToleranceDays` (~line 1678)
- Modify: `apps/erp/app/routes/x+/settings+/planning.tsx` — loader fields, validator, action intent, render
- Create: `apps/erp/app/modules/settings/ui/Planning/ForecastConsumptionCard.tsx`
- Copy from (precedent): `RescheduleToleranceCard` in `apps/erp/app/modules/settings/ui/Planning/ResponsibleEmployeeCard.tsx` lines 248-323 (`NumberField` + `useFetcher` + intent pattern, exact imports listed there)

**Steps:**
1. Service fn, mirroring `setRescheduleToleranceDays`:

```ts
export async function setForecastConsumptionWindow(
  client: SupabaseClient<Database>,
  args: { companyId: string; backwardPeriods: number; forwardPeriods: number }
) {
  return client
    .from("companySettings")
    .update({
      forecastConsumptionBackwardPeriods: args.backwardPeriods,
      forecastConsumptionForwardPeriods: args.forwardPeriods
    })
    .eq("id", args.companyId);
}
```

2. `planning.tsx` loader: read both columns from the existing `getCompanySettings` result with `?? 4` / `?? 1` fallbacks, alongside `rescheduleToleranceDays`.
3. `planning.tsx` validator + action: inline `const consumptionValidator = z.coerce.number().int().min(0).max(52);` next to the existing `toleranceValidator` (line ~72); new `case "setForecastConsumption"` parsing `backwardPeriods` and `forwardPeriods` form fields, calling `setForecastConsumptionWindow`, returning `{ success, message }` in the same shape as `setTolerance`.
4. `ForecastConsumptionCard.tsx`: clone `RescheduleToleranceCard`'s structure — one Card, two labelled `NumberField`s (min 0, max 52): "Consume forecast backward (weeks)" and "Consume forecast forward (weeks)", copy explaining: "When a sales order or job lands in a week with no remaining forecast, it consumes forecast from up to this many weeks back (then forward) instead of double-counting." Submit both values with `intent=setForecastConsumption` via `useFetcher`. Wrap user-facing strings in Lingui (`t` / `<Trans>`) if and only if `ResponsibleEmployeeCard.tsx` does — match the host file's i18n usage exactly.
5. Render `<ForecastConsumptionCard …/>` in `planning.tsx` directly after `<RescheduleToleranceCard …/>` (~line 190). Export the new card from the `ui/Planning` barrel if one exists (check `apps/erp/app/modules/settings/ui/Planning/index.ts`; if absent, import directly like `RescheduleToleranceCard` is).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "setForecastConsumption" apps/erp/app/routes/x+/settings+/planning.tsx | head -3
# Expected: validator/action case + card usage present
```

**Out of scope:** migrating `RescheduleToleranceCard` to `ValidatedForm`; `settings.models.ts` (the planning page's precedent is inline validators — follow the host file).

---

## Task 8: Consumed annotation in the forecast edit grid

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/x+/production+/demand-forecasts.$itemId.$locationId.tsx` — loader passes per-week consumed values
- Modify: `apps/erp/app/modules/production/ui/DemandProjection/DemandProjectionForm.tsx` — render annotation under each week cell
- Copy from (precedent): the loader's existing `weekValues` flattening (route lines ~45-65) and the week-cell render (form lines ~247-274)

**Steps:**
1. Route loader: next to the existing `weekValues` build, add:

```ts
const consumedValues: Record<number, number> = {};
periods.forEach((period, index) => {
  const row = existingProjections.data?.find((f) => f.periodId === period.id);
  if (row?.consumedQuantity && row.consumedQuantity > 0) consumedValues[index] = row.consumedQuantity;
});
```

Return `consumedValues` alongside `periods` and `initialValues`, and pass it into `<DemandProjectionForm …/>` as a new prop `consumedValues: Record<number, number>`.
2. In the form's week-cell render (the `<Number key={index} name={`week${index}`} …/>` block at ~lines 247-274), wrap each cell in a `<div>` and, when `consumedValues[index]` exists, render beneath the input:

```tsx
<span className="text-xs text-muted-foreground">
  {formatter.format(consumedValues[index])} consumed
</span>
```

where `formatter` is the app's quantity formatter hook (grep `useQuantityFormatter` in `apps/erp/app` for the import path; if the hook does not exist under that name, use the same formatter the `DemandProjectionTable` uses for quantities — do NOT inline `minimumFractionDigits`/`maximumFractionDigits`, per the numeric-precision rule). Wrap the "consumed" text for i18n exactly the way the rest of `DemandProjectionForm.tsx` handles user-facing strings (it imports Lingui if it does — match the file).
3. Do not make the annotation interactive and do not change the input's value semantics — `consumedQuantity` is display-only here; the action continues to write only `forecastQuantity` (absent columns are preserved by the PostgREST upsert, and zero-quantity deletes are correct: no forecast row, no consumption).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
grep -n "consumedValues" apps/erp/app/modules/production/ui/DemandProjection/DemandProjectionForm.tsx | head -3
# Expected: prop received and rendered
```

**Out of scope:** the `DemandProjectionTable` list view; the chart inside the form; changing the action's upsert payload.

---

## Task 9: Docs/rules/spec sync

**Depends on:** Task 4 (describe reality, not intent)
**Files:**
- Modify: `docs/content/docs/reference/forecast.mdx` — the additive-demand paragraph + stale paths. (CORRECTED during execution: the plan originally named `apps/erp/app/modules/agent/kb/docs/reference/forecast.md`, but that file is GENERATED from `docs/content/**` per `.claude/rules/agent-knowledge-base.md` — edit the source and run `pnpm run generate:agent-kb`, committing the regenerated kb/ alongside.)
- Modify: `.claude/rules/mrp-system.md` — run-flow inputs + new settings
- Modify: `.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md` — changelog note
- Modify: `.ai/specs/2026-09-11-demand-forecast-consumption.md` — changelog + status

**Steps:**
1. `forecast.md`: replace the paragraph stating projections and actuals are "added in full alongside" with the consumption model (own week → backward N → forward M, company settings, `consumedQuantity`, remainder drives MRP; actuals always count in full). Fix the stale component/route paths it cites (`ui/Projection/…` → `ui/DemandProjection/…`, `projections.new.tsx` → `demand-forecasts.new.tsx`).
2. `mrp-system.md`: in the run-flow "Inputs (demand)" bullet, describe consumption (what consumes, window settings, `consumedQuantity` persisted in Phase 7, `GREATEST` netting at the read sites) and remove/replace the `<!-- UNVERIFIED -->` week-count note if Task 4 confirmed the horizon. Keep it factual to committed code only.
3. MRP v2 spec: append changelog line — "2026-09-11: `demandProjection` gains `consumedQuantity` (forecast consumption, see `.ai/specs/2026-09-11-demand-forecast-consumption.md`), superseding this spec's 'demandProjection gains no columns' scope note."
4. This feature's spec: set `Status: in-progress`, append changelog line for implementation start.

**Verify:**
```bash
grep -n "consumedQuantity" apps/erp/app/modules/agent/kb/docs/reference/forecast.md .claude/rules/mrp-system.md
# Expected: both files describe the consumption model
grep -c "added in full alongside" apps/erp/app/modules/agent/kb/docs/reference/forecast.md
# Expected: 0
```

**Out of scope:** the customer docs site (`docs/`) — MRP forecast docs there, if any, ride a separate carbon-docs pass; glossary changes.

---

## Task 10: Validation gates + browser verification

**Depends on:** Tasks 1-9
**Files:** none (verification only)

**Steps:**
1. Run the gates:

```bash
pnpm --filter @carbon/ee test
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
pnpm run lint
pnpm db:check:datasets
pnpm db:check:backups
```

2. Browser verification via `/test` (requires the dev stack; boot with plain `crbn up` if not running, then `/auth`). Scenarios, per the spec's acceptance criteria:
   a. **Same week:** author a forecast of 10 for a Make item in week W (Production → Demand Forecasts); create+release a sales order for 10 of that item promised in week W (status must reach To Ship); run MRP via the planning page's Recalculate; verify the production planning grid shows week-W demand 10 (not 20) and exactly one suggestion of 10 given no stock; verify the forecast edit grid shows "10 consumed" on week W.
   b. **Gap:** forecasts 10 in week W+1 and 10 in week W+3 (0 elsewhere); SO for 10 promised in week W+2; Recalculate; verify W+1 shows consumed 10 / remainder 0, W+3 untouched, and total horizon demand for the item is 20.
   c. **Over:** forecast 10, SOs totalling 12 same week; Recalculate; demand 12, no remainder.
   d. **Settings:** change the window to 0/0 in Settings → Planning, Recalculate, verify the gap scenario now double-counts week W+2's SO (proves the setting is live); restore 4/1.
   e. **MTO coverage:** forecast 10 in week W; Make-to-Order SO for 10 in week W with a linked live job covering it (create the job from the SO line); Recalculate; verify the forecast still shows 10 consumed and the grid shows no phantom 10 of forecast remainder on top of the job-covered order.
   Record pass/fail per scenario; a failure means STOP and report, not improvise.

**Verify:**
```bash
# The commands in step 1, each exiting 0; step 2's four scenarios all "pass" in the /test report.
```

**Out of scope:** committing/pushing (Brad decides; no auto-commit), performance load-testing.
