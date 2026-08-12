# Finite Capacity Scheduling — Skill- and Schedule-Aware Load Balancing

> Status: implemented (as built on naveen/capacity-planning, per the 2026-07-13 simplification; superseded going forward by [2026-08-12-forecast-first-finite-scheduling.md](../2026-08-12-forecast-first-finite-scheduling.md))
> Author: Naveen Kashyap (with research assistance)
> Date: 2026-07-05

## TLDR

**Capacity planning, as this spec defines it, is distributing work across the shop so that every operation lands where a machine has room for it and a person with the right skills is on shift to run it.** Today Carbon's scheduler places operations on the *least-loaded* work center with no hard capacity ceiling, no calendars, and no notion of who is qualified or available to run the work. This spec extends the existing `schedule` edge function into a finite, dual-resource-constrained (DRC) scheduler: an operation is placed only when a work-center slot **and** a qualified, on-shift operator are simultaneously free. Everything else falls out of that engine — realistic promise dates (lead time becomes an *output* of the schedule, not a padded constant), "why is this late" diagnostics, and what-if staffing scenarios ("add 2 welders", "cross-train Alice on CNC") run as a re-schedule against overlaid master data. We extend the existing engine; we do not replace it.

## Problem Statement

Planners cannot answer three questions today:

1. **"If I accept this order, when can I realistically ship it?"** — promise dates come from fixed `operationLeadTime` offsets, not actual load. Fixed offsets cause the classic Lead Time Syndrome (late jobs → pad lead times → earlier releases → more WIP → longer queues → more lateness). Queue time is 80–90% of real lead time and is invisible today.
2. **"Which operations are late, and why?"** — is it a machine, a missing skill, or a person? Labor is a free-text `assignee`; skills gate nothing at scheduling time.
3. **"What happens if I add two welders, cross-train an operator, or run the CNC cell on a second shift?"** — no way to test staffing changes against throughput or lead times.

### What exists today (verified against code)

Carbon already has a working, dependency-aware scheduling engine — this spec is an extension, not a greenfield build:

- **Scheduler:** edge function `packages/database/supabase/functions/schedule/index.ts` (`mode: "initial" | "reschedule"`, `direction: "backward" | "forward"`) with a full library in `functions/lib/scheduling/` (`scheduling-engine.ts`, `dependency-manager.ts` with topological sort, `work-center-selector.ts`, `priority-calculator.ts`, etc.). Triggered from `production.service.ts → triggerJobSchedule()` → Inngest `reschedule-job.ts`. It is **infinite-capacity with load-balancing**: `work-center-selector.ts` picks the least-loaded center from an in-memory load sum. No capacity ceiling, no calendar slots, no overbooking prevention.
- **Operations:** `jobOperation` has setup/labor/machine times with `factor` units, a numeric `order` column plus the `operationOrder` enum (`After Previous` | `With Previous`), `startDate`/`dueDate`, and — already present — `hasConflict`/`conflictReason`. A real dependency DAG exists (`jobOperationDependency` + `jobOperationsWithDependencies` view + triggers propagating `Waiting → Ready → Done`).
- **Resources:** `workCenter` has cost rates and a single nullable `requiredAbilityId` — the only skill gate. No parallelism/machine count, no per-resource calendar. `shift` is one start/end time + weekday booleans per location; `holiday` is company-level.
- **People & skills:** `ability` has a `curve` JSONB learning curve + `shadowWeeks`; `employeeAbility` has `lastTrainingDate`/`trainingDays`/`trainingCompleted` but no expiry. Labor actuals are well-instrumented (`productionEvent` with typed Setup/Labor/Machine durations per employee and work center).
- **Three disconnected training systems** (Academy `lessonCompletion`, ERP `training`/`trainingCompletion`, and `employeeAbility`) — none write back to `employeeAbility`, so "finished training X ⇒ qualified for work center Y" is not modeled.

### The gap

| Capability | Today | Needed |
|---|---|---|
| Hard finite capacity | Soft load-balancing only | Slot allocation + overbooking prevention |
| Resource calendars | `shift` (location window + weekday flags) | Per-resource calendars, efficiency %, exceptions |
| Machine parallelism | None (implicit 1) | `parallelCapacity` per work center |
| Skill gating | One `requiredAbilityId` per work center | Operation-level required abilities, expiry |
| Labor as a scheduled resource | Free-text `assignee` | Qualified, calendar-available operator as a scheduling constraint |
| Training → qualification | Disconnected | Completion upserts `employeeAbility` |
| Lead time | Fixed offsets | Schedule-derived + queueing diagnostics |
| What-if staffing | None | Scenario overlay + re-run + KPI diff |
| Schedule visualization | DAG view + period table | Gantt / schedule board |

## Proposed Solution

Four layers, in dependency order. The heart is layer 3 — the load-balancer that implements capacity planning as defined above.

### 1. Availability layer — when is a resource available, and how much of it is there?

- **`resourceCalendar`** (+ recurring shift rows + exception rows): a named calendar of working time assignable to a work center (later: a person). Multiple windows per day (split shifts); exceptions for holidays, maintenance, one-off overtime. Backfill one calendar per existing `shift` and seed exceptions from `holiday` so nothing regresses; the scheduler falls back to the location default when a resource has none.
- **`workCenter.parallelCapacity`** (default 1): number of simultaneous operations — "five identical welding benches" is capacity 5.
- **`workCenter.schedulingMode`** (`Finite` | `Infinite`, default `Finite`): per-resource escape hatch preserving today's behavior where wanted.
- **`workCenter.efficiencyFactor`** (default 1.0) scales standard times. **Operator proficiency is derived, not entered:** evaluate `ability.curve` at `now − employeeAbility.lastTrainingDate` — ramp-aware labor throughput from data we already have.

### 2. Skill layer — who is qualified to do the work?

- **`processAbility`** (template default) and **`jobOperationAbility`** (concrete, copied at job creation the same way operations instantiate from `makeMethod`): required abilities with optional `minimumProficiency`. `workCenter.requiredAbilityId` stays as a coarse fallback when no operation-level requirement is set.
- **Qualification expiry:** add `employeeAbility.expiresAt` + `ability.recertifyEveryDays`. An operator is **eligible** iff `active ∧ trainingCompleted ∧ (expiresAt is null ∨ expiresAt > scheduledStart) ∧ derivedProficiency ≥ minimumProficiency`. The scheduler and MES both enforce this (capability lockout).
- **Training → qualification bridge:** `training.grantsAbilityId`; on `trainingCompletion` insert, a trigger upserts `employeeAbility` (sets `trainingCompleted`, `lastTrainingDate`, `expiresAt`). Optional `academyCourseAbility (courseId TEXT, abilityId)` map lets Academy completions grant abilities too. This makes cross-training a real scenario lever (layer 4).

### 3. The load-balancer — finite, DRC slot allocation (the core)

Extend `work-center-selector.ts` (keeping the engine's interface: mode, direction, DAG, priority):

1. For each operation in dependency-topological + priority order, compute duration from `setup/labor/machineTime × factor × quantity`, scaled by work-center and operator efficiency.
2. Walk the candidate work center's **calendar** forward (or backward) from the earliest feasible start (predecessor finish, per the existing DAG) to the first window where **(a)** a parallel slot is free (`< parallelCapacity` concurrent ops) **and (b)** the qualified-operator pool for the required abilities has ≥ 1 person free on shift. That "both free" gate is the DRC core — load is balanced across machines *and* the workforce's skills and schedules simultaneously.
3. `schedulingMode = 'Infinite'` skips the ceiling (current behavior).
4. Persist: write `startDate`/`dueDate` on `jobOperation`, insert **`capacityReservation`** rows (see Data Model) so allocations are durable across jobs and scheduler runs. When no feasible slot exists before the due date, set the existing `hasConflict`/`conflictReason` (e.g., "No qualified welder available before due date") — conflicts surface, never fail hard.
5. **Dispatch rule is a configurable policy** (`schedulingPolicy`: company default, per-work-center override): CR / EDD / SPT / WSPT / FIFO / MinSlack, reusing `priority-calculator.ts` and `job.priority`. Greedy and explainable first; a solver is a later optional swap-in behind the same interface.

### 4. Outputs — lead times and what-if staffing

- **Promise dates from the schedule:** `predictLeadTime(job|item, quantity, asOf) → { promiseDate, confidence, basis }` where v1 basis = scheduled finish of the job's last operation. Recomputed on reschedule. Kills fixed lead-time offsets.
- **Queueing diagnostics (the "why"):** per-resource utilization ρ from reservations + variability from `productionEvent` actuals feed Little's Law and Kingman's VUT approximation — explaining *why* lead times explode near full utilization and giving instant analytical pre-checks ("adding a welder drops welding ρ 0.92 → 0.74 ⇒ queue time falls ~75%") before a full re-run. Add **queue-time capture**: the gap between an operation turning `Ready` (existing trigger) and its first `productionEvent` — the single most valuable measurement for diagnostics and any future ML model (deferred; same `predictLeadTime` interface).
- **What-if scenarios:** `schedulingScenario` + sparse `scenarioOverride` rows (add N of a skill, toggle an `employeeAbility`, add a shift, change `parallelCapacity`/`efficiencyFactor`) — a **sparse overlay on live master data, not a copy**. Re-run the same scheduler reading (live ⊕ overrides), writing reservations tagged `scenarioId` so the live plan is untouched. Compute KPIs (on-time %, avg/P95 lead time, throughput, utilization, bottleneck), diff side-by-side, optionally **promote** overrides to live.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Extend vs replace scheduler | Extend `schedule` edge function + `lib/scheduling/*` | Engine, DAG, priority, and trigger path already work; the placement logic is the only seam that changes |
| Resource abstraction | Keep `workCenter` primary; polymorphic `jobOperationAbility` / reservations rather than a unified `resource` table | Less disruptive; unify later if tools/fixtures proliferate |
| Secondary resources in v1 | One qualified operator only | Highest-value DRC case; tools/fixtures are a fast-follow on the same tables |
| Operator reservation depth | Cumulative pool check (≥1 qualified operator free per skill per window), not named per-person slots | Lighter and sufficient for load-balancing; upgrade to named reservation if shops need it |
| Proficiency source | Derived from `ability.curve` + `lastTrainingDate`; manual `proficiencyOverride` wins if set | Data already exists; override handles exceptions |
| `workCenter.requiredAbilityId` | Keep as coarse fallback | Back-compat; operation-level requirements override |
| Optimization approach | Greedy heuristic dispatch rules, no MILP/CP solver, no discrete-event sim | Fast, explainable, sufficient for v1; solver/DES can swap in behind stable interfaces later |
| Scenario storage | Sparse override overlay, not schedule copy | Cheap to create; requires the engine to accept a master-data provider (open question) |

## Data Model Changes

All tables `companyId`-scoped with composite PK `("id", "companyId")`, `id('prefix')` defaults, standard audit columns, RLS via the existing permission helpers. Sketches (abridged — audit/RLS boilerplate per template):

```sql
CREATE TABLE "resourceCalendar" (
    "id" TEXT NOT NULL DEFAULT id('rcal'),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,            -- FK location; timezone defaults from location
    "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE "resourceCalendarShift" (   -- recurring pattern; multiple rows/day = split shifts
    "resourceCalendarId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,        -- 0-6
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL
);
CREATE TABLE "resourceCalendarException" (  -- holidays, PM windows, one-off OT
    "resourceCalendarId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('Closed','Open','ReducedCapacity')),
    "capacityOverride" NUMERIC
);

ALTER TABLE "workCenter"
    ADD COLUMN "parallelCapacity" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "resourceCalendarId" TEXT,          -- nullable → location default
    ADD COLUMN "efficiencyFactor" NUMERIC NOT NULL DEFAULT 1.0,
    ADD COLUMN "schedulingMode" TEXT NOT NULL DEFAULT 'Finite';  -- 'Finite'|'Infinite'

CREATE TABLE "workCenterCapacity" (      -- time-phased capacity: effective-dated overrides
    "id" TEXT NOT NULL DEFAULT id('wcc'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,                  -- null = open-ended
    "parallelCapacity" INTEGER NOT NULL
);
-- Resolution order: workCenterCapacity row covering the date → workCenter.parallelCapacity.

CREATE TABLE "processAbility" (          -- template-level defaults
    "processId" TEXT NOT NULL,
    "abilityId" TEXT NOT NULL,
    "minimumProficiency" NUMERIC,
    PRIMARY KEY ("processId", "abilityId", "companyId")
);
CREATE TABLE "jobOperationAbility" (     -- concrete, copied from method at job creation
    "operationId" TEXT NOT NULL,
    "abilityId" TEXT NOT NULL,
    "minimumProficiency" NUMERIC
);
-- (methodOperationAbility mirrors jobOperationAbility at the routing-template level)

ALTER TABLE "employeeAbility"
    ADD COLUMN "expiresAt" DATE,
    ADD COLUMN "proficiencyOverride" NUMERIC;
ALTER TABLE "ability" ADD COLUMN "recertifyEveryDays" INTEGER;
ALTER TABLE "training" ADD COLUMN "grantsAbilityId" TEXT;  -- + completion trigger → employeeAbility

CREATE TABLE "capacityReservation" (
    "id" TEXT NOT NULL DEFAULT id('cres'),
    "resourceKind" TEXT NOT NULL,        -- 'WorkCenter' | 'OperatorPool'
    "resourceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ NOT NULL,
    "scenarioId" TEXT                    -- null = live plan
);

CREATE TABLE "schedulingPolicy" (
    "workCenterId" TEXT,                 -- null = company default
    "dispatchRule" TEXT NOT NULL DEFAULT 'EDD'  -- 'CR'|'EDD'|'SPT'|'WSPT'|'FIFO'|'MinSlack'
);

CREATE TABLE "schedulingScenario" (
    "id" TEXT NOT NULL DEFAULT id('scen'),
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft'  -- 'Draft'|'Simulated'|'Promoted'|'Archived'
);
CREATE TABLE "scenarioOverride" (        -- sparse: only what changed
    "scenarioId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,          -- 'WorkCenterCapacity'|'CalendarShift'|'Efficiency'
                                         -- |'EmployeeAbility'|'AbilityHeadcount'
    "targetRef" TEXT,
    "payload" JSONB NOT NULL
);
```

Migration-time backfill: one `resourceCalendar` per existing `shift`; exceptions seeded from `holiday`. Run `pnpm run generate:types` after migrating.

## API / Service Changes

- **`functions/lib/scheduling/work-center-selector.ts`** — replaced by the calendar-walking slot allocator (§3 above). `scheduling-engine.ts` gains a master-data provider parameter so it can read live data or live ⊕ scenario overrides. Reservation writes are bulk/transactional; a full reschedule clears and rebuilds the live plan's reservations.
- **`production.service.ts`** — `triggerJobSchedule()` unchanged as entry point; add scenario-run and promote-scenario service functions; add `predictLeadTime`.
- **New periodic rollup job** (Inngest): per-resource utilization ρ, duration CVs, and mean service time from `capacityReservation` + `productionEvent`, feeding the planning UI and the VUT pre-check.
- **Long-horizon capacity outlook** (fast-follow, demoted from "capacity planning" to avoid the naming clash): weekly/monthly load-vs-available rollup **by work center and by skill** ("welding is 140% loaded in August; 3.5 FTE of qualified welders vs 5 FTE of demand") as a materialized view over the same calendars and ability data — a lens on `planning.tsx`, no per-minute scheduling.

## UI Changes

- **Schedule board / Gantt** (new — biggest UX gap): resource-swimlane timeline (work centers + operator pools), drag-to-reschedule writing reservations, conflict coloring. Lives alongside `routes/x+/production+/planning.tsx`; needs a dedicated timeline component (the #787 `@xyflow/react` DAG view doesn't cover this).
- **Capacity/load lens on `planning.tsx`:** load vs capacity % per bucket by work center *and by skill*, with high-utilization warnings.
- **Scenario workspace:** create/edit overrides, run, side-by-side KPI diff, promote.
- **MES eligibility lockout:** when assigning/scanning onto an operation, show qualified operators and block unqualified/expired ones.
- **Skills administration** (resources module): ability-scoped rosters (each ability's detail page lists ONLY its qualified employees with proficiency, expiry, and 30/60/90-day warnings) plus an editable abilities panel on the person page. ~~Person × ability grid~~ — rejected 2026-07-06: sparse and noisy at scale (a Welding column is meaningless for a software engineer); Training (phase 7 bridge) is the primary path to qualification, the roster is the correction/audit surface.

### Schedule freshness (fast-follow)

Conflict flags (`jobOperation.hasConflict`/`conflictReason`) and `capacityReservation`
rows are **snapshots written at scheduling time** — they do not react to roster,
calendar, or capacity changes, nor to time passing (an operator expiring overnight
invalidates the plan with zero data changes). Freshness plan:

1. **Nightly replan cron — BUILT 2026-07-08** (`packages/jobs/src/inngest/functions/scheduled/nightly-replan.ts`):
   01:00 UTC (before the 02:00 capacity rollup), reschedules every Ready / In Progress /
   Paused job via the `schedule` edge function (`mode: "reschedule"`, `userId: "system"`),
   sequentially per company in due-date order so urgent jobs claim capacity first.
   Bounds staleness to <24h for every cause. Reschedule mode is **work-center
   sticky**: an operation that already has a work center keeps it (candidates
   pinned; fallback to process candidates only if the assigned WC lost its
   capacity data) — machines are (re)picked only at initial scheduling or by an
   explicit move on the operations board, so the nightly replan never shuffles
   assignments overnight.
2. **Event-driven partial reschedule — DEFERRED (user decision 2026-07-08).** When built:
   the app-layer writers of qualification data (the three employee-ability drawer actions
   on the roster/person panel, and the training-completion path whose DB trigger grants
   abilities) emit `carbon/ability.qualification.changed { companyId, abilityId }`; an
   Inngest handler resolves affected jobs (active status ⋈ `jobOperationAbility` on that
   ability, falling back to `processAbility`), debounces per job to avoid reschedule
   storms from bulk roster edits, and fans out to the existing `carbon/reschedule-job`
   task. Same treatment later for calendar/exception/capacity-override edits → jobs with
   future `capacityReservation` rows on the affected work center. Semantics: full replan
   of not-started operations (the engine's existing `mode: "reschedule"` behavior) — no
   flag-only mode.

## Phased Rollout

1. **Master data:** calendars + exceptions, `parallelCapacity`/`efficiencyFactor`/`schedulingMode`, backfill from `shift`/`holiday`. No behavior change yet.
2. **Capability model:** operation/process required abilities, eligibility rule, expiry, skills-matrix UI.
3. **Finite scheduler core:** slot allocator with machine + qualified-operator-pool DRC, `capacityReservation`, dispatch rules. *The heart.*
4. **Dynamic lead time:** `predictLeadTime`, queue-time capture, VUT diagnostics.
5. **Schedule board / Gantt + capacity lens.**
6. **Scenario engine:** staffing levers, KPI diff, promote.
7. **Training → ability bridge** (makes cross-training a real scenario lever).
8. **Fast-follows:** tools/fixtures as secondary resources, bottleneck/drum-buffer-rope scheduling, sequence-dependent setup families, ML lead-time layer, long-horizon outlook if not folded into 5.

Steps 1–4 deliver the core promise; 5–6 the visibility and what-if headline.

## Acceptance Criteria

- [ ] Scheduler never books more than `parallelCapacity` concurrent operations on a `Finite` work center, across jobs and across runs (reservations are authoritative).
- [ ] An operation requiring ability X is only scheduled into windows where ≥ 1 qualified (active, trained, unexpired, proficiency ≥ minimum), calendar-available operator exists.
- [ ] Infeasible placements set `hasConflict`/`conflictReason` with a human-readable cause (machine vs skill vs calendar); scheduling never hard-fails.
- [ ] `schedulingMode = 'Infinite'` reproduces current placement behavior; a company with no calendars/abilities configured schedules exactly as today after backfill.
- [ ] Promise date = scheduled finish of the job's last operation; recomputed on reschedule.
- [ ] Queue time (Ready → first `productionEvent`) is captured per operation.
- [ ] Running a scenario writes only `scenarioId`-tagged reservations; the live plan and live master data are untouched until promote.
- [ ] `trainingCompletion` with `grantsAbilityId` upserts `employeeAbility` with correct `expiresAt`.
- [ ] MES blocks assignment of unqualified/expired operators to gated operations.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Master-data burden (calendars, capacities, skills matrices) — without them finite scheduling is worse than today | High | Aggressive backfill defaults (phase 1); `schedulingMode = 'Infinite'` escape hatch per resource |
| Edge-function compute limits on large plants (calendar walking ≫ today's load pass) | Med | Prototype in the edge function; be ready to move the hot loop to a Trigger.dev task (MRP already runs there) |
| Over-constraining → everything conflicts when skill data is sparse | Med | Fall back to `workCenter.requiredAbilityId` when no operation-level requirement is set; conflicts surface, never fail |
| Planners distrust dynamic lead times and re-pad (Lead Time Syndrome returns) | Med | Always show the *why* (utilization/VUT) alongside the date |
| Scope creep toward a full APS (solver, DES) | Med | Heuristic first; solver/DES only behind the stable `predictLeadTime` / scheduler interfaces |

## Open Questions

> All resolved 2026-07-06 — implementation may proceed.

- [x] **Scheduler runtime:** ~~edge function vs worker?~~ **Resolved: keep the hot loop in the Deno `schedule` edge function for v1.** The trigger path (`production.service.ts` → Inngest → invoke) stays untouched; move to a worker later only if large plants hit compute limits (per Risks).
- [x] **Master-data provider:** ~~confirm `scheduling-engine.ts` can be parameterized~~ **Resolved: feasible, verified against code (2026-07-06).** `SchedulingEngine`, `WorkCenterSelector`, `AssemblyHandler`, and `MaterialManager` all receive `db`/`client` via constructor injection already — the natural seam. Reads are *not* isolated today: ~19 read call sites are scattered across those 4 files (14 in the engine, the load query inside `WorkCenterSelector.calculateLoadBeforeDate` on the hot loop, 3 in assembly-handler incl. one Supabase RPC, 2 in material-manager). The refactor: introduce a `MasterDataProvider` interface + Kysely-backed live implementation + overlay implementation, relocate the read sites behind it; the ~1,000 lines of pure calculators (date/duration/priority/dependency) need no change. Side benefit: fixes the triple `buildAssemblyTree` re-query. Note: `resource-manager.ts` (521 lines) is dead code — imported nowhere; delete or ignore, don't extend it.
- [x] **Time-phased work-center capacity:** **Resolved: build the effective-dated `workCenterCapacity` child table in v1** (see Data Model), resolving `workCenterCapacity` row covering the date → `workCenter.parallelCapacity` fallback.

## Competitive References (condensed)

Dual-resource (machine + qualified operator) finite scheduling is the enterprise frontier (Epicor Kinetic, Infor SyteLine, SAP PP-DS primary/secondary resources, Siemens Opcenter/Preactor, DELMIA Ortems, Plex) and is absent in the SMB tier (Katana, MRPeasy, stock Odoo) — Carbon's differentiation opportunity. The what-if pattern everywhere reduces to "copy capacity master data → edit → re-run → KPI-diff" (SAP simulation versions, Opcenter what-if plans). Lead time as a scheduler *output* (vs fixed MRP offsets) and queue-time dominance (80–90% of lead time) come from the Factory Physics / Kingman VUT literature. Full research transcripts with source URLs: `tasks/*.output`.

## Changelog

- 2026-08-12: Marked implemented and moved to implemented/. Phases 1–7 (as re-scoped on 2026-07-13) shipped on the branch: finite DRC engine with attended windows, process-gated abilities, durable reservations, dispatch-rule priorities, conflict diagnostics, reactive replanning, People manning surfaces, and the training→ability bridge. The scenario engine (phase 6 of the original numbering) was never built. Superseded going forward by 2026-08-12-forecast-first-finite-scheduling.md: machine operating hours return as a first-class constraint (reversing part of the 07-13 simplification), placement becomes forward-ASAP whole-location deterministic regeneration, and schedulingPolicy dispatch rules are removed.
- 2026-07-13: **Major simplification (user decision after manual testing).** Removed: resource calendars (`resourceCalendar`/`Shift`/`Exception` tables + UI), `workCenter.parallelCapacity`/`efficiencyFactor`/`schedulingMode`/`resourceCalendarId`, time-phased `workCenterCapacity`, `workCenterUtilization` + capacity-rollup cron, operation-level ability tables (`processAbility`/`methodOperationAbility`/`jobOperationAbility`) and their BOM UI, `minimumProficiency`/`proficiencyOverride`/derived-proficiency checks, and the `workCenter.requiredAbilityId` fallback. New model: every work center is **always finite, capacity 1, open 24×7**; ability requirements live on the **process** (`process.requiresAbility` + an auto-created ability linked 1:1 via `ability.processId` — `ensureProcessAbility`); employee qualification is binary (`employeeAbility` active ∧ trainingCompleted ∧ not expired — training bridge and rosters unchanged); operator availability comes from the person's shifts (`employeeShift` ⋈ `shift`, no assignment = always available) — gated operations accumulate work only while a qualified person is on shift. Overtime deferred (no-fit-before-due-date ⇒ conflict). Branch migrations rewritten in place (unmerged).
- 2026-07-08: Job-timeline Gantt lens shipped (`/x/scheduling/gantt` fed by real jobOperation + capacityReservation data, mapper unit-tested; work-center lens deferred). Conflict indicators wired to the ERP operations board (RPC migration 20260707143131) and MES schedule cards. Engine fix: pg DATE columns (JS `Date` at local midnight) were `String()`-ed into lexicographic comparisons, silently disabling operator-pool expiry and capacity-override effectivity — normalized via `toIsoDate` (`date-utils.ts`), predicate extracted to `operator-eligibility.ts`, 13 new Deno tests (35 total green). Zero-duration operations no longer abort scheduling (reservation `endAt > startAt` filter). Nightly replan cron added (see Schedule freshness); event-driven reschedule deferred.
- 2026-07-07: Skills matrix replaced by ability-scoped rosters + editable person-page abilities panel (user decision — the grid was sparse noise at scale). Training→ability bridge (phase 7) implemented: `training.grantsAbilityId` + `grant_ability_on_training_completion` trigger (migration 20260706112951), verified against restored prod data.
- 2026-07-06: Phases 1–4 implemented (plan: .ai/plans/2026-07-06-finite-capacity-scheduling.md). Master data (calendars/exceptions, parallelCapacity/efficiencyFactor/schedulingMode, time-phased workCenterCapacity, backfill from shift/holiday), capability model (process/method/jobOperation ability tables, expiry, skills matrix + abilities admin UI, MES start lockout, get-method copy-through), finite DRC scheduler (MasterDataProvider seam, calendar expansion + slot allocator with 22 Deno tests, operator pools with derived proficiency, dispatch rules, durable capacityReservation lifecycle), dynamic lead time (readyAt trigger + jobOperationQueueTime view, getJobPromiseDate, nightly workCenterUtilization rollup cron). Phases 5–8 (Gantt, capacity lens, scenarios, training bridge) remain — spec stays in specs/, not implemented/.
- 2026-07-06: All three open questions resolved (edge-function runtime; master-data provider feasibility verified against `lib/scheduling/*` code; time-phased `workCenterCapacity` table added to data model). Status → approved for implementation.
- 2026-07-05: Created — refined from the 2026-07-03 research draft; re-centered on the operational scheduling core (machine capacity + operator skills and shifts), restructured to house template, all code claims verified against migrations and `functions/lib/scheduling/*`.
