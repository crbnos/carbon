# Forecast-First Scheduling — adoption-level test plan

**Spec:** .ai/specs/implemented/2026-08-12-forecast-first-finite-scheduling.md
**Implementation:** naveen/capacity-planning (all plan tasks complete)
**Companion playbook:** .ai/playbooks/forecast-first-scheduling.md (drives the mechanics; this plan drives the adoption scenarios)

## What this plan proves

The architecture's core promise is **layered accuracy**: a shop gets a trustworthy
overdue forecast at zero configuration, and every layer of resource planning it
adopts only *tightens* that forecast — never changes its meaning, never breaks it.
Three tenets, each testable:

1. **Missing data constrains, never liberates.** No shifts ≠ 24×7; an unmanned
   station ≠ infinite labor; an unconfigured person ≠ always available.
2. **Semantics are continuous across the adoption boundary.** A partially-manned
   shop gets staffed-team behavior where it manned and honest fallbacks where it
   didn't — with the machine calendar bounding everything either way.
3. **The forecast reacts to reality, deterministically.** Same inputs → same
   dates. A changed input → stamps immediately, regen ≤ ~1 min, newly-late
   digest fires exactly once.

## Fixture: one company, three locations

Scheduling, shifts, work centers, people, and jobs are all location-scoped, so
one dev company with three locations isolates the levels cleanly:

| Location | Adoption level | Setup |
|---|---|---|
| **L0 "Zero Config"** | None | NO shifts at this location. 2 work centers (one `alwaysOn`), 2 ungated processes, jobs with due dates. No abilities, no manning. |
| **L1 "Full Planning"** | Complete | Two shifts (06–14, 14–22 M–F). 3 work centers (one with explicit operating shifts = 1st only). 2 gated processes (`requiresAbility`) + 1 ungated. 4 employees: 2 qualified welders (one per shift), 1 qualified with **no** employeeShift row, 1 unqualified. Manning board staffed for the current week incl. one split day and one overtime grant. |
| **L2 "Partial"** | Mixed | One shift. Gated + ungated processes. Manning board staffed **Mon–Wed only**; abilities configured for one process only; one employee with shifts, one without. |

Seed ~10 jobs per location with staggered due dates, one `deadlineType = 'ASAP'`
with **no due date**, and one job In Progress with recorded quantities.

## Scenario A — company doesn't use resource planning (L0)

The zero-config shop must get the headline value (overdue forecast + best case)
with nothing but jobs and due dates.

| # | Test | Expected |
|---|---|---|
| A1 | Schedule jobs; inspect reservations + resource timeline | All placements inside Mon–Fri 08:00–17:00 (stock week, location tz); zero weekend/overnight minutes on non-`alwaysOn` WCs |
| A2 | The `alwaysOn` WC | Runs continuously through nights/weekends — the lights-out escape hatch works |
| A3 | Assumption honesty | Capacity view + schedule surfaces show "No shifts configured — assuming Mon–Fri, 8h days" banner |
| A4 | Overdue forecast | Overloaded WC → later jobs flagged late with "queued behind J-xxx" cause; underloaded jobs show positive slack ("Nd early") — NOT finishing exactly at due date |
| A5 | Best case | Expedite what-if on a late job returns ≤ current projection, names the machine queue as binding; persists nothing |
| A6 | No phantom labor | Zero `Employee`-kind reservations exist; nothing ever waits on an operator |
| A7 | Add shifts later (upgrade path) | Create two shifts at L0 → regen → schedule expands into the real 16h windows; banner switches to "assumed from location shifts"; no other behavior change |

**Level-0 pass bar:** a shop that has entered nothing but jobs gets honest,
hours-bounded promise dates and never sees a people concept it didn't configure.

## Scenario B — company fully uses resource planning (L1)

| # | Test | Expected |
|---|---|---|
| B1 | Gated op, staffed station, 2 qualified present | Team mode: labor wall-clock halves vs solo; setup and machine time NOT compressed; both people booked on the same op (overlapping Employee reservations) |
| B2 | Shift handoff | A long gated op relays across the 14:00 shift boundary to the second-shift welder; work pauses if nobody qualified is on shift |
| B3 | WC with explicit "1st shift only" operating hours | Its ops never place 14–22 even though the location runs two shifts (rung 1 beats rung 2) |
| B4 | Person with no employeeShift rows | Treated as available during **location hours only** — verify no 3am Employee reservation exists for them |
| B5 | Call-off drill | Mark tomorrow's welder absent → stamp appears on affected jobs immediately; ≤ ~1 min later regen moves the work; if a job flips late, its assignee gets exactly ONE newly-late digest naming it |
| B6 | Overtime | Grant +2h to one person → their last window extends; a job that needed exactly that slack pulls back on time |
| B7 | Split day | Person split 4h/4h across two stations → each station accumulates only its budget from them |
| B8 | Qualification expiry | Set a welder's `expiresAt` to yesterday → gated work stops being scheduled on them; if the pool empties, conflict names the ability ("No qualified operator for Welding") |
| B9 | No double-booking | Across the whole horizon, no person has overlapping Employee reservations on different operations |
| B10 | Machine down drill | Dispatch with `takesWorkCenterOffline` + planned end Thu on the busy welder bay → reservations vacate the window, Capacity Available drops for those days; complete the dispatch early → hours return next regen |

**Level-1 pass bar:** people are a real second constraint — and every people-side
edit (absence, overtime, split, qualification, downtime) round-trips through the
reactive loop without anyone touching the schedule directly.

## Scenario C — company partially uses resource planning (L2)

The dangerous level — mixed configuration must degrade *softly*, never silently
change meaning or reopen the 24×7 hole.

| # | Test | Expected |
|---|---|---|
| C1 | Gated op inside the manned window (Mon–Wed) | Staffed-team semantics, same as L1 |
| C2 | The SAME gated op's sibling scheduled Thu–Fri (board unmanned) | Soft fallback to any-qualified relay — still bounded by qualified people's shifts ∩ machine hours; no conflict merely because the board is blank |
| C3 | Ungated op at an unmanned station | Machine-only placement bounded by the machine calendar — the old 24×7 hole must NOT reappear (no overnight/weekend minutes) |
| C4 | One routing crossing gated + ungated ops | Coherent single timeline; each op obeys its own layer's rules; dependencies hold across the boundary |
| C5 | Horizon decay | A job 6 weeks out (far beyond the manned board) schedules under fallback semantics with the SAME machine-hours bound as near-term work — compare its per-day booked hours to a near-term twin: identical ceilings |
| C6 | Gated process with zero qualified employees | Named conflict ("No qualified operator for X") — not a silent 24×7 schedule, not a crash |
| C7 | Partial-to-full upgrade | Man Thu–Fri on the board → regen → those ops flip from relay to team semantics and (with 2 people) compress; nothing else moves (determinism of untouched inputs) |

**Level-2 pass bar:** you can adopt resource planning one station, one process,
one day at a time — each increment tightens only what it touches.

## Cross-cutting drills (run at every level where meaningful)

| # | Drill | Expected |
|---|---|---|
| X1 | **Determinism / nervousness** | Trigger regen twice with zero input changes → every `startDate`/`dueDate`/`projectedCompletionAt`/reservation identical. Also: need-by values (`jobOperation.dueDate`) byte-identical across capacity-only changes — targets move only with due-date/routing/lead-time changes. This is the trust test — run it at all three locations |
| X2 | **ASAP order** | Release the no-due-date ASAP job → it leads the queue (never trails on null due date); displaced jobs' forecasts update in the same regen with "queued behind" attribution |
| X3 | **Due-date drag** | Dates board drag → single event (no double dispatch), stamp → regen → stamp cleared, slack badge updated |
| X4 | **Remaining work** | Record 75% quantity on an In-Progress op → its reservation shrinks to ~25% of standard from now; successor ops and `projectedCompletionAt` pull in |
| X5 | **Newly-late exactness** | Force one job late via downtime → exactly one digest to its assignee; repeat the same regen → zero additional notifications; unassigned late job → badge/flag only, no notification |
| X6 | **WC deactivation** | Deactivate a work center with queued ops → next regen re-selects its ops onto sibling WCs (event fires from the deactivate route) |
| X7 | **Capacity view coherence** | Per level: L0 Available = calendar hours (banner); L1 staffed cells show people-hours annotation without replacing calendar Available; Load = Scheduled vs Available on the same calendar days; "Due" tab still shows due-date demand separately |
| X8 | **Perf sanity** | Seeded volume regen completes well inside the 10s envelope (watch the edge-function logs for one wave) |
| X9 | **Dual dates** | Pin an op's due date (`OperationDueDatePicker`) → the pin survives regen and UPSTREAM ops' need-bys re-derive from it; add downtime on its work center → `projectedCompletionAt` values move while every `dueDate` target holds byte-identical; the projected-past-need-by op shows the amber behind-target state (BOP / ops board / MES detail) with `hasConflict` still false |

## Instruments

- **UI:** dates-board slack badges + outdated/conflict triangles; job header badges + "Best case" modal; People → Capacity (Load, banner, Due tab); resource timeline (Gantt) bars; notification bell.
- **DB (psql):** `capacityReservation` (kinds, overlaps, weekend minutes — `EXTRACT(dow FROM "startAt")`), `job.projectedCompletionAt`, `jobOperation.hasConflict/conflictReason/priority`, `scheduleOutdatedReason` lifecycle.
- **Logs:** `schedule` edge-function invocations per wave (one per location), elapsed ms.
- **Automated backstop:** `deno test --no-check lib/scheduling/` (130 tests) before and after any fixture-driven code fix.

## Suggested execution order

1. Build the three-location fixture (UI or tiered seed, ~1–2h).
2. Scenario A end-to-end (fastest, proves the zero-config story).
3. Scenario B, then the B5/B10 disruption drills while its data is warm.
4. Scenario C, ending with C7 (upgrade) — proves the adoption ramp.
5. Cross-cutting X1–X8, with X1 first at each location.
6. File defects against the spec's acceptance-criteria numbering; anything that
   violates a tenet (silent 24×7, nervous dates, duplicate notifications) is a
   ship-blocker; cosmetic capacity-view issues are fast-follows.
