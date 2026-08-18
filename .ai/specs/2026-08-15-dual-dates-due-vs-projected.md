# Dual Dates — backward due dates vs forward projected completion

> Status: draft (design final — ready for /plan)
> Author: Brad Barbin + Claude
> Date: 2026-08-15
> Research: [.ai/research/labor-machine-capacity-scheduling.md](../research/labor-machine-capacity-scheduling.md); industry precedent is the MRP-II/SAP dual-date model — "basic dates" from backward lead-time scheduling vs "production dates" from capacity scheduling — also surveyed in the implemented spec's competitive references
> Amends: [implemented/2026-08-12-forecast-first-finite-scheduling.md](implemented/2026-08-12-forecast-first-finite-scheduling.md)

## TLDR

Give every operation two dates with distinct, honest meanings. **`jobOperation.dueDate` becomes a demand-anchored "need-by" date** — computed by a revived backward pass walking from `job.dueDate` through the routing (durations + the existing `operationLeadTime` columns + assembly lead times), stable because its inputs only change when the due date or routing changes. **The forward simulation's output moves to a new `jobOperation.projectedCompletionAt`** — volatile, capacity-anchored, "when it will actually happen." Slack per operation = the gap between them, which yields op-level urgency ("Weld is 2 days behind its need-by"), earlier late-warnings (the first op to cross its target, not the last), and floor-facing due dates that mean what operators think they mean. The backward pass **never floors forward placement** — the forecast-first architecture is unchanged; this adds targets, it does not reintroduce JIT holds. The audit found the flip is cheap: the engine's persist is the only automated writer of op dates, and the consumers that treat `dueDate` as urgency (MES overdue/sort, capacity Demand, picking) become semantically correct without modification.

## Problem Statement

After the forecast-first rewrite, `jobOperation.dueDate` holds the forward placement's finish — a forecast wearing a due date's name. Audited consequences (full blast-radius audit 2026-08-15, agents' reports; key sites cited):

1. **Urgency signals are self-fulfilling.** MES sorts queues and flags overdue by `operationDueDate` (`display.service.ts:360`, `useOperation.tsx:360`), and the ERP ops board does the same (`ItemCard.tsx:139`) — but that date now *moves with reality*. A shop running behind sees its "due dates" slip along with it; nothing on the floor screams until the whole job is late.
2. **No operation-level slack.** Lateness lives only at the job level (`projectedCompletionAt` vs `job.dueDate`, `work-center-selector.ts:385/767`). Planners can't see which operation is burning the buffer or catch a mid-routing slip early.
3. **Capacity demand is keyed to a forecast.** The Capacity view buckets demand hours by `operation.dueDate` (`peopleCapacity.server.ts:146-162`) — demand should be keyed by when work is *needed*, not when the sim last predicted it would happen.
4. **The pre-branch behavior was closer to right on this one axis.** On main, op due dates WERE demand-anchored: backward from `job.dueDate`, reverse-topo, each op's due = earliest dependent's start minus that dependent's `operationLeadTime` (business days) minus `assemblyLeadTime` at assembly edges (from `itemReplenishment.leadTime`), duration in 8h business days (`origin/main date-calculator.ts:126-212`). The rewrite correctly removed that pass *as a placement input* — but threw out the target semantics with it, and orphaned the `operationLeadTime` columns (`jobOperation` NUMERIC since `20240823024502`, `methodOperation` since `20250330231242` — still on the tables, read by nothing).

### What stays true (from the forecast-first spec)

Forward-ASAP placement, whole-location deterministic regeneration, the machine-hours ladder, and the job-level overdue verdict are unchanged. The backward pass computes **targets only** — it must never floor, delay, or otherwise influence placement.

## Proposed Solution

### 1. The two dates

| | `jobOperation.dueDate` (need-by) | `jobOperation.projectedCompletionAt` (forecast) |
|---|---|---|
| Direction | Backward from `job.dueDate` | Forward from now, finite capacity |
| Anchored to | Demand (due date + routing + lead times) | Reality (capacity, disruptions, progress) |
| Changes when | Due date, routing, or lead times change | Any scheduling input changes (every regen) |
| Type | `DATE` (day-granular target, as before) | `TIMESTAMP WITH TIME ZONE` (exact placed end) |
| Means | "Finish by this day or the job slips" | "This is when it will actually finish" |

`jobOperation.startDate` keeps its current meaning — the forward projection's start day (boards `ORDER BY startDate` and the priority tie-break stay correct: the queue sorts by when work will happen).

### 2. The backward pass — revived as a target calculator, modernized

Algorithm = main's `BackwardSchedulingStrategy`, with two upgrades and one hard rule:

- **Walk:** reverse topological order; leaf ops due = `job.dueDate`; an op with dependents is due at the earliest dependent constraint, where each constraint = the dependent's need-by start minus the dependent's `operationLeadTime` (revived from the existing columns), minus `assemblyLeadTime` at assembly edges (`itemReplenishment.leadTime`, the existing `assignAssemblyLeadTimes` plumbing). `With Previous` ops copy their predecessor's target dates. Need-by start = need-by due minus duration-in-days.
- **Upgrade 1 — real day lengths:** duration-in-days uses the operation's work center calendar (the availability ladder), not the old hardcoded 8h business days: `days = ceil(remainingHours / calendarHoursPerDay(wc))`, skipping that work center's zero-hour days rather than a hardcoded Sat/Sun. Ops without an assigned WC use the location calendar. This keeps targets and forecasts on the same physics, so op-level slack isn't noise from mismatched day models.
- **Upgrade 2 — no fake conflicts:** the old pass flagged `startDate < today` as a conflict. The new pass writes no conflict flags at all — lateness verdicts come from comparing forecast to target (§4).
- **Hard rule:** the backward result is written to `jobOperation.dueDate` and read by *nothing* in the placement path. `work-center-selector` must not floor `earliestStart` on it (the audit confirms placement currently reads `op.startDate` only as the pinned-op path — keep it that way).

**Cadence — recomputed every regen, stable by purity.** Rather than wiring release/due-date/routing triggers, the backward pass runs as a cheap pre-step inside every location regen. Its inputs (`job.dueDate`, routing, lead times, WC calendars' weekly pattern) change rarely, so its outputs are stable across regens by determinism — the observable behavior Brad described ("a single backward pass at release") achieved with zero trigger bookkeeping. Jobs with no `dueDate` get null need-bys (nothing is "due").

### 3. Manual pins under dual dates

`updateJobOperationDueDate` (+ `OperationDueDatePicker` on the BOP) currently pins a *forecast*; under dual dates it pins the **need-by**: a pinned op's `dueDate` is taken as-is by the backward pass and propagates upstream (ops feeding it derive their targets from the pin instead of the computed constraint). The forward simulation schedules pinned ops **normally** — the old frozen-window behavior (reserve the pinned span, skip placement) is removed, because the schedule is now the projection, not the due date. `manuallyScheduled = true` simply means "a human owns this target." The engine's manual-branch persist quirk (omit `dueDate` on update) becomes the rule for all ops: forward persist never writes `dueDate` at all.

### 4. Lateness, slack, and urgency

- **Job verdict (unchanged):** late = `job.projectedCompletionAt` business day > `job.dueDate`; newly-late notification unchanged.
- **Op slack (new):** `dueDate − businessDay(projectedCompletionAt)` in days. Negative = behind target.
- **Op behind-target flag (new, informational):** an op whose projection exceeds its need-by gets a distinct visual state (amber "behind target: Nd" on boards/BOP) — deliberately NOT `hasConflict` (which stays reserved for placement failures and the job-late verdict), because a parallel-branch op can be behind its own target while the job still lands on time; the target chain carries no buffers.
- **Attribution bonus:** the first op in topo order whose projection crosses its need-by is *the* op that ate the buffer — surfaced in the job's schedule note.

### 5. Consumers — what flips, what stays (from the audit)

**Become correct with no code change** (they always wanted "when it must be done"):
- Capacity view Demand bucketing by `operation.dueDate` (`peopleCapacity.server.ts:146-162`, `getPeopleCapacityOperations`).
- MES queue sort `operationDueDate ?? jobDueDate` and `isOverdue` (`display.service.ts:360`, `useOperation.tsx:360`).
- ERP ops-board overdue test (`ItemCard.tsx:139`).
- `get_picking_schedule` ordering by op `dueDate`.

**Change:**
- Engine persist (`scheduling-engine.ts:991-1006`): non-manual branch writes `startDate` + `projectedCompletionAt` (+priority/wc/conflict) — never `dueDate`. The backward pre-step is the only `dueDate` writer.
- `get_active_job_operations_by_location` and `get_job_operation_by_id`: add `projectedCompletionAt` to the output (boards/MES detail can show "due Thu · projected Fri").
- `getJobPromiseDate` fallback: drop `max(op.dueDate)` (would now return ≈ the job due date — circular); fallback becomes null when `job.projectedCompletionAt` is unset. (Currently uncalled — free to change.)
- BOP (`JobBillOfProcess`) op rows: show both dates; the picker keeps editing `dueDate` (now honestly labeled).
- ItemCard/MES operation detail: add the projected date as secondary text with the behind-target amber state.

**Stays as-is:** `startDate` semantics and every `ORDER BY startDate`; the priority tie-break; job-level surfaces (JobHeader/JobCard slack badges, dates board, expedite); `job.startDate = dueDate − itemReplenishment.leadTime` back-dating at job creation (job-level precedent, untouched).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Naming | `dueDate` = backward need-by; `projectedCompletionAt` = forward forecast (per-op, mirroring the job column) | Brad's call; restores the plain-language meaning of "due" |
| `startDate` fate | Keep as forward projected start; no rename | It means "when work will start" under both regimes; renaming would churn 5 RPC ORDER BYs, MES sorts, and the tie-break for zero semantic gain |
| Backward-pass cadence | Recomputed in every regen (pure pre-step), not event-triggered | Same observable stability (inputs change rarely ⇒ outputs stable by determinism), zero trigger bookkeeping, no staleness class |
| Day-length model | Work-center calendar hours (availability ladder), not 8h business days | Targets and forecasts on one physics; mismatched day models would make op slack noisy |
| Lead times | Revive existing `operationLeadTime` (jobOperation/methodOperation) + `assemblyLeadTime` plumbing | The columns exist and were the pre-branch behavior; no new schema for lead times |
| Placement isolation | Backward result read by nothing in placement | The JIT-floor removal was the forecast-first spec's core fix; targets must never regress it |
| Manual pin semantics | Pin = need-by override propagating upstream; frozen-window reservation removed | The schedule is the projection now; a pin is a commitment, not a placement |
| Op behind-target | Informational visual state, not `hasConflict` | Bufferless target chains make per-op "late" noisy as a hard conflict; job verdict stays the alarm |
| Schema | `jobOperation.projectedCompletionAt TIMESTAMPTZ` added to the unmerged branch migration (in-place, + local psql delta); no backfill (first regen self-heals both columns) | Branch precedent; backward+forward passes rewrite both dates on the next regen |
| Multi-tenancy / services / RLS / forms | No new tables; existing column conventions; picker stays ValidatedForm; RPC changes in-place per branch precedent | Heuristics 1–7: no exceptions |
| Uncertainty compatibility | Targets are input-snapshot values like everything else (§7 invariants of the parent spec hold: backward pass is pure, seeded by the same snapshot) | Monte Carlo later samples forecasts against fixed targets — exactly the comparison that yields overdue probability |

## Data Model Changes

A **new forward-dated migration** (`pnpm db:migrate:new dual-dates`) — NOT an in-place revision this time: `get_job_operation_by_id`'s newest definition lives in main-owned `20260721004140_operation-type-consolidation.sql`, which is timestamped after the branch's `20260720121629`, so recreating it in the branch migration would be silently overwritten on fresh deploys (the backdated-migration lesson). A new migration also applies locally via plain `pnpm db:migrate`.

```sql
-- Dual dates: op dueDate becomes the backward need-by target; the forward
-- forecast moves to its own column (mirrors job."projectedCompletionAt").
ALTER TABLE "jobOperation" ADD COLUMN "projectedCompletionAt" TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN "jobOperation"."projectedCompletionAt" IS
  'Forward finite simulation: when this operation is projected to finish. Volatile (rewritten every regen).';
COMMENT ON COLUMN "jobOperation"."dueDate" IS
  'Backward demand-anchored need-by: finish by this day or the job slips. Stable (recomputed only when job dueDate, routing, or lead times change). manuallyScheduled = a human owns this value.';
```

RPC updates in the same migration (fork newest definitions — `get_active_job_operations_by_location` from `20260720121629`, `get_job_operation_by_id` from `20260721004140`): both add a `"projectedCompletionAt" TIMESTAMP WITH TIME ZONE` output column. No other schema changes; no backfill (the next regen writes both columns for every open op). The engine writes `dueDate` **only when the computed need-by differs from the stored value** — on a quiet regen the backward pass writes zero rows.

## API / Service Changes

- **Engine (`lib/scheduling/`)**: new pure `computeNeedByDates(operations, dependencies, jobDueDate, leadTimes, calendars)` module (revives main's backward walk with the two upgrades; Deno-tested with the old algorithm's cases plus calendar-day-length cases); engine `run()` calls it before placement and persists `dueDate` from it (pinned ops passed through, propagated upstream); `persistChanges` forward branch writes `startDate` + `projectedCompletionAt`, never `dueDate`; frozen-window branch for `manuallyScheduled` removed from placement; provider loads `operationLeadTime` with operations.
- **`production.service.ts`**: `getJobPromiseDate` fallback change; `getJobOperationsForTimeline` + capacity operations select `projectedCompletionAt`; `updateJobOperationDueDate` unchanged mechanically (new meaning documented).
- **MES `operations.service.ts` / `display.service.ts`**: consume the new RPC column for detail display; sort/overdue logic untouched.

## UI Changes

- **BOP operation rows**: "Due {need-by} · Projected {forecast}" with amber behind-target state; picker label stays "Due date" (now honest).
- **ERP ops board ItemCard + MES operation detail**: projected date as secondary line; behind-target amber distinct from the red conflict triangle.
- **Job schedule note**: names the first op behind its target when the job is late.
- No changes to dates board, JobHeader/JobCard (already job-level), People views, or Gantt.

## Acceptance Criteria

- [ ] A released 3-op serial job due Friday with 1-day ops and zero lead times gets need-bys Wed/Thu/Fri (reverse-topo), regardless of where the forward sim places the work; adding `operationLeadTime = 2` to op 3 pulls ops 1–2's need-bys two business days earlier.
- [ ] Need-by dates do NOT change when capacity changes (add a downtime dispatch → projections move, `dueDate` values byte-identical); they DO change when the job's due date is dragged or an op is inserted.
- [ ] Forward placement is byte-identical before/after the backward pass runs (targets never floor placement) — determinism test extended to assert placements with and without need-by computation match.
- [ ] An op whose projection exceeds its need-by shows the amber behind-target state on the BOP and ops board while `hasConflict` stays false if placement succeeded; the job goes red only on the job-level verdict.
- [ ] A pinned op due date survives every regen, propagates upstream (its feeder's need-by derives from the pin), and the pinned op is now placed by the forward sim like any other (no frozen window) — its projection may differ from its pin.
- [ ] MES queue sort and overdue flags key on need-by; the Capacity view's Due lens buckets by need-by; a shop running behind sees ops go overdue against stable targets instead of dates that slip with the forecast.
- [ ] A job with no due date has null need-bys everywhere and never shows behind-target states.
- [ ] Engine Deno suite green including the revived backward-walk cases (leaf anchor, min-dependent constraint, lead-time subtraction, assembly edge, With Previous copy, calendar day-lengths, pin propagation).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Regression to JIT flooring by accident (someone "helpfully" reads dueDate in placement) | Med | Determinism test asserting placement invariance vs need-by computation; hard-rule comment at the placement floor site |
| Removing the frozen-window pin behavior surprises users who pinned ops to force placement | Low/Med | Release note; the pin still owns the target and the picker still works; if forced placement is truly needed it returns as an explicit feature, not a side effect |
| Bufferless target chains make amber states common on loaded shops | Low | Informational styling, not conflicts; job verdict unchanged; per-op buffer factors are a clean later add |
| Existing rows carry forecast values in `dueDate` at deploy | Low | First regen rewrites both columns for all open ops; no backfill needed |

## Open Questions

> All resolved 2026-08-15 — Brad's conversation decisions plus surfaced recommendations (marked **Autonomous**, veto at review).

- [x] Should op due dates be backward-computed targets with a separate forward projection? — **Answer (Brad):** yes — "semantically the backward pass dates should be called due date and the forward pass should be projected completion date"; backward at release cadence, forward frequently.
- [x] What did the pre-branch system do? — **Answer (audit):** main's backward pass anchored on `job.dueDate`, reverse-topo, minus per-op `operationLeadTime` + assembly lead times, 8h business days; removed by the forecast-first rewrite along with its target semantics; the lead-time columns survive unused.
- [x] `startDate` fate? — **Autonomous:** keep as forward projected start (no rename) — it means "when work will start" under both regimes; renaming churns 5 RPCs + MES sorts for nothing.
- [x] Backward-pass trigger wiring vs recompute-every-regen? — **Autonomous:** recompute every regen; stability comes from input purity, matching Brad's stated cadence with no trigger machinery.
- [x] Day-length model for targets? — **Autonomous:** WC calendar hours via the availability ladder (not the old 8h hardcode) so op slack isn't noise from mismatched models.
- [x] Manual pin semantics? — **Autonomous:** pin = need-by override propagating upstream; frozen-window placement removed (the schedule is the projection now). Flagged prominently — this is a behavior change to an existing feature.
- [x] Op behind-target: conflict or informational? — **Autonomous:** informational amber state; `hasConflict` and the job verdict unchanged (bufferless chains would make per-op conflicts noisy).

## Changelog

- 2026-08-15: Planning corrections — schema ships as a NEW forward migration (main-owned `20260721004140` defines `get_job_operation_by_id` later than the branch migration; in-place would be overwritten on fresh deploys) and the backward pass diff-writes `dueDate` (zero writes on quiet regens, per Brad's cost question).
- 2026-08-15: Created after the full dual-audit (current-branch blast radius + origin/main backward-pass archaeology). Naming per Brad; four autonomous sub-decisions surfaced for veto (startDate kept, recompute-every-regen, calendar day-lengths, pin-without-frozen-window).
