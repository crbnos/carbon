# Demand Forecast Consumption

> Status: in-progress (approved by Brad 2026-09-11; executing .ai/plans/2026-09-11-demand-forecast-consumption.md)
> Author: Claude (feature run `.ai/runs/2026-09-11-demand-forecast-consumption.md`)
> Date: 2026-09-11
> Research: `.ai/research/demand-forecast-consumption.md`
> Audit: `.ai/runs/2026-09-11-demand-forecast-consumption-audit.md`

## TLDR

Actual demand (open sales order lines and job-material lines) will **consume** the
authored demand forecast (`demandProjection`) so the two never double-count: per weekly
bucket, MRP demand becomes *actuals + unconsumed forecast remainder* — which equals
`max(forecast, actuals)` when both land in the same week — with a bucket-granular
**backward-then-forward consumption window** so an order landing in a zero-forecast week
consumes the nearest adjacent forecast. Consumption is computed **regeneratively inside
`runMrp`** (nothing to un-consume; cancelled orders and edited forecasts self-heal on the
next run, no sales↔production communication required) and persisted as
`demandProjection.consumedQuantity`, which every read path (both planning RPCs,
`generatePlanningActions`, inventory quantities, the item planning chart) subtracts —
one implementation, read everywhere.

**The audit refuted the premise that same-week netting already works.** Today forecast
and actuals are *summed* in four independent places; 10 forecast + 10 SOs = 20 demand.
This spec fixes the same-week case and the gap case in one mechanism.

## Problem Statement

`demandProjection` (the authored forecast) and actual demand are both fed to MRP at
face value and **added** (audit §3):

- `mrp.ts:442-515` — projections and SO lines write to the same `grossDemand` key additively.
- `get_production_planning` / `get_purchasing_planning` `demand_data` CTEs — `demandActual + demandForecast + demandProjection`, summed.
- `planning-actions.ts:529-574` — the same union in Node for change actions.
- `get_inventory_quantities` — sums actual + forecast (and omits projections entirely).

Concretely, for one item/location/week with forecast 10:

| Open SOs | Demand today | Correct |
|---|---|---|
| 10 | **20** | 10 |
| 5 | **15** | 10 |
| 12 | **22** | 12 |

And the gap case: forecast `0, 10, 0, 10` across weeks 1–4; an SO for 10 due in week 3
adds 10 on top of the untouched week-2 and week-4 forecasts — the order that *is* the
forecasted demand, counted twice. Because the planning RPCs project a **cumulative**
running balance, a double count in week 3 depresses the projected balance for every
subsequent week — over-ordering across the whole horizon, not a one-week blip.

Make-to-stock jobs are *not* part of the problem: they are supply, netted once by
`explodeBom`'s running balance (audit §4), and the SO↔linked-job dedup already works.
What's missing is exclusively forecast-vs-actual-demand consumption.

## Proposed Solution

### The algorithm (industry-standard forecast consumption, bucket-granular)

A pure function `consumeForecast` in `packages/ee/src/planning/mrp/forecast-consumption.ts`:

```
Inputs, per (itemId, locationId):
  forecast:  Map<periodIndex, qty>   // demandProjection rows within the horizon
  actuals:   Map<periodIndex, qty>   // consumption quantities (see below)
  window:    { backward: B, forward: F }   // in periods (weeks)

Walk actuals in ascending period order. Each actual quantity consumes forecast:
  1. its own period first,
  2. then backward: p−1, p−2, … p−B (nearest first),
  3. then forward: p+1, … p+F (nearest first),
decrementing remaining forecast as it goes. Excess actual beyond reachable
forecast consumes nothing further (it simply stands as real demand).

Outputs:
  consumed:  Map<periodIndex, qty>   // per forecast period, how much was consumed
  remainder: Map<periodIndex, qty>   // forecast − consumed, floored at 0
```

Net demand per period = `actuals[p] (demand quantity) + remainder[p]`.

Properties:
- Same-bucket cases reduce to `max(forecast, actuals)`: 10F/10SO→10, 10F/5SO→10, 10F/12SO→12.
- Gap case (F = 0,10,0,10; SO 10 due wk3, B≥1): wk2 forecast fully consumed; demand = 10 (SO, wk3) + 10 (forecast, wk4). No double count, and the still-unmaterialized second month's forecast survives.
- `B = F = 0` degrades to strict same-bucket netting.
- Deterministic: earlier actuals claim forecast first; backward always precedes forward (SAP mode 2 / Oracle / SyteLine consensus — a "late" order belongs to the just-passed forecast).
- Past-due actuals are already dumped into period[0] by `findPeriod`, so they consume the current week's forecast then forward — no special-casing.
- Past forecast (projection rows whose `periodId` predates the horizon) is already inert in both the engine and the RPCs (periodId never matches a horizon period); it stays that way — self-expiring, no SAP-style cleanup job.

### Where it runs and how it propagates (compute once, read everywhere)

**Computed in `runMrp` Phase 4** (before the Phase-4.5 supersession redirect):

1. Build the actuals maps first (SO + job-material loops, as today).
2. Run `consumeForecast` per (item, location).
3. Add the **remainder** (not the raw `forecastQuantity`) to `grossDemand`; projection
   contributor rows in `demandForecastSource` carry the remainder (a fully consumed
   projection contributes no row).
4. In the existing atomic Phase-7 transaction, persist per-row
   `demandProjection.consumedQuantity` (rounded at internal scale via `round()` from
   `@carbon/utils` at the persist boundary; horizon rows only, others untouched).

**Read paths subtract, never re-implement.** Every reader changes its projection term
from `forecastQuantity` to `GREATEST("forecastQuantity" - "consumedQuantity", 0)`:

| Read site | Change |
|---|---|
| `get_production_planning` `demand_data` (fork of `20260715195226`) | projection arm nets |
| `get_purchasing_planning` `demand_data` (fork of `20260831190142`) | projection arm nets |
| `planning-actions.ts:529-574` union | select both columns, net in TS |
| `get_inventory_quantities` (fork of `20260716142907`, the newest def) | **add** net projection arm (fixes its existing omission of projections) |
| `getItemDemand` (`items.service.ts:647`) | add net projections (fixes the planning-chart blind spot) |

Freshness note: `demandActual` is already an MRP output (rebuilt each run, cron every
3 h + manual Recalculate), so the read paths are already run-stale for actuals. Netting
the projection arm with a run-stamped `consumedQuantity` makes the projection term
*consistent* with the actual term rather than fresher than it. A projection authored
between runs counts at face value until the next run — the same grace it gets today.

### What consumes, what doesn't

| Source | Role |
|---|---|
| Open SO lines (`openSalesOrderLines`) | **consume**, at the line's *pre-job-dedup* open quantity (new view column `quantityToConsume` — see Data Model). Demand contribution stays the deduped `quantityToSend`. Without this, an MTO order fully covered by its linked job would consume nothing and its forecast would drive phantom stock production. |
| Open job-material lines (`openJobMaterialLines`) | **consume** projections on their own (component) item — real dependent demand consuming a component-level forecast. |
| Make-to-stock jobs (`openProductionOrders`) | **never consume** — they are supply, already netted once by the running balance (SAP/Oracle/Epicor consensus: production is relieved on the supply side). |
| BOM-exploded *planned* dependent demand | **does not consume** component projections in v1 (SAP strategy-40 default; strategy-70-style dependent-demand consumption is a possible later opt-in). |

Consumption is strictly per (itemId, locationId) — an order at location A never consumes
a forecast at location B (matches the tables' keys and every surveyed vendor).

### Configuration (flat, company-level)

Two integer columns on `companySettings`, following `rescheduleToleranceDays` precedent:

- `forecastConsumptionBackwardPeriods` — default **4** (bridges monthly-granularity forecasts authored on the weekly grid; Oracle's guidance "backward ≈ one bucket span" scaled to the common author-monthly pattern)
- `forecastConsumptionForwardPeriods` — default **1** (early orders; every vendor warns against large forward windows)

`0/0` = strict same-week netting. No per-item override, no matrix (per the no-matrix-config
principle; SyteLine/Epicor per-item overrides are the request to watch for later).
Surfaced in the same settings UI as `rescheduleToleranceDays`.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Netting formula | actuals + unconsumed remainder (≡ `max` same-bucket) | The user's three cases; APICS/SAP/Oracle/SyteLine consensus (research §Pattern 1) |
| Compute timing | Regenerative, inside `runMrp`; no stored consume/unconsume events | Self-healing with zero deconsumption machinery (SAP-dynamic/Fusion/D365 pattern); fits Carbon's wipe-and-rewrite MRP outputs |
| Window granularity | Whole periods (weeks), not days | Forecast is bucket-native (`periodId`); day windows are the documented Epicor/SyteLine footgun class (research §Pattern 4) |
| Search order | Own bucket → backward → forward, nearest-first, earlier actuals first | Cross-vendor consensus; deterministic |
| Persistence | `demandProjection.consumedQuantity NUMERIC NOT NULL DEFAULT 0`, MRP-written | One implementation feeds all five read sites; enables "consumed" display in the forecast grid; PK (itemId, locationId, periodId) already matches the consumption grain. Deliberately supersedes the MRP-v2 spec's "demandProjection gains no columns" scope note |
| Consumption vs supersession order | Consume **before** the Phase-4.5 redirect (authored item identity) | The read path does not redirect projections/actuals at all today (audit §7); pre-redirect consumption keeps engine and grid consistent. Successor-aware consumption lands with the (pre-existing, separately tracked) read-path redirect work |
| Current-week forecast | Kept, consumed normally — no D365-style drop-today rule | Week 0 is 0–6 days out; job-shop orders due this week were often booked weeks ago and consume it anyway. A drop-current-week knob can come later if wanted |
| SO consumption quantity | `quantityToSend` pre-job-dedup (`quantityToConsume` view column) | MTO correctness (above). Partially-shipped lines under-consume until their week rolls out of horizon — bounded wobble, accepted for v1 (SAP solves it with persisted goods-issue reduction; not worth the state) |
| Heuristic 1 (multi-tenancy) | No new tables; new columns on existing RLS'd tables | `demandProjection` + `companySettings` already carry `companyId` + RLS |
| Heuristic 2/6 (service/module shape) | No new service files; changes live in `production.service.ts`, `items.service.ts`, `@carbon/ee` planning | Existing module layout |
| Heuristics 3/4/5 | No new tables/routes/forms except settings fields on the existing settings form | Existing `ValidatedForm` + action; `settings` permission scope unchanged |
| Heuristic 7 (compat) | Additive columns with defaults; view gains a column; RPC signatures unchanged | Zero-downtime; old readers unaffected |

## Data Model Changes

One migration (idempotent per lessons; randomized HHMMSS timestamp):

```sql
-- 1. Consumption state (MRP-written, derived — never user-authored)
ALTER TABLE "demandProjection"
  ADD COLUMN IF NOT EXISTS "consumedQuantity" NUMERIC NOT NULL DEFAULT 0;

-- 2. Company-level consumption window
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "forecastConsumptionBackwardPeriods" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "forecastConsumptionForwardPeriods" INTEGER NOT NULL DEFAULT 1;

-- 3. openSalesOrderLines: expose the pre-job-dedup open quantity
--    (fork newest def from 20260811123619_widen-sales-production-scale.sql;
--     DROP VIEW IF EXISTS + recreate WITH (security_invoker=true);
--     add: sol."quantityToSend" AS "quantityToConsume" alongside the existing
--     job-deduped "quantityToSend" CASE expression)

-- 4. get_production_planning / get_purchasing_planning: fork newest defs
--    (20260715195226 / 20260831190142); demandProjection arm becomes
--    GREATEST(dp."forecastQuantity" - dp."consumedQuantity", 0).

-- 5. get_inventory_quantities: fork newest def (20260316000000); ADD the
--    net-projection arm to its demand CTE (currently omits projections).
```

No RLS changes (existing table policies cover the new columns). No new enums.
`pnpm run generate:types` after; types propagate via `Awaited<ReturnType>` chains.

## API / Service Changes

- **`packages/ee/src/planning/mrp/forecast-consumption.ts`** (new): pure
  `consumeForecast(forecast, actuals, window)` + types. Sibling
  `forecast-consumption.test.ts` (vitest, `pnpm --filter @carbon/ee test`).
- **`packages/ee/src/planning/mrp/mrp.ts`**: Phase 4 reordered — actuals loops first
  (also accumulating per-key `quantityToConsume`), then projections loop runs
  `consumeForecast` per (item, location) and adds remainders to `grossDemand` /
  contributors; reads the two window settings from `companySettings` once per run;
  Phase 7 persists `consumedQuantity` (batched update inside the existing transaction).
  Also fix the vestigial `netDemand` name and stale migration-filename comment flagged
  by the audit while in there.
- **`packages/ee/src/planning/mrp/planning-actions.ts`**: projection query selects
  `forecastQuantity, consumedQuantity`; union adds the `GREATEST` diff.
- **`apps/erp/app/modules/items/items.service.ts` `getItemDemand`**: add net
  projections so the item planning chart agrees with the planning grid.
- **`upsertDemandProjections` needs no change**: PostgREST upserts only update the
  columns present in the payload, so `consumedQuantity` survives a re-authored
  forecast (and keeping it until the next run is *more* accurate than resetting —
  the remainder stays netted). Zero-quantity weeks delete the row, which correctly
  deletes its consumption state with it.
- **Settings action/validator** for the two new fields (existing settings form pattern).

## UI Changes

- **Settings** (wherever `rescheduleToleranceDays` lives): two number fields —
  "Forecast consumption: weeks backward / weeks forward", with help text.
- **`DemandProjectionForm` 52-week grid**: per-cell read-only annotation of consumed
  quantity (e.g. muted "8 consumed" under the input) so a planner can see the forecast
  self-healing. Copy the nearest existing grid-annotation precedent; no new interaction.
- **Planning grids / worklists**: no UI change — they reflect net demand automatically
  via the RPC/union changes.
- i18n: new strings through Lingui extract + `/translate` at commit time.

## Docs / knowledge sync (required by keep-sources-in-sync)

- `apps/erp/app/modules/agent/kb/docs/reference/forecast.md` — currently documents the
  additive behavior as intentional; rewrite for consumption (and fix its stale paths).
- `.claude/rules/mrp-system.md` — describe consumption in the run flow.
- MRP v2 spec (`.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md`) — changelog
  note that `demandProjection` now gains `consumedQuantity`, superseding its §scope line.

## Acceptance Criteria

- [ ] Unit (`forecast-consumption.test.ts`): same-bucket 10F/10A→10, 10F/5A→10,
      10F/12A→12 (net totals); gap `0,10,0,10` + actual 10 in p3 with B=1 → wk2
      remainder 0, wk4 remainder 10; forward-only reach (actual in p1, forecast in p2,
      F=1) consumes; window exhaustion leaves excess actual standing; B=F=0 ≡ per-bucket
      max; two actuals competing for one forecast bucket resolve earlier-period-first;
      actual beyond all forecast in window consumes nothing outside it.
- [ ] After an MRP run with forecast 10 and one open SO of 10 in the same week (no
      stock/supply): production planning grid shows week demand 10, and exactly one
      Make/Order suggestion of 10 for that item.
- [ ] Gap scenario seeded end-to-end (forecast weeks 2 & 4 = 10, SO 10 due week 3):
      total horizon demand for the item is 20 (10 SO + 10 remaining forecast), planning
      actions suggest supply for 20, and `demandProjection.consumedQuantity` = 10 on the
      week-2 row, 0 on week-4.
- [ ] With forecast 10 and SOs totalling 12 in-window: demand 12; no forecast remainder.
- [ ] MTO SO line fully covered by a linked live job still consumes its week's forecast
      (grid demand shows no phantom forecast remainder).
- [ ] Forecast edit grid displays consumed quantities after a run; a re-saved cell
      keeps its consumption (remainder stays netted) until the next run recomputes it.
- [ ] `get_production_planning`, `get_purchasing_planning`, `planningAction` worklist,
      and Inventory quantities agree on the same net demand for the seeded scenarios.
- [ ] `pnpm --filter @carbon/ee test`, scoped typechecks, `pnpm db:migrate` +
      `pnpm run generate:types`, `pnpm db:check:datasets` and `pnpm db:check:backups` all green.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| A read site is missed and grid/worklist disagree (the audit's four-site trap) | High | The five-site table above is the checklist; acceptance criterion pins cross-surface agreement; grep for `demandProjection` at plan time to catch stragglers |
| Staleness between runs (new SO consumes nothing until next run) | Med | Same staleness contract as `demandActual` today (3 h cron + manual Recalculate); documented in the KB doc |
| Partial-shipment under-consumption wobble | Low | Bounded to the current week; self-heals when the week rolls; noted for a future goods-issue-analog refinement |
| Supersession read-path divergence for superseded items | Med (pre-existing) | Not worsened (consumption runs pre-redirect); tracked as the existing read-path redirect gap (audit §7) |
| `consumedQuantity` default backfill on a large `demandProjection` table | Low | `ADD COLUMN ... DEFAULT 0` is metadata-only on PG11+; no rewrite |
| Window defaults wrong for some tenants | Low | Company-settable; `0/0` opt-out; defaults grounded in research |

## Open Questions

> All resolved autonomously (research + codebase precedent) per the declared run mode;
> Brad vetoes at the plan gate before any execution. Items 1–3 are effectively fixed by
> the user's own problem statement; 4–9 are the judgment calls to eyeball.

- [x] Same-bucket semantics? — **Autonomous:** actuals + unconsumed remainder (≡ `max`), exactly the user's three worked cases; APICS consensus.
- [x] Do jobs consume forecast? — **Autonomous:** No — MTS jobs are supply (already netted); job-material lines DO consume component-level projections. Matches the user's "jobs net out" intent and SAP/Oracle/Epicor.
- [x] How do gaps heal? — **Autonomous:** bucket-granular backward(4)-then-forward(1) window; the user's 0/10/0/10 example nets correctly with B≥1.
- [x] Window unit and config surface? — **Autonomous:** whole weeks (periods), two company-level `companySettings` columns, defaults 4/1, no per-item matrix. Alternatives (day windows, per-item overrides) rejected as the documented vendor footgun / config sprawl.
- [x] Recompute vs stored consumption state? — **Autonomous:** regenerative in `runMrp`, persisted only as derived `consumedQuantity` output. Stored consume/unconsume events (Oracle EBS) rejected — deconsumption machinery for no benefit at Carbon's run cadence.
- [x] Where does the net live so all readers agree? — **Autonomous:** `demandProjection.consumedQuantity` + `GREATEST` subtraction at five read sites; supersedes MRP-v2's "no new columns on demandProjection" scope note.
- [x] Which SO quantity consumes? — **Autonomous:** pre-job-dedup `quantityToSend` (new `quantityToConsume` view column); deduped quantity stays the demand driver. Full-sale-quantity (shipment-proof) variant deferred.
- [x] Consumption vs supersession ordering? — **Autonomous:** consume first, on authored identity — keeps engine consistent with the (non-redirecting) read path; successor-aware consumption rides the existing read-path redirect gap.
- [x] Current-week forecast dropped (D365) or kept? — **Autonomous:** kept and consumable; drop rule deferred as a possible future knob.

## Changelog

- 2026-09-11: Created after Phase-0 audit (refuted existing-netting belief) and 4-vendor research; all open questions autonomously resolved for veto at the plan gate.
- 2026-09-11 (plan phase): corrected `get_inventory_quantities` fork source to the true newest def (`20260716142907`); dropped the `upsertDemandProjections` reset — PostgREST upserts preserve absent columns, so consumption state survives re-authoring (deliberately kept until next run).
- 2026-09-11 (execute): approved by Brad; implementation started. Docs correction: the agent-KB forecast doc is generated from `docs/content/docs/reference/forecast.mdx` (edit source + `generate:agent-kb`, per `.claude/rules/agent-knowledge-base.md`), not the kb/ copy directly.
