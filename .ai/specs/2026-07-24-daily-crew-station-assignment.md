# Daily Crew / Station Assignment (Crew Board)

> Status: implemented (pending browser verification + translations)
> Author: Claude + Naveen
> Date: 2026-07-24
> Research: `.ai/research/daily-crew-station-assignment.md`

## TLDR

A **Crew board** in the Schedule area where a manager assigns each worker to a
work center for a date (optionally per shift) before the day starts — the
digital manning board. Assignments are consumed three ways: (1) the board
itself replaces the whiteboard/huddle artifact, (2) MES opens each operator's
screen on their assigned station (default, not a lock), and (3) the
**scheduling engine consumes assignments in v1**: crew members are *preferred*
labor at their station (soft semantics), and a crewed station becomes
**manned** — its operations consume the assigned person's hours via the
existing attended-window mechanics, even for ability-ungated processes. A
one-click **absent today** flag removes a person from the day's labor supply
and triggers the existing reactive replan. Research found this closes a loop
no surveyed competitor closes (manning board → finite scheduler).

## Problem Statement

Real shops start the day with a supervisor assigning every worker to a
station (physical magnetic manning boards + skills matrix + huddle — see
research). Carbon has no representation of this:

- Operators self-select their work-center filter in MES; the manager's
  decision lives on a whiteboard or in their head.
- The scheduler books people only at ability-gated stations; everywhere else
  it reserves machines and treats people as unlimited air. In a typical job
  today, every reservation is a machine reservation and none is a person —
  a station with 12h of hands-on work and one real operator schedules as
  "done by 5 PM".
- A call-out (absence) has no system representation; the scheduler keeps
  counting the absent person as available.

## Proposed Solution

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Granularity | `date` + optional `shiftId` (null = whole day) | User Q1→C. Single-shift shops never see shift UI; multi-shift shops get per-shift boards. Matches SAP DM shift plan + physical 3-shift boards. |
| One station per person | Unique per (employee, date, shift); drag = move | User Q2→A. "One magnet per person" — board always answers "where is everyone". Keeps engine semantics unambiguous. |
| Scheduler consumption | **In v1** | User Q3. A board the scheduler ignores "doesn't make sense". |
| Consumption semantics | **Soft ("prefer")**: crew booked first, any-qualified fallback; hard-obey is a future per-company setting | User Q3a. Half-filled boards degrade gracefully instead of flooding the schedule with phantom "no operator" conflicts. |
| Crewed station is manned | **Yes** (Q3b→B): ops at a crewed WC consume assigned people's hours via attended-window allocation, gated or not; blank stations behave exactly as today | The manager's act means "this station runs on this person's hours". Fixes the observed unheld-operator gap using the existing attended allocator. |
| MES behavior | Default station filter + visible chip; override = one tap; no lock | User Q4→A. Research consensus: assignment is a default, not a cage; hard locks exist only for qualification (already enforced at Start). "Lock to station" can become a setting later. |
| Absence | **v1 includes "absent today" flag** (person × date, no T&A module) | User Q5→B. The call-out is the board's highest-value moment; flag excludes the person from the day's labor supply + fires replan. |
| Qualification at assignment | Advisory (amber badge when the person lacks a station's gated abilities); hard gate stays at MES start | Research consensus (two-layer enforcement: filter/warn at planning, enforce at execution). Stations host multiple processes, so assignment-time hard blocks would over-block. |
| Plan vs actuals | `crewAssignment` is the plan; `productionEvent` remains the actual; no merge | Universal competitor pattern (SAP shift plan vs Labor On/Off; Epicor schedule vs labor detail). |
| Module / permissions | `production` module; board requires `production_update` to edit, employee-role read | Board lives beside the other Schedule views which use production scoping. |
| Multi-tenancy / table shape | `companyId`, composite PK, `id('crew')`, audit columns, indexed FKs, 4 standard RLS policies | Heuristics 1–3 / `conventions-database.md`. |
| Service shape | Functions in `production.service.ts`, client-first, `{data,error}`; validators in `production.models.ts`; barrel export | Heuristics 2, 6. |
| Replan wiring | Crew/absence changes fire `carbon/schedule.inputs.changed` with new `kind: "crew"` (entityId = workCenterId); existing mark→wave pipeline absorbs them | Reuses shipped reactive-replan infra; consistent with `work-center` kind scoping. |
| Backward compatibility | New tables + additive engine inputs only; no frozen surface touched | Heuristic 7. Blank board ⇒ byte-identical scheduling behavior. |
| Terminology | "Crew" (view), "crew assignment" (row), "Absent" (flag) | Industry speech ("crew deployment", "manning board") without inventing vocabulary. |

## Data Model Changes

Two new tables. Migration via `pnpm db:migrate:new crew-assignments`.

```sql
-- Planned person→station per date (the manning board row)
CREATE TABLE "crewAssignment" (
    "id" TEXT NOT NULL DEFAULT id('crew'),
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL REFERENCES "location"("id") ON DELETE CASCADE,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    -- null = whole day (single-shift shops never set it)
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
-- One magnet per person per day/shift (Q2→A)
CREATE UNIQUE INDEX "crewAssignment_person_day_key"
    ON "crewAssignment" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX "crewAssignment_board_idx"
    ON "crewAssignment" ("companyId", "locationId", "date");
CREATE INDEX "crewAssignment_workCenter_idx"
    ON "crewAssignment" ("workCenterId", "date");
CREATE INDEX "crewAssignment_createdBy_idx" ON "crewAssignment" ("createdBy");

-- Person is out for the date (person-level, not station-bound)
CREATE TABLE "crewAbsence" (
    "id" TEXT NOT NULL DEFAULT id('crab'),
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL REFERENCES "user"("id"),
    "date" DATE NOT NULL,
    "shiftId" TEXT REFERENCES "shift"("id") ON DELETE SET NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "crewAbsence_person_day_key"
    ON "crewAbsence" ("companyId", "employeeId", "date", COALESCE("shiftId", ''));
CREATE INDEX "crewAbsence_companyId_date_idx" ON "crewAbsence" ("companyId", "date");
CREATE INDEX "crewAbsence_createdBy_idx" ON "crewAbsence" ("createdBy");
```

RLS: standard four policies on both tables — SELECT via
`get_companies_with_employee_role()` (operators must read their assignment),
INSERT/UPDATE/DELETE via
`get_companies_with_employee_permission('production_{create|update|delete}')`.

No changes to existing tables. `capacityReservation` already supports
`resourceKind = 'Employee'` — crewed-station bookings reuse it unchanged.

## API / Service Changes

`apps/erp/app/modules/production/production.service.ts` (+ models + barrel):

- `getCrewBoard(client, companyId, locationId, date, shiftId?)` — assignments
  + absences for the day, joined with employee names; plus the assignable
  people list (employees at the location via `employeeJob.locationId`) and
  each person's ability set (for the advisory badge).
- `upsertCrewAssignment(client, {...})` — move-semantics: replaces the
  person's existing row for that date/shift (Q2→A).
- `deleteCrewAssignment(client, id)`.
- `setCrewAbsence(client, {...})` / `clearCrewAbsence(client, id)`.
- `copyCrewBoard(client, {fromDate, toDate, locationId, shiftId?})` — Kysely
  transaction (multi-row write; skips people absent on target date or already
  assigned).
- `getMyCrewAssignment(client, {employeeId, companyId, date})` — MES loader
  helper (also exposed in `apps/mes/app/services/operations.service.ts`
  following MES service conventions).
- All mutations call `notifyScheduleInputsChanged(companyId, "crew", reason,
  workCenterId)`; absence mutations notify once per station the person was
  crewed at that date (fallback: ability-style scoping when uncrewed).

`packages/lib/src/events.ts`: extend `kind` union with `"crew"`.
`packages/jobs` mark function: `"crew"` scopes affected jobs like
`"work-center"` (jobs with unfinished ops at that WC).

### Scheduling engine changes (`functions/lib/scheduling/`)

- `MasterDataProvider` gains `getCrewAssignments(dateRange)` and
  `getCrewAbsences(dateRange)` (company-scoped; not cached across batch —
  they're date-sensitive but static within a run, so cacheable per run).
- `buildFiniteContext`:
  - Build `crewByWorkCenterDate: Map<wcId, Map<date, employeeId[]>>` and
    `absentByDate: Map<date, Set<employeeId>>` over the scheduling horizon.
  - **Absences** (Q5→B): subtract the absent person's availability windows on
    that date everywhere (both crew-preferred and qualified-fallback paths).
- Selector/allocator (soft prefer + manned stations, Q3a/Q3b):
  - **Gated ops:** eligible members at a WC on a date = crew∩qualified when
    the WC has crew that date (pass 1); if no feasible slot from crew alone,
    fall back to the full qualified-on-shift set (pass 2, today's behavior).
  - **Ungated ops at a crewed WC:** treated as attended — members = that
    day's crew at the WC, attended hours = setup + labor
    (`calculateAttendedHours`), machine holds the full span; relay/handoff
    mechanics unchanged. If the crew can't cover it, fall back to
    machine-only placement (soft), keeping the schedule complete.
  - **Ungated ops at an uncrewed WC:** byte-identical to today (machine
    only). A blank board changes nothing.
  - Crew-sourced bookings persist as ordinary `Employee` reservations
    (wait attribution and conflict messages work unchanged; add a
    placement-note variant "Waited …for the assigned crew").
- Horizon semantics: crew only exists for dates managers filled in; beyond
  the last crewed date every station reverts to default behavior. No new
  conflicts can originate from an empty board.

## UI Changes

### ERP — Crew board (new Schedule view)

Route `apps/erp/app/routes/x+/schedule+/crew.tsx`; added to
`ScheduleNavigation` ("Crew", `LuUsers`); breadcrumb `Production › Crew`.

- Header: date picker (default today) with prev/next-day arrows; shift tabs
  only when the location has >1 active shift (Q1→C); location from the
  standard location context; headcount per column; **Copy previous day**
  button.
- Board: Kanban-style grid reusing the schedule boards' drag-and-drop —
  first column **Unassigned** (all employees at the location not yet placed,
  absent people grayed at the bottom), then one column per active work
  center. Cards = people (avatar + name), with:
  - amber qualification badge when the station has gated processes the
    person lacks (advisory only — tooltip lists the missing ability);
  - card menu: *Mark absent today* / *Clear absence*, *Remove from station*,
    *Note*.
- Drag person → station = move (their previous station empties, Q2→A).
- All strings via Lingui (`useLingui`/`<Trans>`); board data via loader,
  mutations via fetcher actions per forms conventions.

### MES — assigned station default

- `operations.tsx` loader: resolve today's assignment for the operator;
  when present and the user has no explicit filter override this session,
  default the work-center filter to their station and render a chip
  ("Your station: Drill Press") with a one-tap clear (Q4→A).
- No change to the Start gate — qualification enforcement is untouched.

## Acceptance Criteria

- [ ] Manager with `production_update` opens Schedule › Crew, drags employee
      A onto Work Center X for today; a `crewAssignment` row exists; dragging
      A onto Y removes them from X (single row per person/day).
- [ ] At a single-shift location no shift UI is shown; at a location with two
      active shifts, shift tabs appear and assignments are per-shift.
- [ ] Assigning a person to a station whose gated process they lack shows the
      amber badge + tooltip but succeeds; MES Start for that gated op still
      blocks them.
- [ ] Copy previous day reproduces yesterday's board for today, skipping
      people marked absent today.
- [ ] Operator assigned to X logs into MES: operations view opens filtered to
      X with the station chip; tapping the chip clears the filter; an
      unassigned operator sees today's default behavior.
- [ ] Scheduling a job whose ungated op runs at crewed station X books
      `Employee` reservations for the assigned person covering setup+labor,
      machine reservation covering the full span; the same op at an uncrewed
      station books machine-only (unchanged vs pre-feature run).
- [ ] With 12h of hands-on work at a station crewed by one 8h-shift person,
      the schedule spills work past their shift (visible in the Timeline)
      instead of compressing into the day.
- [ ] Gated op at a crewed station books the crew member when feasible; when
      the crew member's day is full, it falls back to another qualified
      on-shift person (soft), not a conflict.
- [ ] Marking a person absent fires `schedule.inputs.changed` (`kind:
      "crew"`); affected jobs get the stale badge and the replan wave
      reschedules without the absent person's hours that date.
- [ ] Empty board for a date ⇒ engine output identical to pre-feature
      behavior for that date (regression-tested).
- [ ] All new strings extracted; 12 locales filled via /translate.

## Open Questions

- [x] Granularity: per day or per shift? — **Answer (user):** C — date +
      optional `shiftId` (null = whole day); shift UI only for multi-shift
      locations.
- [x] Can one person hold multiple stations per day/shift? — **Answer
      (user):** A — one station per person, unique-enforced; drag = move.
- [x] Does the scheduler consume assignments in v1? — **Answer (user):**
      Yes — "it doesn't make sense if scheduler is not taking this into
      account".
- [x] Prefer (soft) or obey (hard)? — **Answer (user):** Soft prefer;
      hard-obey later as a per-company setting.
- [x] Does crew make ungated stations manned? — **Answer (user):** B — a
      crewed station runs on the assigned person's hours (attended
      mechanics); blank stations unchanged.
- [x] MES: default or lock? — **Answer (user):** A — default with one-tap
      override; qualification gate unchanged.
- [x] Absence in v1? — **Answer (user):** B — "absent today" flag that
      excludes the person from the day's labor supply and triggers replan;
      no time-and-attendance module.

## Out of Scope (v1)

Within-shift rotation segments; overtime equalization / union rules; a real
time-and-attendance module; hard "obey the board" mode (future per-company
setting); locking MES to the assigned station (future setting); kiosk/print
board view (cheap follow-up).

## Implementation Phases

1. **Schema + board + MES default** — migration, services, Crew view,
   MES chip. Ships standalone value (digital whiteboard).
2. **Engine consumption** — provider reads, crew-preferred eligibility,
   manned crewed stations, absence exclusion, `kind: "crew"` replan wiring,
   deno tests for the new allocator paths + empty-board regression test.

Note for phase 2 verification: the local Inngest dev server cannot execute
`debounce` functions (`.ai/lessons.md`) — validate the replan trigger by
watching the mark function + DB stamps, not the wave, locally.

## Changelog

- 2026-07-24 — Spec created after research
  (`.ai/research/daily-crew-station-assignment.md`) and a 7-question design
  interview with Naveen; all questions resolved before writing (see Open
  Questions).
- 2026-07-24 — Implemented per `.ai/plans/2026-07-24-daily-crew-station-assignment.md`
  (both phases in one pass): migration `20260723212028_crew-assignments.sql`,
  crew services + Crew board (`x+/schedule+/crew.tsx` + `crew.update.tsx`),
  MES station default + dismissible chip (session cookie
  `mes-crew-override`), engine consumption (provider reads, pure
  `crew-utils.ts` with 9 deno tests, two-pass gated eligibility, manned
  ungated crewed stations, absence subtraction, `crew-wait` placement note),
  `kind: "crew"` replan wiring. Divergences:
  **Crew semantics revised after review with Naveen (team mode):** a crewed
  station works ONE op at a time and its whole present crew works that op
  TOGETHER — labor is parallelized across the present crew (n× wall-clock),
  setup and machine time are never compressed
  (`simulateAttendedTeam`, `allocateAttendedOperation`'s `team` option).
  Gated ops team-book crew∩qualified on their crewed dates; the soft
  fallback to the classic any-qualified single-person relay remains
  (unqualified crew never speed up gated work). This supersedes the spec's
  original "crew booked first via single-person attended allocation"
  wording. Other divergences: `getCrewBoard` was split into
  small read functions (`getCrewAssignments`/`getCrewAbsences`/
  `getCrewEmployees`/`getWorkCenterRequiredAbilities`/
  `getActiveEmployeeAbilities`) per services conventions;
  `getMyCrewAssignment` lives in MES `operations.service.ts` only (no ERP
  duplicate needed). Non-English translations NOT yet filled — `pnpm run
  translate` failed on the local LLM endpoint; en catalogs extracted.
  Browser verification pending.
- 2026-07-29 — Crew page extended with a segmented view switcher (`?view=`):
  **Board** (original day kanban), **Matrix** (employee×day week grid with
  department/shift filters and an assigned-vs-needed coverage block), and
  **Capacity** (work-center week grid: Demand from open `jobOperation` hours
  bucketed by due date incl. a Past-due column, Scheduled from
  `capacityReservation` overlap, Available from crew×8h with weekday fallback,
  Load% with green ≤100 / amber ≤120 / red >120 bands). Grounded in
  `.ai/research/work-center-capacity-crew-matrix.md` and the Excel prototype
  `.ai/research/crew-capacity-prototype.xlsx`.
- 2026-07-30 — Iteration round with Naveen on live data:
  - Real shift hours replace all hardcoded 8s: hour ladder = assignment
    `shiftId` → person's `employeeShift` → most-common shift duration at the
    location → 8h; uncrewed Available = the location's per-weekday shift
    calendar (`getShiftsWithTimes` + `getEmployeeShifts`).
  - Capacity view: Scheduled distributes `capacityReservation.workHours`
    across the reservation span (no more 24h/day from spanning bookings);
    Load renders hours over/free (+Xh red / Xh free green, % in tooltip);
    per-work-center `<tbody>` groups with series dividers; row-scoped hover
    with the name cell static (base Td ships `group-hover:bg-muted` — see
    lessons); Demand excludes Draft/Planned jobs (released load only).
  - Matrix: one table at a time (Assignments | Coverage sub-tabs), sticky
    header + first column, department filter.
  - Board: sticky Unassigned column (scroll-conditional shadow,
    `MeasuringStrategy.Always`, `min-w-max` on the shared BoardContainer row).
  - Header: shift filter is a dedicated clock-icon popover ("All shifts"
    replaces "All day"; active-filter dot); location stays in ⚙; controls wrap
    on small screens.
