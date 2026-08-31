# Capacity Planning — Forecast-First Finite Scheduling

> Status: implemented
> Author: Brad Barbin + Claude
> Date: 2026-08-12 (implementation landed 2026-08-13)
> Plan: [../../plans/implemented/2026-08-12-forecast-first-finite-scheduling.md](../../plans/implemented/2026-08-12-forecast-first-finite-scheduling.md)
> Playbook: [../../playbooks/forecast-first-scheduling.md](../../playbooks/forecast-first-scheduling.md)

This is the single, as-built specification for the capacity-planning feature. It absorbs the
earlier iteration specs (finite dual-resource scheduling, attended-window labor, the daily
people/manning board) and the employee-ability and Gantt work into one finished artifact —
scheduling engine plus its labor, manning, qualification, and visualization layers. The core
of the system is a **deterministic, whole-location forward simulation**; the sections after
the engine describe the labor and supporting layers that refine its accuracy.

## TLDR

The product goal is a **trustworthy answer to two questions: "when will each job actually finish (are we going to be overdue)?" and "what's the best we can do?"** This spec restructures the branch's scheduler around that goal: scheduling becomes a **pure, deterministic, whole-location forward simulation** — `(open operations, calendars, priority order, now) → schedule` — regenerated in full whenever inputs change, instead of per-job incremental placement against durable reservations. Work centers get **operating hours** (a ladder: explicit work-center shifts → the location's shifts → a stock Mon–Fri 8h week), replacing the current open-24×7 machine model, so the schedule is bounded by real hours even on a zero-configuration shop. The backward JIT pass is removed: everything schedules forward-ASAP, the projected finish *is* the overdue forecast, and "best we can do" is the same simulation re-run with the target job at the head of the queue. The existing dual-resource labor layer (ability gating, manning board, attended windows) is kept unchanged as an accuracy *refinement* on top of the machine calendar. Dispatch rules (`schedulingPolicy`), the mark/wave frozen-set machinery, and the initial-vs-reschedule mode split are deleted — the dispatch sequence is simply the simulation's placement order.

## Problem Statement

The branch implements genuine dual-resource finite placement, but audited against the stated goal it has structural gaps (full critique in the 2026-08-12 conversation; key code refs inline):

1. **Finiteness is conditional on optional data.** Work centers are open 24×7 (`scheduling-engine.ts` builds one continuous 365-day window per WC); hours enter only through people's shifts, and only for ability-gated or manning-board-staffed operations. An ungated, unstaffed operation schedules labor around the clock — an 8h labor op starting at 4pm "finishes" at midnight. A person with no shift row is 24×7-available to the engine while the UI ladder assumes 8h. A zero-config shop gets a schedule that looks precise and is systematically optimistic — the exact failure mode that matters most for overdue detection, in the silent direction.
2. **It can't answer "are we going to be overdue" with slack.** Forward placement is floored at the backward-pass JIT start date (`work-center-selector.ts:394-398`), so on-time jobs finish *at* their due date by construction — "comfortably early" and "barely on time" are indistinguishable, and there is no early warning before a hiccup makes a job late. The backward pass also uses a different capacity model (8h business days, `duration-calculator.ts:4`) than the forward pass (continuous time), so targets and placements disagree systematically.
3. **Incremental scheduling against durable reservations is order-dependent and race-prone.** Per-job placement against frozen neighbors means a scoped replan wave can leave an early-due job stuck behind a later-due frozen one; the mark/wave layer has a lost-update race, a redundant double-dispatch on the dates board, stamps that never clear on immediate reschedules, and `work-center`/`location` event kinds with no emitters.
4. **The capacity screen compares three different date bases** (demand by due date, scheduled by calendar overlap, available by weekday) in mixed units, with a fallback cliff where staffing a station *lowers* its displayed available hours; the one series tied to engine output (Scheduled) is excluded from the Load verdict.
5. **In-progress operations reserve their full duration from `now`** — nothing in `lib/scheduling/` reads `quantityComplete` or production events — so near-done work inflates projected load and pushes successors' forecasts out.
6. **Dispatch rules don't dispatch.** `schedulingPolicy` sorts the board sequence after placement; the reservation timeline is built in a different order. Two sources of truth for execution order.

### What is kept (verified good)

The pure-function engine core and its test discipline (`slot-allocator.ts`, `calendar-utils.ts`, `people-utils.ts` — all Deno-tested), the attended-window labor model (machine held for the span, named person booked only for setup+labor, relay/team semantics), process-level ability gating, the manning board and its window-edit semantics (absence subtraction, overtime extension, split-day budgets), wait attribution and human-readable conflict/schedule notes, manual pins, sticky work centers, and `capacityReservation` as the persisted schedule shape. The research survey confirms this labor model is ahead of everything below the APS tier; this spec does not touch its semantics.

## Proposed Solution

### 1. Machine operating hours — the availability ladder

Machine availability comes from a three-rung ladder, resolved per work center (consistent with the survey's consensus: the machine calendar is the *plant's operating pattern*, never derived from operator staffing):

1. **Explicit work-center shifts** — `workCenterShift` rows linking a work center to one or more of the location's existing `shift` rows ("this machine runs 1st and 2nd shift"), OR `workCenter.alwaysOn = true` for genuine lights-out equipment (24×7, today's behavior).
2. **The location's shifts** — when a work center has no explicit rows: the union of all `shift` rows at its location (a two-shift plant ⇒ ~16h weekdays), expanded with the existing `expandCalendar` machinery in the location's timezone.
3. **Stock default week** — when the location has no shifts at all: Mon–Fri 08:00–17:00 in the location's timezone (matching the UI's existing `FALLBACK_SHIFT_HOURS = 8` weekday convention).

The engine builds each work center's `windows` from this ladder instead of one open window. `findSlot`/`allocateOperation` already accumulate working time across window gaps, so ungated operations pause outside machine hours with **no allocator changes**. For attended operations the machine windows additionally clip the members' windows (a person can't run a closed machine), and the **unattended remainder accumulates on the machine's calendar** (an `alwaysOn` machine runs through the night; a shift-bound machine resumes next window).

**Machine downtime is subtracted from the ladder's windows and derived from maintenance dispatches — not stored separately.** A dispatch that takes its work center(s) offline (`maintenanceDispatch.takesWorkCenterOffline`, new flag; affected WCs = `workCenterId` + `maintenanceDispatchWorkCenter` rows) contributes an outage window `[actualStartTime ?? plannedStartTime ?? createdAt, actualEndTime ?? plannedEndTime ?? horizon-end)` while its status is not Completed/Cancelled. No end estimate = down until further notice (subtract to horizon; sticky ops on that WC surface conflicts honestly). Closing or cancelling the dispatch restores the hours with no cleanup — the windows are computed, so there is no lifecycle to sync. The machine breaks, the maintenance tech logs the dispatch they'd log anyway, and the next regen reroutes/reflags everything affected.

People defaults change to match: a person with no `employeeShift` rows defaults to **the location calendar (rung 2/3), not 24×7**. Because that equals the default machine window, unconfigured labor degrades to non-constraining *within plant hours* — the survey's "unconfigured labor is invisible" consensus, without the 24×7 absurdity.

Every schedule computed on rung 2 or 3 is self-explaining in the UI: "Hours assumed from {Location} shifts" / "No shifts configured — assuming Mon–Fri, 8h days."

### 2. One deterministic, whole-location forward simulation

Scheduling becomes a single regenerative pass per **location**:

- **Inputs:** all open operations of `Ready | In Progress | Paused` jobs at the location, machine calendars (ladder above), people data (qualifications, shifts, manning board, absences, overtime), manual pins, material-readiness bounds, and one `now` timestamp taken once at invocation. No `Date.now()` inside the engine.
- **Order:** jobs sorted **deadline class first** (`deadlineType`: ASAP → Hard Deadline → Soft Deadline → No Deadline, the ranking already in `priority-calculator.ts`), then `dueDate ASC NULLS LAST → job.priority ASC → createdAt ASC`; operations within a job in DAG order. Ties deterministic. Leading with deadline class is what makes a new ASAP order (which often has no due date) claim capacity first instead of sorting to the back on a null due date.
- **Placement:** forward-ASAP — earliest feasible slot from `max(now, material-ready, predecessor finish)`. **The backward-pass floor is removed**; `date-calculator.ts`'s business-day targeting is deleted from the placement path. Sticky work centers are the default for ops that have one; ops without a work center get selection (earliest finish among process candidates) — this replaces the `initial`/`reschedule` mode split with one uniform rule.
- **Remaining work, not standard work:** for started operations, remaining labor/machine hours = standard × `(1 − quantityComplete/operationQuantity)` (clamped ≥ 0); setup counts as done once any production event exists on the operation. Anchored at `now`.
- **Outputs, written transactionally per run:** `jobOperation.startDate` + `jobOperation.projectedCompletionAt` (placement results — see the Dual Dates section; `jobOperation.dueDate` is the backward need-by target, diff-written by the need-by pre-pass, never by placement), per-op conflict flags + notes (unchanged shape), `capacityReservation` rows (now a **materialized output** — delete-all-for-location + bulk insert, `scenarioId IS NULL`), and `job.projectedCompletionAt` = last operation's placed end.
- **Overdue verdict:** a job is flagged late when `businessDay(projectedCompletionAt, locationTz) > job.dueDate`, with the existing wait-attribution machinery naming the binding resource. Slack (days early) is now a real, displayable number because ASAP placement finishes as early as capacity allows.

Determinism is a hard requirement: identical inputs + identical `now` ⇒ identical schedule. That, plus sticky work centers and stable ordering, is the nervousness control that makes full regeneration safe.

### 3. "Best we can do" — the expedite what-if

`schedule` gains a read-only mode: `{ locationId, expediteJobId }` re-runs the same simulation with the target job first in the priority order and **returns** its projected completion (+ binding-resource attribution) **without persisting anything**. Surfaced on the job header and dates-board card as "Best case": *"Projected 3 days late. Expedited: 1 day late — bottleneck: Weld, queued behind J000412."* Cheap because the sim is a pure function.

### 4. Reactive layer collapses to "regen the location"

- All existing `notifyScheduleInputsChanged` call sites stay; the wave handler becomes: group stale jobs by location → **regenerate each affected location in full** (Inngest concurrency 1 per location, debounce **30s** — down from 3m, affordable because regen is idempotent and whole-location). The frozen-set semantics, `WAVE_BATCH_SIZE` slicing, and per-chunk flag-clearing disappear; `scheduleOutdatedReason` stamps stay as the between-edit-and-regen UI signal and are cleared once, at regen completion, fixing the stuck-stamp and lost-update defects by construction (a regen always covers the whole location).
- `triggerJobSchedule` remains the exported entry point but becomes a thin emitter of `schedule.inputs.changed` (kind `job`); the immediate single-job reschedule path and the dates board's double-dispatch are deleted.
- The dead `work-center` kind gets its emitters: work-center shift edits, `alwaysOn` toggles, work-center deactivation, and maintenance-dispatch writes that change an offline window (flag set/cleared, timing changed, status closed) — from both ERP and MES dispatch surfaces. `shift` edits already emit.
- The nightly replan remains as the time-passing backstop: regen every location with open jobs.

**Newly-late notification.** Each regen knows every job's before/after `projectedCompletionAt`, so the wave computes the delta: a job is *newly late* when it was on time (or unforecast) before the regen and its new projected business day exceeds its due date. The wave sends one digest `carbon/notify` per assignee (`NotificationEvent.JobsProjectedLate`, `documentIds` = the job ids — the notify pipeline already supports multi-document digests), with the triggering reason in the body ("after: Time off — J. Smith"). Unassigned newly-late jobs are skipped in v1 (they still get badges/flags); a configurable planner recipient group is a follow-up. This is the moment the system stops being a screen you check and starts telling you what changed.

### 5. Dispatch is the simulation's order — `schedulingPolicy` is deleted

The per-work-center execution sequence (`jobOperation.priority`) is simply the placement order (reservation start ascending) from the sim — one source of truth for what runs next. The `schedulingPolicy` table, `schedulingDispatchRule` enum, and the dispatch-rule comparators in `priority-calculator.ts` are removed (no app UI references them; engine + types only). If per-WC dispatch rules return later, they must feed placement order, not renumber it after the fact.

### 6. Capacity view rebuilt on one date basis

The Capacity view becomes a lens on the simulation: per work center per day, **Scheduled** (reservation `workHours` prorated by day overlap — unchanged math, now the star) vs **Available** (machine-calendar hours from the ladder, with people-hours shown for staffed stations rather than *replacing* the calendar number — removing the fallback cliff). Load = Scheduled vs Available, same calendar-day basis. Demand-by-due-date survives as a secondary "Due" lens (it answers a different question), no longer the Load verdict. Assumption badges from §1. The null-`workHours` fallback overcount and the 28-day past-due truncation are fixed in passing.

### 7. Uncertainty & scenario forward-compatibility (design constraints now, features later)

Uncertainty (e.g. a quote that may or may not be ordered) is modeled as a property of the **input set**, never of the engine. The engine stays deterministic forever; what-ifs, scenarios, and (later, enterprise-tier) Monte Carlo are samplers in front of the pure function plus aggregators behind it. Four invariants v1 must hold so that layer is additive:

1. **Seeded determinism.** All tie-breaking is deterministic; if randomness ever enters the engine, the seed is an input. Identical snapshot + identical `now` ⇒ identical schedule, always.
2. **The input snapshot is a serializable value.** The engine consumes one snapshot object assembled up front (the `MasterDataProvider` boundary) and never reads the DB mid-walk. Sampling, overlays, and replay/debugging all operate on that object.
3. **Simulate and persist are separate steps.** The engine returns a schedule; a writer decides its fate — live plan (persist, `scenarioId IS NULL`), scenario (persist under `scenarioId` — column already reserved), or what-if (return only; the expedite mode is the existing proof of this seam). Sim inputs are **operation-shaped values decoupled from DB rows**, so provisional demand can be injected without writing job rows. Never materialize maybe-demand as real Draft jobs — phantom load in live tables is the failure mode to avoid.
4. **A single date is the degenerate case of a distribution.** `projectedCompletionAt` today; optionally `{p50, p90, overdueProbability}` later. UI components that render promise dates/slack take `{date, confidence?}` from day one so bands render additively.

**Demand layers** (the input-set vocabulary): Layer 0 = released jobs (Ready/In Progress/Paused — the live schedule, v1 scope); Layer 1 = firm planned (Planned jobs, MRP planned orders); Layer 2 = provisional (`{sourceRef: quoteLineId, probability, expectedOrderDate, expectedDueDate}` — load profile synthesized in memory from the quote line's method/routing, the same derivation `convertSalesOrderLinesToJobs` uses).

**Deterministic v1.x candidates** (no Monte Carlo, each ~one sim run): capable-to-promise on a quote (inject shadow job, run, don't persist — "if we win this, when can we ship, and what does it push late"); bracket scenarios (committed / expected / all-quotes-win bands); probability-weighted expected load in the medium-term capacity lens (`Σ probability × hours`, display math only). **Enterprise later:** Monte Carlo = Bernoulli win/no-win per quote + per-work-center duration noise calibrated from the projected-vs-actual data (§ queue-time capture), N parallel runs, aggregate to per-job overdue probability and percentile promise dates.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scheduling paradigm | Whole-location deterministic regeneration (pure function), not incremental per-job placement | Kills order-dependence, frozen-set unfairness, and the mark/wave races; determinism + sticky WCs control nervousness; open-op counts make full regen cheap |
| Direction | Forward-ASAP; due dates evaluate and order, never floor placement | The projected finish must carry slack to be an overdue early-warning; JIT flooring erases it |
| Machine availability shape | `workCenterShift` join to the existing `shift` table + `workCenter.alwaysOn` flag | Reuses the shift primitive users already maintain; "which shifts does this machine run" is the simplest possible mental model; survey consensus = plant calendar, per-WC override |
| Default when unconfigured | Location shifts, else stock Mon–Fri 8h week — never 24×7 (except `alwaysOn`) | Missing data must produce a pessimistic-but-plausible forecast; 24×7 fails silent-optimistic, the worst direction for this product goal |
| People with no shift rows | Location calendar (was 24×7) | Matches the default machine window ⇒ unconfigured labor is gracefully non-constraining within plant hours; closes the engine-vs-UI 8h/24×7 contradiction |
| Labor layer semantics | Unchanged (ability gating, manning board, attended windows, team mode) | Verified good; survey says it's ahead of the non-APS field; layers only tighten the forecast |
| Modes | One uniform rule (sticky if assigned, select if not); `initial`/`reschedule` split deleted | New jobs are just part of the next regen; fewer concepts |
| Dispatch rules | Deleted with `schedulingPolicy`; sequence = placement order | They never influenced placement — two sources of truth for execution order; no UI depends on them |
| Expedite what-if | Same sim, target job first, non-persisting | Answers "best we can do" exactly, with zero new machinery |
| Remaining-work netting | Quantity-proportional for labor/machine; setup done after first production event | Simple, uses data that exists; avoids near-done ops inflating the forecast |
| In-flight job dates | In Progress/Paused jobs stay reschedulable (dates are forecasts, not commands) | The forecast must track reality; execution is governed by the dispatch queue |
| Runtime | Stay in the Deno `schedule` edge function, invoked per location; envelope test ≤ 10s @ 2,000 open ops | Same resolution as the 07-05 spec; move to a worker only if the envelope breaks |
| Migration strategy | Revise the unmerged branch migration `20260720121629_capacity-planning.sql` in place (drop `schedulingPolicy`, add new columns/table) | Branch precedent (07-13 changelog: "Branch migrations rewritten in place (unmerged)"); nothing here is on main |
| Multi-tenancy / RLS / services / forms | New table follows the standard template (`companyId`, composite PK, four policies gated on `resources_*`); service fns take `client` first; WC form stays `ValidatedForm` | House rules; heuristics 1–6 all standard, no exceptions |
| Backward compatibility | No frozen surfaces touched; `capacityReservation`/`peopleAssignment` shapes unchanged; `jobOperation.startDate/dueDate` contract unchanged | Only placement *values* change (bounded by hours now) |
| Uncertainty modeling | Engine stays deterministic forever; uncertainty = distributions over the input snapshot (§7 invariants); scenarios/CTP/Monte Carlo are samplers + aggregators around the pure function | Zero-refactor path to the enterprise tier; provisional demand never pollutes live tables |
| Machine downtime | Derived from open maintenance dispatches (`takesWorkCenterOffline` flag + existing timing columns), never stored as separate downtime rows | No lifecycle sync to get wrong; the dispatch the tech logs anyway IS the downtime record; closing it restores hours automatically |
| Job ordering | Deadline class (ASAP→Hard→Soft→None) before due date | An ASAP job with no due date must lead the queue, not trail it on NULLS LAST |
| Newly-late alerting | Wave-computed before/after delta → one digest `carbon/notify` per assignee (`documentIds` multi-job); unassigned jobs skipped in v1 | Reuses the existing notify pipeline's digest support; the regen already knows the delta for free |

## Data Model Changes

All in-place revisions of the unmerged `20260720121629_capacity-planning.sql` (plus its dependents), since this branch owns the entire schema delta.

```sql
-- 1. Lights-out flag
ALTER TABLE "workCenter" ADD COLUMN "alwaysOn" BOOLEAN NOT NULL DEFAULT false;

-- 2. Which shifts a work center operates (empty = all shifts at its location)
CREATE TABLE "workCenterShift" (
    "id" TEXT NOT NULL DEFAULT id('wcsh'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "shiftId" TEXT NOT NULL REFERENCES "shift"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "workCenterShift_companyId_idx" ON "workCenterShift" ("companyId");
CREATE INDEX "workCenterShift_workCenterId_idx" ON "workCenterShift" ("workCenterId");
CREATE INDEX "workCenterShift_shiftId_idx" ON "workCenterShift" ("shiftId");
CREATE INDEX "workCenterShift_createdBy_idx" ON "workCenterShift" ("createdBy");
ALTER TABLE "workCenterShift" ADD CONSTRAINT "workCenterShift_wc_shift_key"
    UNIQUE ("workCenterId", "shiftId", "companyId");
-- RLS: four standard policies; SELECT get_companies_with_employee_role(),
-- writes get_companies_with_employee_permission('resources_<action>').

-- 3. Machine downtime via maintenance dispatches (derived windows, no new table)
ALTER TABLE "maintenanceDispatch"
  ADD COLUMN "takesWorkCenterOffline" BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN "maintenanceDispatch"."takesWorkCenterOffline" IS
  'While this dispatch is open, its work center(s) contribute no scheduling capacity between (actualStartTime ?? plannedStartTime ?? createdAt) and (actualEndTime ?? plannedEndTime ?? open-ended).';

-- 4. Forecast output on the job
ALTER TABLE "job" ADD COLUMN "projectedCompletionAt" TIMESTAMP WITH TIME ZONE;
-- (job.scheduleOutdatedReason / scheduleOutdatedAt stay as-is)

-- 5. Deletions (edit the branch migration in place)
--    DROP: "schedulingPolicy" table, "schedulingDispatchRule" enum, and their RLS.
```

No changes to `capacityReservation`, `peopleAssignment`, `peopleAbsence`, `employeeAbility`, or the conflict columns. `pnpm run generate:types` after migrating.

## API / Service Changes

**Engine (`functions/lib/scheduling/`)**
- `master-data-provider.ts`: new reads — `getWorkCenterShiftWindows(workCenterIds, rangeStart, rangeEnd)` resolving the ladder (WC shifts → location shifts → stock week, expanded via `expandCalendar` in the location tz), and remaining-work inputs (`quantityComplete`, has-production-event per op).
- `scheduling-engine.ts`: `buildFiniteContext` sets `capacityByWorkCenter[].windows` from the ladder (not one open window); people fallback windows = location calendar; ordering + whole-location run; single mode; `persistChanges` scoped to the location's job set + writes `job.projectedCompletionAt`; late verdict vs `dueDate` unchanged in shape.
- `slot-allocator.ts`: unattended remainder accumulates on machine windows (currently pure calendar time); attended paths intersect member windows with machine windows. Everything else unchanged.
- Delete: backward placement targeting in `date-calculator.ts` (file removed or reduced to helpers), dispatch comparators in `priority-calculator.ts` (priority = start-order numbering), `SchedulingMode`/direction plumbing in `types.ts`.
- `schedule/index.ts`: payload becomes `{ locationId, companyId, userId, expediteJobId? }`; expedite mode returns `{ projectedCompletionAt, cause }` without persisting.

**Jobs (`packages/jobs`)**
- `schedule-inputs-changed.ts`: wave = stale jobs → distinct locations → one `schedule` invoke per location; debounce 30s; clear stamps per location on completion. Batch slicing/frozen-set logic deleted.
- `reschedule-job.ts`: deleted (or reduced to a location-regen alias for compatibility).
- `nightly-replan.ts`: emits per-location regens.

**ERP services (`production.service.ts`, `resources.service.ts`)**
- `triggerJobSchedule` → thin event emitter (signature preserved for its ~call sites).
- `getWorkCenterShifts` / `upsertWorkCenterShifts` (resources).
- `getJobExpediteForecast(client, jobId)` → invokes `schedule` with `expediteJobId`.
- `peopleCapacity.server.ts`: `buildPeopleCapacityBuckets` gains the machine-calendar Available series and the one-basis Load; fixes null-`workHours` fallback and the 28-day truncation.

## UI Changes

- **Work center form** (`resources/ui/WorkCenters`): "Operating shifts" multiselect (helper: "Empty = all shifts at {location}") + "Runs 24×7 (lights-out)" toggle.
- **Capacity view**: Load = Scheduled vs Available on calendar days; people-hours as an annotation on staffed stations, not a replacement number; "Due" as a secondary lens; assumption badges ("Hours assumed from {Location} shifts" / "No shifts configured — assuming Mon–Fri 8h").
- **Dates board / Job header**: projected completion + slack badge (e.g. "3d early" / "2d late"), with the schedule note as tooltip; "Best case" action opening the expedite what-if result.
- **No changes** to the People board/matrix, MES boards (they keep reading `priority`), or the Gantt (bars already come from reservations).

## Attended-Window Labor

For a gated operation (a process with `requiresAbility = true`), Carbon reserves the **machine** for the operation's entire elapsed span but reserves a **named person** only for the *attended window* — the setup plus labor time at the start of the op. After the attended window, the machine runs unattended (lights-out) through nights and weekends.

The model, per operation with times `setup`, `labor`, and `machine`:

| Quantity | Formula | Semantics |
|---|---|---|
| Total work | `total = setup + max(labor, machine)` | unchanged duration |
| Attended window | `attended = setup + labor` | person hands-on, at the start of the op |
| Unattended remainder | `max(0, machine − labor)` | machine runs, nobody present |

- The **machine** is reserved for the whole span (it holds the workpiece even while paced by shifts).
- The **person** is reserved only for the attended window, which accumulates only during the chosen person's shift windows (it can span a shift break — the machine sits loaded-idle overnight mid-setup).
- The **unattended remainder** accumulates on calendar time, bounded by the machine's operating-hours calendars (the availability ladder above constrains lights-out running to the machine's own calendar rather than pure 24/7 wall-clock).
- `labor ≥ machine` ⇒ remainder is 0 ⇒ the person is held throughout (this degenerates to fully-supervised behavior; shops needing supervision set `labor = machine`).
- A gated process with `setup = 0` and `labor = 0` produces a zero attended window and therefore **no person reservation** (an unattended operation).
- Ungated ops reserve the machine only.

Named-people booking replaces anonymous operator-pool counts. At placement the engine accumulates the attended window over time and books whoever is actually doing each contiguous stretch:

1. The machine must be free for the whole op span.
2. Attended time accumulates at any instant where at least one eligible person (qualified for the process's ability, on shift, and with no overlapping `Employee` reservation across any ability or work center) is available. Booking a specific person per stretch kills cross-ability double-booking.
3. Each contiguous stretch is booked to a specific person via a `capacityReservation` row with `resourceKind = 'Employee'` and `resourceId = employeeId`. At shift boundaries the op **hands off** (relay) to the next available qualified person. The continuity heuristic keeps the incumbent while on shift and free; at a boundary it prefers the person yielding the earliest continuation, tie-broken by fewest reserved hours.
4. When nobody eligible is available, the op **pauses** — the machine stays loaded and reserved so nothing else can take it — and resumes at the next instant a qualified person is free, surfaced in the schedule note ("Waited Nh for a qualified operator"). Zero eligible people at all is a placement conflict.

The booked names are a plan, not a lock; the floor can still swap people at execution, and MES qualification gating at op start is unchanged. The reservation kind is stored via the enum value `capacityReservation.capacityResourceKind = 'Employee'` (`resourceId` = the employee/user id). The legacy `OperatorPool` enum value remains readable but the engine no longer writes it.

## People / Manning Board

The **People** view lives in the Schedule area (`apps/erp/app/routes/x+/schedule+/people.tsx`, action at `people.update.tsx`, added to `ScheduleNavigation` as "People" with `LuUsers`). It is the digital manning board: a manager assigns each worker to a work center for a date (optionally per shift) before the day starts. It requires `production_update` to edit and is employee-role readable.

**Data model.** Two tables (migrations `20260723212028_people-assignments.sql`, then `20260731192616_people-split-hours.sql`):

- `peopleAssignment` — the planned person→station row. Columns: `id` (`id('people')`), `companyId`, `locationId`, `workCenterId`, `employeeId` (→ `user`), `date` (DATE), `shiftId` (nullable; null = whole day), `hours` (NUMERIC, nullable; null = whole shift), `overtimeHours`, `note`, audit columns. Composite PK `("id","companyId")`. Uniqueness is one row per (`companyId`, `employeeId`, `date`, `COALESCE(shiftId,'')`, `workCenterId`) — a split person can appear in more than one station column the same day.
- `peopleAbsence` — a person is out for a date (person-level, not station-bound). Columns: `id` (`id('crab')`), `companyId`, `employeeId`, `date`, `shiftId` (nullable), `note`, audit columns; unique per person/day/shift.

Both tables carry the four standard RLS policies (SELECT via employee role; INSERT/UPDATE/DELETE via `production_{create|update|delete}`). Assigned-station bookings reuse the existing `capacityReservation` with `resourceKind = 'Employee'`; no new reservation storage.

**Consumption.** Assignments are consumed three ways: (1) the board replaces the whiteboard/huddle artifact; (2) MES defaults each operator's operations screen to their assigned work center — a dismissible chip ("Your station: …"), a default not a lock, backed by a `mes-people-override` session cookie, with the Start qualification gate unchanged; (3) the scheduling engine consumes assignments.

Engine semantics (soft-prefer, plus manned stations, plus absence):
- An assigned station works one op at a time, and its whole present crew works that op **together** — labor is parallelized across the present people (n× wall-clock), while setup and machine time are never compressed (`simulateAttendedTeam` / `allocateAttendedOperation` `team` option in `functions/lib/scheduling/`).
- Gated ops team-book people ∩ qualified on their assigned dates (pass 1); if no feasible slot, fall back to the classic any-qualified single-person relay (pass 2). Unqualified people never speed up gated work.
- Ungated ops at an assigned work center are treated as attended (crew = that day's people; attended hours = `calculateAttendedHours` = setup + labor; machine holds the full span). If the crew can't cover it, the op falls back to machine-only placement, keeping the schedule complete. Ungated ops at an unassigned work center are byte-identical to prior machine-only behavior — a blank board changes nothing.
- Absences subtract the absent person's availability windows on that date everywhere (both people-preferred and qualified-fallback paths).
- People-sourced bookings persist as ordinary `Employee` reservations; the placement note variant "Waited … for the assigned people" (`people-wait`) attributes waits.

Overtime and split hours are consumed as pure window edits (no allocator change): overtime extends the date's last availability window; split hours clip a person's attended time per station, dealt out sequentially in row order (`people-utils.ts`).

**Replan wiring.** People and absence mutations fire `carbon/schedule.inputs.changed` with `kind: "people"` (entityId = `workCenterId`, scoped like `work-center`; absences with no assignment scope like the gated kinds). Handled by `notifyScheduleInputsChanged` in `production.service.ts`, the `"people"` union member in `packages/lib/src/events.ts`, and the mark step in `schedule-inputs-changed.ts`.

**Surfaces.** The People page has a per-view period switcher:
- **Board** — Day and Week (both editable). The Day board is a Kanban grid: a sticky **Unassigned** first column (employees at the location not yet placed, plus a free-hours pool showing "Xh free" chips for partially-allocated people, absent people grayed at the bottom) then one column per active work center with a headcount. Cards carry an amber qualification badge (with tooltip) when the station has gated processes the person lacks (advisory only). Dragging a card always **moves** it (instant, with a success toast). Splitting is done on the artifact: a blue hours chip on each assigned card opens an anchored popover with a ±0.5h stepper (capped at shift minus the person's other rows); lowering hours releases the remainder to the Unassigned pool, and dragging the "Xh free" card to further stations completes an N-way split. A **working-hours editor popover** (Set-as-OFF-day toggle, one row per station with hours + OT inputs, "+ Add station", derived clock-time echo from shift start, live total with an amber over-capacity warning) saves atomically via the `day-hours` intent → `setPeopleDay` (one Kysely transaction). The Week board (`PeopleWeekBoard`) assigns a person to a station for the whole week (one row per working day via `assign-week`/`unassign-week`/`move-week`), with day-level detail edited on the Day board.
- **Matrix** — week only; an employee×day grid with Assignments and Coverage sub-tabs, sticky header + first column, department/shift filters, and an assigned-vs-needed coverage block. Cells are click targets that open the same working-hours editor.
- **Capacity** — week only; a work-center week grid (SAP CM01-shaped) with Demand (open released `jobOperation` hours bucketed by due date, including a Past-due column; Draft/Planned excluded), Scheduled (`capacityReservation.workHours` distributed across each reservation span), Available (people × real shift hours, with a per-weekday shift-calendar fallback for unassigned capacity), and Load rendered as hours over/free with green ≤100% / amber ≤120% / red >120% bands.

Header controls: a date picker (real `Calendar` popover) with prev/next arrows that step day/week per the active view; a shift-filter clock-icon popover ("All shifts"); location in the settings menu; **Copy previous day** and **Copy previous week** buttons (`copyPeopleBoard` / `copyPeopleWeek`, per-day skip rules, overtime never copied); and a **Time off** button opening a range dialog (`setPeopleAbsenceRange`, up to 62 days).

Hour resolution everywhere uses the real shift ladder: assignment `shiftId` → the person's `employeeShift` → the location's most-common shift duration → 8h fallback.

## Employee Ability & Qualification

Qualification is **presence-based**: an `employeeAbility` row means the person is qualified, subject only to optional expiry. The rule, defined once per build context, is:

```
qualified = row exists AND (expiresAt IS NULL OR expiresAt >= today)
```

The former `active`, `trainingCompleted`, and `trainingDays` columns and the "In Training" state are gone. Migration `20260812153418` deletes soft-deleted rows (`DELETE WHERE active = false`), drops those three columns, and redefines `grant_ability_on_training_completion()` to insert the row without the two booleans. `lastTrainingDate` and `expiresAt` are kept; `ability.active` (ability-level soft-delete) is unchanged. Training remains a path to qualification (the `grantsAbilityId` trigger inserts the row) rather than a requirement baked into the model.

The presence-based gate is applied uniformly:
- Scheduler edge function `operator-eligibility.ts` gates on expiry only; `active`/`trainingCompleted` are dropped from the `master-data-provider.ts` load, the `scheduling-engine.ts` PoolEmployee, and `QualifiedEmployeeRow`.
- MES `getOperationEligibility` drops the `!active`/`!trainingCompleted` checks and keeps expiry.
- ERP `getActiveEmployeeAbilities` and the People board qualification badge gate on expiry only.
- ERP resources: `deleteEmployeeAbility` is a hard delete; boolean reads/writes are removed from `getAbilities`, `getAbility`, `getEmployeeAbilities`, and `upsertEmployeeAbilityCell`.
- Validators drop `active`/`trainingCompleted`; `EmployeeAbilityForm` drops the two toggles; `EmployeeAbilityStatus` has three states; the abilities table drops its "Active" column.

Existing rows with `trainingCompleted = false` become qualified (intended); soft-deleted rows are purged so they cannot resurrect.

## Gantt (Real Schedule Data)

`/x/scheduling/gantt` (`apps/erp/app/routes/x+/scheduling+/gantt.tsx`) renders the real schedule for a selected job. The page is a job-timeline lens: it shows when each operation starts and ends (clock-precise from `capacityReservation`), how long it runs, conflicts (red bars with a reason), machine and operator-pool reservations, and actual timecards from production events.

**Data.** Three service functions in `production.service.ts`: `getJobOperationsForTimeline(client, jobId)` (jobOperation + `workCenter(name)` + jobMakeMethod parent/item embeds, including `hasConflict`/`conflictReason`), `getCapacityReservationsByJob(client, jobId)` (scenarioId null), and `getProductionEventsByJobId(client, jobId)`.

**Mapper.** The pure `buildJobTimeline(input)` in `apps/erp/app/modules/production/ui/Schedule/timeline.ts` (unit-tested in `timeline.test.ts`) returns `{ events, totalDuration, windowStart }`. The window spans the min/max over reservations, events, and op dates (a date-only dueDate is inclusive, so +1 day). The root node is the job; assembly nodes appear when there is more than one make method; each operation row takes its offset/duration from the WorkCenter reservation (falling back to op dates as `isPartial`), and sets `isError` from `hasConflict`. Each op's children are a machine-reservation row, an operator-pool row (labeled by ability name), and timecard rows (person accessory; an open event renders `isPartial`).

**Rendering.** The page uses the vendored Trigger.dev trace viewer at `apps/erp/app/components/Gantt/` (`GanttEvent` with `data.offset`, `data.duration` in ms, `message`, `isError`, `isPartial`, and `style.icon`/`accessory`; icons for job, assembly, operation, timecard, inspection, wait). The axis stays relative-duration (vendored code untouched); wall-clock times appear in the selected-span detail panel. The loader defaults `?jobId=` to the latest Ready/In Progress/Paused job for the company and resolves user names (assignees, timecards) and ability names (pool reservations). A job Combobox picker drives selection; the right-hand detail panel shows local start/end datetimes, elapsed duration, work center, status, the conflict reason in red, and a link to the job. Entry points wire in via `path.to.scheduleGantt(jobId?)`, a "Timeline" option in `ScheduleNavigation`, an `ItemCard` "View Timeline" action, and a `JobHeader` "Timeline" action.

## Behavior (the contract this system holds)

- A work center with no `workCenterShift` rows at a location with two shifts (06:00–14:00, 14:00–22:00 M–F): a 24h ungated operation spans three working days inside 06:00–22:00 windows and never occupies a weekend.
- The same operation on an `alwaysOn` work center runs as one continuous 24h span.
- A company with zero shifts schedules within Mon–Fri 08:00–17:00 (location tz), and the schedule/capacity views show the stock-week assumption badge.
- A job whose simulated finish (business day, location tz) is after `dueDate` is flagged with a cause naming the binding resource; a job finishing earlier shows positive slack days — including two jobs competing for one work center where EDD order makes the later-due job late.
- "Best case" on a late job returns a projected date ≤ the current projection, names the binding resource, and persists nothing (reservations unchanged after the call).
- Two consecutive regens with identical inputs and the same `now` produce identical placements (same `startAt`/`endAt`/`resourceId` multiset).
- An In-Progress operation with `quantityComplete = 75%` of `operationQuantity` and a prior production event books 25% of its labor/machine hours from `now` (no setup).
- Per work center, `jobOperation.priority` ascending equals reservation `startAt` ascending after a regen.
- With a blank People board and no gated processes, the schedule is bounded by machine calendars only (previously 24×7).
- Editing a shift, an employee shift, a work-center shift set, `alwaysOn`, a qualification, the manning board, or a due date stamps affected jobs and a single location regen within ~30s clears every stamp it covers.
- Envelope: regen of a location with 2,000 open operations completes in ≤ 10s locally.
- §7 invariants hold: the engine builds one snapshot before placement and issues no DB reads during the walk; the expedite path exercises simulate-without-persist; promise-date/slack UI components accept an optional confidence input (unused in v1).
- An open dispatch with `takesWorkCenterOffline` and a `plannedEndTime` removes exactly that window from its work center's capacity: an op that would have run inside it schedules after (or on a sibling WC), and completing the dispatch restores the hours at the next regen with no other data change.
- A job with `deadlineType = 'ASAP'` and no due date schedules ahead of a job with a due date next week; the displaced job's forecast updates in the same regen.
- A regen that flips a previously on-time job to projected-late produces exactly one in-app notification to that job's assignee, listing every newly-late job for that assignee in one digest; a second identical regen produces none.
- Docs kept in sync: `.claude/rules/scheduling-data-structures.md`, production + resources `AGENTS.md`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Full-regen nervousness (dates shuffle between runs) | Med | Hard determinism requirement; sticky work centers; stable EDD ordering; manual pins honored — identical inputs cannot move dates |
| Regen compute at large plants | Med | ≤10s @ 2k-ops envelope test; per-location scoping; worker fallback per the 07-05 resolution if breached |
| Existing branch testers see dates jump (24×7 → plant hours) and new conflicts appear | Med | This is the honesty the feature exists for; assumption badges + release note; `alwaysOn` restores old behavior per machine |
| Forward-ASAP pulls work early (WIP, early material issue) | Low/Med | The sim is a forecast; execution follows the dispatch queue; optional release damping ("start no earlier than X days before need") is a clean later add |
| 30s debounce too slow for interactive due-date drags | Low | Stamps give immediate UI feedback ("recalculating…"); tune debounce after measuring regen cost |
| Deleting `schedulingPolicy` forecloses per-WC dispatch rules | Low | No UI ever shipped; re-add later only as a placement-order input, which the sim structure now makes possible |

## Dual Dates — need-by targets vs projected completion (implemented 2026-08-18)

> Absorbed from the standalone 2026-08-15 dual-dates spec at consolidation (Brad: one true artifact). Industry precedent: the MRP-II/SAP dual-date model — "basic dates" from backward lead-time scheduling vs "production dates" from capacity scheduling.

Every operation carries two dates with distinct meanings:

| | `jobOperation.dueDate` (need-by) | `jobOperation.projectedCompletionAt` (forecast) |
|---|---|---|
| Direction | Backward from `job.dueDate` | Forward from now, finite capacity |
| Anchored to | Demand (due date + routing + lead times) | Reality (capacity, disruptions, progress) |
| Changes when | Due date, routing, or lead times change | Any scheduling input changes (every regen) |
| Type | `DATE` (day-granular target) | `TIMESTAMP WITH TIME ZONE` (exact placed end) |
| Means | "Finish by this day or the job slips" | "This is when it will actually finish" |

`startDate` keeps its forward-projected-start meaning (board `ORDER BY` and tie-breaks unchanged).

**The backward pass** (`need-by-calculator.ts`, ported from main's `BackwardSchedulingStrategy`): reverse topological walk anchored on `job.dueDate`; each op due at its earliest dependent constraint minus that dependent's `operationLeadTime` (revived columns) minus `assemblyLeadTime` at assembly edges; need-by start = due minus `ceil(durationHours / calendarHoursPerDay(wc))` working days; `With Previous` copies its partner; pins pass through and propagate upstream; no conflict flags. Day-lengths and working days come from the availability ladder via `calendarAdapters` — the working-day test uses the calendar's **weekly openness pattern**, not literal window presence, so targets resolve for dates outside the loaded [now, horizon] windows (regression-tested: no year-runaway) and stay invariant to date-specific capacity loss (downtime moves projections, never targets). **Cadence:** recomputed as a pure pre-step in every regen; `dueDate` is diff-written (zero writes on quiet regens). **Hard rule, test-enforced:** placement reads nothing from `op.dueDate` (one documented exception: a pinned Outside-Processing op's chaining window); the determinism suite asserts placements are byte-identical with and without targets (mutation-tested).

**Pins:** `manuallyScheduled` = a human owns the need-by (`updateJobOperationDueDate` + the BOP picker, which now fires the regen wave). The old frozen-window placement branch is removed — pinned ops place normally; the pin propagates upstream through the backward walk.

**Lateness & urgency:** job verdict unchanged (projected vs `job.dueDate`; newly-late digest unchanged). Per-op behind-target (projected day > need-by) is an **informational amber state** on BOP rows, ops-board cards, and MES operation detail — never `hasConflict`. When the job is late, `composeBehindTarget` appends "First behind target: {op} (due X, projected Y)" to the job's cause sentence (expedite dialog). Consumers that keyed urgency on op `dueDate` (MES queue sort + overdue, ops-board overdue, Capacity Demand buckets, picking schedule) became semantically correct with no code change. `getJobPromiseDate`'s `max(op.dueDate)` fallback was removed (circular under need-by semantics).

**Schema** (`20260818031629_dual-dates.sql`, forward migration — `get_job_operation_by_id`'s newest definition was main-owned, so no in-place edit): `jobOperation.projectedCompletionAt` + column comments pinning both contracts; `get_active_job_operations_by_location` and `get_job_operation_by_id` return the projection. No backfill — the first regen rewrites both date columns.

**Verification:** 155 engine tests green (need-by walk, adapters, placement isolation, target stability); browser-verified live 2026-08-18 — all five scenarios PASS (BOP dual dates; due-date drag tightens targets while projections hold; pin survives regens and re-derives upstream; downtime flips amber behind-target with byte-identical targets and the first-behind-target cause; MES projected line with unchanged queue order). The browser run surfaced and fixed two defects: the weekly-pattern working-day test (year-runaway) and the pin's missing regen emit.
