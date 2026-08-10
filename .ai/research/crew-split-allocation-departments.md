# Split Allocation, Overtime & Department-Scoped Crew Scheduling: Best Practices Survey

> Follow-up to `.ai/research/daily-crew-station-assignment.md` and
> `.ai/research/work-center-capacity-crew-matrix.md`. Questions from Naveen:
> (1) can part of a person go to one work center and part to another; (2) can we
> schedule overtime; (3) department should be a first-class top-level filter
> (like location), persisted, because in real life one supervisor schedules his
> own department.

## Summary

Surveyed SAP, PlanetTogether, UKG/Kronos, Deputy, Epicor, APS/OR literature, and
practitioner forums. Three split-allocation models exist in the wild: percent-of-
person (PlanetTogether Attention %), time segments (UKG shift segments, Deputy
sub-shifts, SAP splits), and whole-shift-plus-ad-hoc-moves (what real shops
actually do). Overtime is universally **planner-authorized extra capacity that
the scheduler then consumes automatically** — typed capacity intervals (PT),
alternate capacity versions (SAP), calendar-day exceptions (Epicor), added
shifts (UKG). Department as the planning scope is standard (UKG business
structure jobs, the user's own TV board is department-cells).

## Q1 — Fractional / split allocation

- **SAP PP splits** (CM25/CM21): an operation's capacity requirement is divided
  into splits by quantity, work, or duration; each split has its own start and
  is dispatched to a person or individual capacity. Partial-day per-person
  splits structurally possible, not explicitly demonstrated (flag).
- **PlanetTogether Attention Percent**: multi-tasking resources; each operation
  declares a % of the operator's attention; scheduler enforces Σ ≤ 100% of
  concurrent ops. Fractional crew (0.5 person) unverified (docs gated).
- **UKG shift segments**: a shift = segments, each with its own time bounds +
  job/location/cost center; a mid-shift Line 1 → Line 2 move is a *partial
  transfer* that splits the shift into segments. Deputy: split shifts /
  micro-scheduled sub-shifts, each segment with its own area.
- **Practitioner reality** (Practical Machinist): shops think in operator-to-
  machine ratios and whole-shift assignments plus ad-hoc supervisor moves; no
  evidence of formal mid-shift fractional entries in shop schedulers
  (absence-of-evidence, flagged). Formal FTE fractions live in office/project
  tools, not shop floors.
- **OR literature**: flexible resource profiles / energy-constrained scheduling
  formalize "partial attention makes the job take longer" — active research,
  not shipped practice.

## Q2 — Overtime

- **PlanetTogether**: typed capacity intervals — Offline / Cleanout /
  **Overtime** (committed extra hours) / **Potential Overtime** (pre-approved,
  used "if needed"); overlapping intervals add their Nbr of People. The only
  system-may-use-if-needed construct found (detail gated/flagged).
- **SAP**: versions of available capacity ("version 2 = with overtime") and
  intervals of available capacity replacing the standard for a date range;
  planner activates, CM01/CM25 consume automatically.
- **Epicor**: calendar-day exceptions (make Saturday a working day); forum pain
  point: no easy way to add a few hours to ONE day — planners fall back to
  whole-day exceptions or availability percentages.
- **UKG**: overtime is a pay-rule *consequence* (thresholds), scheduled OT is
  just added shifts/segments; scheduling flags OT risk.
- **Universal pattern**: a human authorizes the extra capacity; the scheduler
  never invents overtime on its own.

## Q3 — Department as the scheduling scope

- Prior research (work-center-capacity file): department is the common planning
  level (UKG business structure = location × job; Shiftboard pools by
  role/line/department; the user's TV board's rows ARE department cells;
  supervisors-per-department is the practitioner norm).
- Carbon facts (verified in code): `workCenter.departmentId` +
  `workCenters.departmentName` exist; `employeeJob.departmentId` links people
  to departments; a `Department` form selector already exists; the location
  default persists via the `userDefault` table (`userId`, `companyId`,
  `locationId` — no `departmentId` column today); MES persists UI prefs in
  cookies; ERP has localStorage precedent in hooks (`useHubDismissed`).

## Recommended Approach for Carbon

1. **Department as a top-level, persisted filter (build first — no schema
   change).** `?department=` URL param on the crew page applied to ALL views
   (board columns, matrix rows/coverage, capacity rows), defaulting to All
   Departments; a department picker in the header (popover, like location);
   selection ALSO written to a cookie so the loader can apply it without a URL
   param (SSR-correct, no flicker — cookie over localStorage). URL wins over
   cookie when present (shareable links). Optionally later: `userDefault.departmentId`
   column for cross-device persistence, mirroring location (needs migration).
   Employee rows: filter by `employeeJob.departmentId` OR having an assignment
   in the department (so free people in the department stay visible — fixes a
   known matrix-filter gap).
2. **One `hours` column on `crewAssignment` covers BOTH split allocation and
   overtime.** Nullable numeric; null = full shift (today's behavior).
   `hours < shift` = partial day at that station; two rows summing the day =
   a split (requires relaxing the unique index to include `workCenterId`, with
   drag staying move-by-default and an explicit "Split day…" action adding a
   second row); `hours > shift` = overtime at that station (the Epicor
   pain-point solved: extra hours on ONE day for ONE person). Available on the
   capacity view = Σ hours (defaulted from the shift ladder). This mirrors the
   industry consensus (hours/segments over percentages) and the
   planner-authorizes rule.
3. **Saturday crew already works** — assigning people on a weekend replaces the
   0-hour calendar fallback with crew hours; document it as the "add a Saturday
   shift" move rather than building anything.
4. **Engine consumption of `hours` is a separate later phase** (clip/extend the
   member's attended window for that date); display-level math ships first.
5. **Do NOT build percent-of-person / attention splitting** — no practitioner
   demand on shop floors, high engine complexity; revisit only if a customer
   asks for machine-tending ratios.

## Sources

SAP: help.sap.com splits (7608b753…), distribution keys, capacity versions
(7073b653…), community CM25 split/allocate threads · PlanetTogether KB
(multi-tasking-resources, resource-options, capacity intervals — gated,
snippet-derived) · UKG: ShiftTransfer.htm, Transfer_Employee_Time_Timecard,
partner blogs (flagged) · Deputy help (split/micro-scheduled shifts, 403 —
snippets) · Epicor: epiusers.help 97038, 45464, 121239 · Practical Machinist
393367, 386668, 237304 · OR: sciencedirect S0305054817300588, arxiv 2311.16177 ·
Vendor marketing flagged: User Solutions, MachineMetrics.

## Implementation design: within-shift split (added 2026-07-31, on request)

Industry basis (from Q1 above): the two shipped models are UKG/Deputy **time
segments** (each with start/end + station) and SAP **splits** (hours/work per
split, own start). Percent-of-person (PT Attention %) has no shop-floor
practitioner demand. Chosen model for Carbon: **hours-based splits** — the
supervisor thinks "4 hours here, 4 there," not in clock times; time segments
can be derived when needed.

1. **Schema** (one migration): add `hours NUMERIC(5,2) NULL` to
   `crewAssignment` (null = the whole shift — today's behavior, so existing
   rows are untouched); replace the unique index
   `(companyId, employeeId, date, COALESCE(shiftId,''))` with
   `(companyId, employeeId, date, COALESCE(shiftId,''), workCenterId)` —
   several stations per shift become legal, duplicate same-station rows stay
   illegal.
2. **Split UX**: drag keeps meaning MOVE (moves that assignment row). Splitting
   is explicit: card menu → "Split day…" → dialog shows the person's shift
   hours, lets the supervisor set hours for the current station and pick a
   second station + hours (prefilled with the remainder; validation
   Σ hours ≤ shift + overtime). Cards on the board must switch identity from
   employee-keyed to ASSIGNMENT-keyed (one person can appear in two columns) —
   this is the largest code change (CrewBoard drag ids, optimistic moves,
   Unassigned = people with zero rows). Split cards show an hours chip ("4h").
3. **Math**: a row with `hours` contributes exactly that; a null-hours row
   contributes the shift-ladder value only when it is the person's sole row
   for that shift. Matrix chips gain the hours suffix; Capacity's Available
   sums row hours; Coverage switches from headcount to hours (a half-person
   headcount is meaningless).
4. **Engine**: convert hours-splits into synthetic time segments server-side —
   slice the person's shift window sequentially in row order (first row gets
   the first N hours of the window, next row the remainder). The engine
   already knows how to consume per-station windows (clipWindowsToDates
   machinery), so budgeted-hours becomes plain window clipping with zero
   allocator changes. Sequencing within the shift is an approximation the
   supervisor implicitly accepts (same as SAP splits with default starts).
5. **Phasing**: (a) migration + board card-identity refactor + split dialog +
   display math; (b) engine synthetic segments. Estimated at roughly the size
   of the overtime feature plus the board refactor.

Open decisions for Naveen before building: hours vs explicit time-blocks
(recommended: hours); what coverage shows for splits (recommended: hours, not
headcount); whether a split survives "copy previous day" (recommended: yes,
copied as-is).

## Drag-UX research for splitting (added 2026-07-31)

Findings (full sources in agent run): NO mainstream rostering tool has a
plain-drag → "move or copy?" dialog; the industry uses modifier-key copy
(Outlook classic Ctrl-drag, Teamup, WhenToWork Ctrl=clone — power-user hostile,
touch-hostile), live pre-drop conflict icons (When I Work green-check/concern),
or block-with-reason (Deputy copy checks). The ONE drop-time dialog precedent:
WhenToWork confirms when a shift is dropped ONTO an occupied shift (swap
confirm) — i.e. dialogs are reserved for semantic forks, which a second-station
drop is. Splitting itself is universally a MODAL with slider + numeric fallback
+ explicit confirm (Deputy split indicator, When I Work "drag the slider…"),
never a free gesture on the board. NN/g + enterprise guidance: build the
explicit-button path first, drag as accelerator; pre-drop feedback over
post-drop errors; Gmail mobile replaced drag with a "Move to" button. Physical
analogue for one-person-two-places: fire-service accountability boards issue
MULTIPLE TAGS per person (no half-magnet guidance exists).

### Chosen interaction design (Naveen's drag-again idea, refined — v1, superseded below)

1. First drag from Unassigned → station: full-shift assignment, person leaves
   Unassigned (unchanged 98% case).
2. Dragging an ASSIGNED card onto a second station → drop-time dialog (the
   WhenToWork-style semantic fork): "[Move to X] [Split evenly] [Custom
   hours…]" — Split evenly = Naveen's "automatic"; Custom opens the standard
   split modal (two number fields summing to shift+OT, confirm button).
3. Unassigned redefined as the FREE-HOURS pool: fully-allocated people leave;
   partially-allocated people reappear with an "Xh free" chip (fire-board
   multiple-tags analogue). Dragging the remainder card assigns the remaining
   hours — delivering the "stays in Unassigned, drag again" flow exactly where
   it makes sense.
4. Explicit "Split day…" stays in the card's visible action row
   (button-first guidance; drag is the accelerator).
5. Post-drop toast confirms the outcome ("Bob: 4h Weld 1 + 4h Deburr").

## Move/split UX rework research (added 2026-08-01, after "modal feels overwhelming" feedback)

Two parallel surveys: (a) how resource/workforce/dispatch tools allocate one
person across multiple stations; (b) lighter-than-modal drop interactions.

### Key findings

- **The modal is the anti-pattern.** NN/g: confirmation dialogs are for
  irreversible actions only; routine reversible drops should act immediately
  with undo (Gmail/Todoist snackbar model). Material: >1 action in a toast =
  dialog territory, but a choice that doesn't merit blocking the screen
  shouldn't be a dialog either.
- **N-way splits are never a "split" operation in shipped products.** Float,
  Runn, Hub Planner, Forecast, Teamwork, and every field-service dispatch
  board (Salesforce FS, ServiceTitan, Skedulo) model allocations as
  INDEPENDENT stacked hour-blocks per person: a 3-way split is just three
  drops with default hours, adjusted afterwards (Float: vertical resize of the
  tile = hours/day; Runn: anchored quick-editor popover with linked
  effort/days/total fields). Remaining capacity is shown ambiently (red cell /
  capacity bar / "Xh free" readout), not inside a dialog.
- **Pairwise-only split UIs exist and are the weak precedent**: When I Work's
  slider Split Shift produces two shifts and requires re-splitting for 3+.
  UKG's segment-row editor is genuinely N-way in one surface but is the
  heavyweight enterprise form we're trying to avoid. Deputy multi-area shift =
  "+ Add area" rows in one editor (snippet-verified only).
- **If the fork must resolve at drop time**: Jira boards split a hovered
  column into labeled drop sub-zones (decision inside the gesture, no second
  UI) — the touch-safe version of modifier-drag (Resource Guru Shift-drag =
  copy; When I Work Ctrl-drag = copy; Figma Alt-drag).
- **Canonical light chooser**: Windows/Outlook right-drag "Move here / Copy
  here" context menu AT the drop point; Google Calendar's recurring-event
  chooser is small + radio-only + conditional (only when the fork exists).
- Popover-over-modal criterion (Apple HIG / hidde.blog): use a popover when
  seeing the underlying context while choosing matters — on the crew board,
  seeing the person's remaining hours IS the context. Click-away must commit
  the default (move), never cancel the drag.

### Chosen direction (v2 — Option A picked by Naveen 2026-08-01, implemented)

**Option A (Float model): drag = move, always; splitting lives on
the card, not in the drop.** Drop an assigned card on another station → moves
instantly + toast. Each assigned card gets a clickable hours chip → tiny
anchored popover with a ± stepper (0.5h steps, prefilled with current hours);
lowering hours releases the remainder to the Unassigned free-hours pool
("Xh free" card), which drags to station 2, 3, … N. Inherently N-way, zero
dialogs, reuses the existing pool mechanic. Undo toast for moves is a
follow-up (needs reverse-move plumbing).

**Option C (minimum change): demote the modal to an anchored popover at the
drop point** — segmented [Move | Split], Move preselected, Enter commits,
click-away commits Move; stepper inputs appear only after choosing Split,
prefilled with the even split. Keeps drop-time choice, cuts it to one binary
decision with zero typing on the happy path.

Option B (Jira-style labeled drop sub-zones per column) noted as the
in-gesture alternative; heavier dnd-kit work, best revisited if A/C misses.
