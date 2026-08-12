# Work-Center Capacity Board + Employee×Day People Matrix: Best Practices Survey

> Companion prototype: `.ai/research/people-capacity-prototype.xlsx` (working Excel model of both views)
> Prior art: `.ai/research/daily-people-station-assignment.md` (the people board v1 research)
> Grounding photo: user's shop TV running a homegrown VB "Capacity Analysis for WELDING" board —
> rows = weld cells (CP-W-01…CP-W-40), 3 sub-rows per cell (WO demand hrs / CP claimable hrs / Avail hrs),
> columns = 12 weekly buckets, colors green ≤100% / white 100–120% / red >120%, utilization factor 1.00,
> "Hours Calc Sequence: Planned → Bid → Historical", "only claimable when released to SF", PTO View tab,
> next-4-weeks traffic-light summary (28 green / 1 white / 9 red).

## Summary

Researched how work-center capacity load boards (planned/demand hours vs available hours) and
person×day manning matrices are done in (a) SAP and Epicor, (b) workforce-management tools
(UKG/Kronos, When I Work, Deputy, Shiftboard, Oracle WFS), and (c) practitioner reality — Practical
Machinist threads, shop-built Excel templates, magnetic manning boards, and the APICS/CPIM RCCP/CRP
literature. Headline: the **load report shape is universal and identical everywhere** (rows = work
centers, columns = weekly buckets, load vs available with color bands) — the user's photo is a
textbook instance. The **person×day matrix is NOT a production-scheduling artifact in any major
ERP** — SAP and Epicor schedule counts, not names; the matrix lives in WFM tools and on physical
manning boards. Carbon's people board occupying both sides (capacity summary + named daily
assignment) fills a real gap the big ERPs delegate to whiteboards.

## Competitors Surveyed

- **SAP S/4HANA / ECC** — the enterprise reference: CM01/CM05 capacity evaluation, CM21/CM25
  leveling, Fiori Manage Work Center Capacity (F3289)
- **Epicor Kinetic** — job-shop ERP benchmark: Shop Load, Overload Informer, resource groups
- **UKG (Kronos) Dimensions / Pro WFM** — plant workforce scheduling: Schedule Planner, Daily
  Coverage, Rotation Schedule Templates
- **When I Work / Deputy / Shiftboard / Humanity / Oracle WFS** — canonical schedule-grid UX
- **Practitioner world** — Practical Machinist threads, User Solutions Excel templates, Magnatag
  manning boards, ILUO skills-matrix literature, APICS/CPIM definitions (RCCP, CRP, dispatch list)

## Key Consensus Patterns

### 1. The universal load-report shape (the photo is the standard)

- **SAP CM01**: per work center per weekly bucket → capacity requirements, available capacity,
  load % (req ÷ avail), remaining available; drill-down to the orders behind the number. CM05
  splits the same by capacity category (machine load vs labor load).
- **Epicor**: Shop Load = remaining estimated hours (EstSetHours + remaining EstProdHours prorated
  by completion) spread into daily buckets vs calendar hours × active resource count; Overload
  Informer lists resource×day rows where load > capacity.
- **Excel templates / CPIM texts**: rows = work centers, weekly columns, demand vs available,
  utilization %, conditional formatting; identical to the photo.
- **Rationale**: this is APICS CRP rendered as a grid. Everyone converges on it independently.

### 2. Available-hours formula and the utilization derate

- **SAP**: Operating time = (shift end − shift start − breaks) × utilization % ; Available =
  operating time × number of individual capacities (machines or people).
- **APICS**: Rated capacity = available time × utilization × efficiency. Utilization = hours
  worked ÷ hours available; efficiency = standard hours earned ÷ hours worked. **Demonstrated
  capacity** = historical average of actual output — the literature's fallback when standards lie.
- **Practitioner templates**: derate gross hours by **75–85%**; the photo's shop runs
  "Utilization Factor 1.00" (configurable).
- **Rationale**: nobody trusts raw clock hours; the derate is where breaks, indirect time, and
  optimism go to die.

### 3. Demand-hours fallback ladder (Planned → Bid → Historical)

- The photo's "Hours Calc Sequence: Planned Hours / Bid Hours / Historical Hours" is real practice
  but **no tool or practitioner names it formally** — it's implicit. Small shops actually run it
  backwards (quote first, actuals feed the next quote, routings last or never); PM threads show
  shops correcting quoted hours by measured bias ("consistently under by 30% → up quotes 30%")
  and burden factors (40 actual / 30 billed = 1.33×).
- APICS's demonstrated capacity is the same idea applied to the capacity side.
- **Rationale**: routings are incomplete in every real shop; a ladder with provenance (which rung
  produced this number) beats a blank cell.

### 4. Released vs unreleased load

- **SAP**: capacity requirements exist for created AND released orders in the evaluation view, but
  the availability *check* counts only dispatched/firm load by default.
- **Photo**: "only claimable when released to SF" — demand is claimable capacity only once
  released to the shop floor.
- **Rationale**: planners need to see total incoming load, but promised capacity should only be
  consumed by firm work. Split the demand number (or shade it) by released state.

### 5. The person×day matrix is a WFM artifact, not an ERP-scheduler artifact

- **SAP**: schedules capacity *counts*; person-level assignment only via capacity-requirement
  splits in CM21/CM25 or the PS Workforce Planning app (CMP2/CMP3) — used in project/maintenance
  contexts, not high-volume discrete. Daily rostering/PTO is HR shift planning, not PP.
- **Epicor**: no person×day surface at all. People size multiplies costed labor hours only;
  named people appear only at MES clock-in.
- **APICS**: the closest formal artifact is the **dispatch list** (work-center-oriented, order
  priority sequence, refreshed each shift); person-level assignment is explicitly left to the
  supervisor.
- **Rationale**: this is the gap Carbon's people board fills — most shops bridge it with whiteboards.

### 6. Two matrix orientations, each answering a different question

- **Employee rows × day columns** (When I Work "User View", Deputy "Week by Team Member",
  Shiftboard week-by-staff): carries the *people* facts inline — PTO, availability, hour caps
  ("32/40 hrs"), and an **Open Shifts pseudo-row** at top for unassigned coverage.
- **Station/position rows** (When I Work Position View, UKG Rotation Templates — up to 250
  position rows, cells = shifts, unfilled rows become open shifts at publish; Magnatag manning
  boards — stations as rows, name magnets placed on them): carries the *coverage* facts — who's
  on each station, unfilled slots highlighted, headcount per slot.
- Physical-board practice: manning boards are station-rows; the Excel tradition flips to
  machine-columns × day-rows with color-coded operator cells (Practical Machinist).
- **Rationale**: tools that matter keep BOTH and let you toggle (When I Work binds a hotkey).

### 7. Coverage strip: scheduled vs required, in the same screen as the grid

- **UKG Daily Coverage**: per cell "scheduled / planned" headcount pair, background color for
  under/over/equal, intervals configurable (shift/4h/1h); required heads come from a separately
  maintained Workload/Staffing Plan.
- **Oracle WFS 24B**: per-job summary row inside the grid (required vs scheduled hours per day)
  plus a variance drawer; red for over- AND under-staffed; toggle variance by hours or by workers.
- **Deputy stats panel**: docked strip under the grid — required vs scheduled counts, hours, wage
  cost vs budget.
- **Rationale**: assignment without a demand baseline is data entry, not planning. The pairing of
  grid + variance strip is the published UX consensus.

### 8. Filters, copy-forward, and qualifications

- Standard filter set: **position/role, location, department/team, shift** (+ per-person tags).
- Copy-forward always **revalidates per employee** on paste (Deputy drops shifts where the person
  is on leave, unavailable, double-booked, or out of location). Durable rotating patterns/templates
  (UKG: 1 day–160 week rotations, assignable to people or position rows) coexist with ad-hoc copy.
- Qualifications gate the **candidate picker first** (UKG shows "only employees who can work this
  job"), then warn; hard-block is a configurable strictness. The lean-plant version is the **ILUO
  skills matrix** (rows = operators, columns = station operations, I/L/U/O proficiency): consulted
  at the shift-start huddle to know feasible rotations; a station with one qualified operator is
  flagged as fragility.

### 9. Absence/PTO handling

- Physical world: separate attendance/vacation boards beside the manning board; in-grid for WFM
  tools (time off renders inline in the employee's row; suppressed in position view).
- Capacity side: absences are a **subtraction from available hours** (SAP models them as intervals
  of available capacity with reduced headcount; templates bury them in the utilization factor).
- The photo's tool has a dedicated "PTO View" tab.

### 10. Staleness is the killer, not structure

- Every practitioner source: the board/sheet dies when updating it costs more than it returns —
  roughly past 10–15 machines or ~40–50 concurrent jobs ("it only works if you update it daily";
  "whiteboard with magnets… everyone can see it and it doesn't crash").
- **Rationale**: the decisive advantage of doing this inside Carbon is that demand, scheduled, and
  available hours are *computed from live data* (job operations, capacity reservations, shift
  calendars, people assignments) — only the assignment layer is manual.

## Answers to Research Questions

1. **Buckets & thresholds** — weekly buckets for the planning board (SAP default, photo, all
   templates), daily for execution-horizon views; color bands configurable with 100% = overload as
   the fixed semantic (SAP Fiori: green ≤~80, yellow to 100, red >100; the photo's shop: green
   ≤100, white 100–120, red >120 — i.e. they tolerate 20% overload before alarming).
2. **Fallback ladder** — real but unnamed in the wild (photo names it explicitly; PM threads do it
   through the quoting feedback loop; APICS calls the capacity-side analog demonstrated capacity).
3. **Which hour pairs** — the triple demand (load) / available / load% is the standard; "scheduled"
   as a *third* series distinct from demand appears only in finite-scheduling tools (Epicor
   scheduled load; Carbon's capacityReservation is exactly this). Showing demand vs scheduled vs
   available together is richer than any single surveyed tool.
4. **Matrix orientation** — both, toggleable; employee-rows for people facts (PTO, hour caps),
   station-rows for coverage (open slots, headcount). Physical boards are station-rows.
5. **Release gating** — total load visible, but firm/released load distinguished from planned
   (SAP availability check; photo's "claimable when released").
6. **Skills × daily people** — ILUO matrix consulted at the huddle; in software, qualification
   filters the picker and warns on violation (Carbon's people board amber-warning already matches).

## Recommended Approach for Carbon (people page)

1. **Add a "Capacity" view to the Schedule area** (sibling of People/Kanban/Timeline): rows = work
   centers grouped by department, columns = days with a week rollup (and a weeks mode for the
   12-week horizon like the photo), three lines per cell or three sub-rows per work center —
   **Demand** (remaining jobOperation setup+labor+machine hours whose op falls due in the bucket),
   **Scheduled** (capacityReservation hours placed in the bucket — Carbon's finite engine gives us
   the series SAP/Epicor can't show without APS), **Available** (people headcount × shift hours for
   assigned dates; work-center calendar hours otherwise; minus absences). Load% = Scheduled/Available
   colored green/amber/red with configurable thresholds (default green ≤100, amber ≤120, red >120
   to match the user's shop's convention).
2. **Make the people page a true matrix** with both orientations: employee-rows × day-columns
   (PTO/absence inline, per-employee assigned-hours count, "Unassigned" pseudo-row per day) and a
   station-rows toggle (coverage counts: assigned vs required headcount per station/day). Filters:
   location, **department** (via workCenter.departmentId), **shift**. This is the UKG/When-I-Work
   consensus layout.
3. **Coverage strip** on the matrix: per work-center/day, assigned headcount vs required (required
   from demand hours ÷ shift hours, or a manually-set min-people per work center) with variance
   colors — the UKG Daily Coverage / Oracle 24B pattern.
4. **Keep copy-forward revalidating** (already skips assigned/absent targets — matches Deputy) and
   later add rotating templates (UKG pattern) rather than more copy variants.
5. **Demand-hours provenance ladder** as a later enhancement: planned (routing) hours first,
   fall back to quoted hours (quote lines) then historical actuals (production events), and show
   which rung produced the number — the photo proves real shops want this spelled out.
6. **Defer**: released-vs-unreleased load split (needs a releasedToFloor notion per job),
   configurable utilization factor per work center.

## Competitor-Specific Details

### SAP
- Capacity categories (machine/labor) per work center, each with own availability; pooled
  capacities shared across work centers; HR mini-master links persons/qualifications to capacities.
- Shift definitions/sequences generate "intervals of available capacity"; vacation periods =
  intervals with reduced individual capacities.
- Leveling = dispatch/deallocate against a planning table (orders pool + work-center rows).

### Epicor
- ResourceGroup → Resources; capabilities (skills) can substitute for a named resource; finite
  flag per resource. Setup load multiplies per scheduling block (4h × 2 machines = 8h).
- Legacy DailyCapacity1–7 fields superseded by production calendars.

### UKG / WFM tools
- Rotation Schedule Templates: position rows, qualified-only picker, unassigned rows → open shifts.
- Job transfer = day-scoped reassignment between line×role "jobs" (dept is the common planning
  level; station granularity is rare in WFM — left to MES).

### Practitioner world
- PM thread layout: "columns by machine, rows by workday, operators color-coded, customer+job
  number below, room for ~6 jobs a row."
- Hot-list per machine: hottest jobs on top with blocked-off hours.
- User Solutions template: Machine Master / Job Queue / load heat map (red over-committed, amber
  approaching) / sequencing sheet; explicit setup-vs-run split.

## Sources

- SAP: guru99.com/capacity-requirement-planning-sap-pp.html · erproof.com/pp/sap-pp-training/sap-work-center-capacity/ · fioriappslibrary.hana.ondemand.com (F3289) · help.sap.com intervals-of-available-capacity · community.sap.com capacity-split QA · sap-tcodes.org/tcode/cmp3.html
- Epicor: epiusers.help/t/shop-load-report-wrkctrcap-calculations/91741 · /t/overload-informer/107525 · /t/scheduling-multiple-resources-when-to-use-people-size-vs-machines/116744 · /t/what-are-dailycapacity1-thru-7-on-the-resourcegroup/132396
- WFM: help.wheniwork.com user-view/position-view/coverage-view reference guides · communityfiles.ukg.com AddOnDailyCoverage + RotationScheduleTemplates · library.ukg.com Schedule_Patterns + Transfer_Shift · docs.oracle.com wosc-24b F32402 · help.deputy.com copy-shifts + schedule-templates (403; snippet-derived) · tcpsoftware.com humanity position report
- Practitioner: practicalmachinist.com threads 393367, 393368, 252711, 427334, 386668, 446887 ·
  usersolutions.com/excel-templates/machine-scheduling + capacity-planning · magnatag.com shift-manning-and-job-loading + attendance boards · merca.team/en/lean-competency-matrix/ · allics.be/blog/rough-cut-capacity-plan/ · quizlet CPIM formula decks · smartsheet.com RCCP · jitbase.com Excel-ubiquity posts (vendor claims flagged)
- Reliability flags: SAP Community/Help and Deputy/Practical Machinist block fetching — those
  findings rest on reader proxies and search excerpts; vendor "99% use Excel" figures uncited.

## Niche Job-Shop Tools (ProShop, JobBOSS²/E2, Global Shop, PlanetTogether, LillyWorks, Schedlyzer, Fulcrum, MRPeasy, Katana)

Primary-source coverage: E2 Enterprise User Guide + Reference Manual PDFs, ProShop in-app help
wiki, PlanetTogether training workbook + KB (Wayback), GSS whitepaper/product-sheet PDFs, MRPeasy
user manual, Katana help center. Fulcrum/LillyWorks/Schedlyzer are marketing-page-sourced (flagged).

### Load-screen archetypes
- **Bucketed hours-vs-capacity grids with threshold colors** (the photo's shape): E2 Scheduling
  Whiteboard (day/week/month buckets, per-bucket % graphs, dedicated Past Due Hours / Future Hours
  columns, viewable by Work Center / **Employee** / Department / Job); Global Shop "Plant View"
  (department×date daily matrix — red overloaded, yellow = at 100%, green under, blue weekends);
  PlanetTogether Capacity Plan (weekly/monthly/custom buckets; four canonical measures: Available
  Capacity Hrs, Scheduled Usage Hrs, Available Capacity %, Scheduled Usage %); MRPeasy MPS
  (weekly+ buckets, Required hours vs Total capacity, light-blue/green/orange bands with
  configurable min/max load thresholds).
- **Timelines/queues colored by lateness, not utilization**: ProShop (row-per-resource block
  timeline; its own docs state "We don't have a tool that tells you how many hours you have
  looking forward"), Fulcrum (column-per-machine card queue; overload surfaces as backlog/late %).
- **No load board by philosophy**: LillyWorks PFM (Threat-Level forward simulation), Schedlyzer
  (finite solver; utilization is an output report), Katana (single factory-wide weekly-throughput
  number).

### Cross-tool findings
1. **Demand hours = routing estimates in every single tool**; availability = shift calendar ×
   machine count (E2 "Capacity Factor", MRPeasy workstation count) or × headcount (PT "Nbr of
   People" — "capacity hours multiply the duration by the number of people").
2. **Fullest hours vocabulary**: E2's Estim Hours / Actual Hours / Hours Left / Percent Complete +
   separate Scheduled Start/End; PT's Scheduled Usage vs Available Capacity + expected vs
   reported. No tool has a formal planned≠scheduled≠actual triad — Carbon showing demand,
   scheduled (capacityReservation), and available together exceeds all of them.
3. **Labor-model spectrum** (strongest→weakest): PlanetTogether (dual finite seizure machine +
   operator, Capabilities/skills, named labor resources with personal calendars, Allowed Helpers,
   Attention %, people size speeds ops) > Schedlyzer (dual-resource, "skills rather than specific
   worker names", solver assigns people) > GSS (skill-set constraint scheduling, employee
   calendars) > E2 (Operator/Shift Dispatching grids; doctrine: people-based work centers get
   INFINITE loading — "you can always add more people") > ProShop (person-as-resource for
   programming/inspection only) > MRPeasy (named assignees, explicitly no worker-capacity check;
   stated priority: materials → workstation capacity → workers) > Katana/Fulcrum/LillyWorks.
4. **Person×day matrix: NO surveyed tool has a true attendance-driven one.** Closest: E2's
   Employee Whiteboard view (person×bucket load matrix with department/shift filters — derived
   from static dispatch defaults, not who showed up) and Shift Dispatching grid (default operator
   per WC per shift); MRPeasy HR Planning (department×day required-headcount, demand side only);
   Schedlyzer's solver-emitted per-worker dispatch lists. Explicitly absent in ProShop, GSS, PT,
   LillyWorks, Fulcrum, Katana. **Carbon's people board + matrix would exceed every incumbent.**
5. **Missing-estimate fallback: no tool documents a ladder.** All hard-require routings (PT jobs
   land in "Failed to Schedule"; E2: "route every job"). Only corrections found: E2's optional
   calculated-cycle-time-from-actuals during Global Reschedule and efficiency-% inflation. An
   explicit routing → quoted → historical ladder is genuinely novel.
6. **Release semantics**: best-in-class is PT's commitment filter ON the load board (All Jobs /
   Released Only / Firm Only); E2's status ladder Planned → Firm → Released (traveler printed)
   with Schedule Codes keeping planned jobs out of the default schedule; ProShop's opt-in phantom
   blocks for quoted work; Fulcrum's 48-hour freeze window; LillyWorks/Schedlyzer compute a
   delayed "just-right" release date to control WIP. Speculative load is opt-in everywhere.

### Additional sources
- E2: client.shoptech.com/faq/Enterprise/Manuals/User_Guide.pdf + /faq/manuals/reference.pdf
- ProShop help wiki: schedule module hub, Master Week, Definition of Avail, Person as a Resource
- PlanetTogether: PT_Training_Workbook.pdf + KB via Wayback (Capacity Plan, Labor Scheduling,
  Resource Options, Capabilities, Shop Views)
- GSS: scheduling whitepaper + APS product-sheet PDFs, Labor Performance Dashboard blog
- MRPeasy manual (MPS, Production Schedule, HR Planning, My production plan); Katana help center
- Fulcrum/LillyWorks/Schedlyzer/Optisol product pages (flagged marketing-sourced)
