# Daily Crew / Station Assignment Research: Best Practices Survey

## Summary

Surveyed how the industry handles the day-start practice a veteran
manufacturing manager described: before the shift begins, the supervisor
decides which worker runs which station today. Four sweeps: enterprise ERP/MES
(SAP, Epicor), modern MES/connected-worker platforms (L2L, Redzone, Tulip,
First Resonance ION, Manufacturo, Plex), workforce-management products (UKG,
Shiftboard, Deputy, Quinyx) plus the underlying lean practice (manning boards,
skills matrices, huddles), and APS engines' labor models (PlanetTogether,
Opcenter/Preactor, Asprova, Fulcrum, MRPeasy, Katana). Headline findings:
**(1)** the pre-shift person→station board is a near-universal *physical*
practice (magnetic manning boards + ILUO skills matrix on the wall) that
almost no software ships as a first-class feature — SAP Digital
Manufacturing's recent "Schedule Labor" apps are the lone true analog;
**(2)** everyone separates the *planned* roster from *actual* labor capture,
and enforces qualification at the point of work, not at assignment time;
**(3)** no surveyed product closes the loop from the day's crew into a finite
scheduler — the exact loop Carbon is positioned to close, since our engine
already books named, qualified employees onto operations.

## Competitors Surveyed

- **SAP S/4HANA + SAP Digital Manufacturing (DM/DMC)** — enterprise reference;
  DM's Resource Orchestration is the only first-class shift-plan
  (operator × shift × work center) product found.
- **Epicor Kinetic (+ Advanced MES/Mattec)** — job-shop reference; approximates
  crews via operators-as-resources and crew-size multipliers.
- **L2L, Redzone (QAD), Tulip, First Resonance ION, Manufacturo, Plex MES** —
  modern MES / connected-worker layer; where the floor actually meets software.
- **UKG (Kronos), Shiftboard (UKG), Deputy, Quinyx** — workforce management;
  position-level scheduling, qualification gating, call-out/backfill flows.
- **PlanetTogether, Siemens Opcenter APS (Preactor), Asprova, Fulcrum,
  MRPeasy, Katana** — how scheduling engines model labor and reconcile
  manager-made assignments.
- **Lean/IE practice** — Magnatag manning boards, ILUO cross-training
  matrices, tiered huddles, hour-by-hour boards, ergonomic rotation research.

## Key Consensus Patterns

### 1. The daily crew plan is an execution-layer artifact, distinct from both the HR roster and labor actuals

- **SAP DM**: shift planning is positioned as "an execution-level activity for
  shop floor preparation" that "doesn't replace HR systems"; the plan (Schedule
  Labor → View Labor) is separate from actuals (POD Labor On/Off, CO11N
  personnel number on confirmations).
- **Epicor**: planned side is master-data defaults (Shop Employee → default
  Resource Group); the durable record is the labor detail created at
  clock-in/start-activity.
- **WFM products**: schedule/positions live in the WFM tool; time & attendance
  actuals flow to payroll/ERP separately.
- **Rationale**: the plan answers "who should be where"; actuals answer "who
  was where" (costing, traceability). Conflating them breaks both.

### 2. Almost nobody ships the manning board — it's a whiteboard

- **Physical practice** (Magnatag et al.): magnetic board, one row/space per
  station (5–50), name cardholders moved per shift, color coding for skill
  level/seniority/status (absent, training, light duty), numbered spaces for
  at-a-glance manning counts, 3-shift columns. Consulted against a wall-mounted
  **ILUO skills matrix** (I = in training, L = supervised, U = independent,
  O = can teach) during the **day-start huddle** ("manpower, resources, and
  attendance" is the explicit tier-1 agenda).
- **Software**: MES platforms do work-item dispatch (L2L, Manufacturo, ION) or
  station-login-inherits-work (Plex, Tulip); WFM does shifts + areas but the
  within-shift station layer "largely remains a whiteboard practice." Only SAP
  DM's Schedule Labor / Schedule Labor 2.0 (weekly calendar, operator- and
  work-center-oriented views) is a true product-ized manning plan.
- **Rationale for the gap**: the decision needs same-morning attendance +
  qualification + production-priority context that HR tools don't have and
  ERP cores never modeled. It's white space.

### 3. Qualification gating is two-layer: filter at assignment, enforce at execution

- **SAP DM**: Schedule Labor 2.0 filters assignable workforce to *certified*
  workers; the POD *hard-verifies* certifications when work is executed.
- **Shiftboard**: compliance engine "automatically excludes non-compliant
  workers from being scheduled" (strongest assignment-time gate found).
- **Plex**: "Training Required for Login" hard-blocks the workcenter Control
  Panel; supervisor "Part-Specific Training" override exists with
  traceability. **ION**: role-qualified sign-offs block step completion.
- **L2L/Redzone**: skills matrix is advisory decision-support ("who is
  qualified to step in") with no gate.
- **Rationale**: assignment-time filtering prevents planning mistakes cheaply;
  execution-time enforcement is the compliance backstop. Advisory-with-warning
  at assignment + hard gate at execution is the dominant combination.

### 4. Attendance/call-out is the disturbance the feature must absorb

- **WFM**: open shifts (unfilled position placeholders), UKG Call List (ranked
  eligible backfill candidates via procedure sets), Deputy "Find Replacement"
  (re-offer → first claimer wins), Shiftboard plant-specific fill ordering +
  overtime equalization.
- **SAP DM REO**: "automatic reallocation for disruptions — reassigning tasks
  quickly in case of breakdowns or absenteeism"; drag-and-drop reassignment.
- **Manual practice**: supervisor moves magnets when someone calls out, after
  checking the skills matrix for who can cover.
- **Rationale**: the board's highest-value moment is 6:00 AM with two
  call-outs; a static assignment table without a reshuffle flow misses the
  point.

### 5. Schedulers consume labor as pools/headcount or named eligibility — manager fixes are capacity edits or pins

- **Preactor**: labor = secondary-constraint *quantity per shift pattern*;
  absence handling = lower the number, regenerate ("Remaining Capacity
  Suspension" pauses in-flight ops through labor-starved windows).
- **PlanetTogether**: explicit tri-modal — Named Employees / Shared
  Capability / Labor Pools; "Number of People" per capacity interval is the
  crew-size dial; labor data importable from workforce systems.
- **Asprova**: closest to Carbon's model — named workers as *sub resources*
  with their own shift calendars (machine runs 24h, worker calendar has
  breaks), a **skill map** matrix driving a "resource valid condition"
  (eligibility), and operation pinning/resource lock for manual fixes.
- **Katana/MRPeasy**: assignment exists (default operator per resource /
  default workers) but is *decoration* — the engine ignores it as capacity.
- **Rationale**: where labor identity matters, the industry pattern is
  *eligibility constraint* (who MAY be picked) + *pinning* (what MUST hold),
  not a separate scheduling algorithm.

### 6. UI conventions

- Grid of stations × shift with person cards; drag-and-drop placement
  (SAP REO Gantt drag-drop; Magnatag physically); color coding for skill
  level / status; unassigned pool + open-position placeholders (UKG open
  shifts); copy-forward from yesterday / weekly templates (SAP Schedule Labor
  is a weekly calendar); read-only roster for the floor (SAP View Labor);
  mobile/kiosk delivery of "your station today" (WFM push notifications;
  Tulip badge-in shows pre-assigned location with change dropdown);
  coverage/KPI overlays (UKG coverage metrics; SAP capacity-vs-demand KPIs).

## Answers to Research Questions

1. **Entity + terminology + granularity** — the practice's word is **manning
   board / crew deployment / labor line-up**; SAP DM calls the record a
   **shift plan** (operator × shift × work center, with allocation
   percentages); APS vocabulary is *labor pool / secondary resource / sub
   resource*. Granularity consensus: **person × station × shift × date**, with
   within-shift *segments* (UKG segments, Deputy micro-scheduling, rotation
   practice) as the finer optional layer.
2. **Skills + attendance interaction** — assignment-time *filtering* to
   qualified people (SAP DM, Shiftboard) or advisory warnings (L2L, Redzone);
   execution-time *hard* enforcement (Plex login, SAP POD, ION sign-offs).
   Attendance surfaces at the board (In/Out boards, absence status colors) and
   drives backfill workflows (Call List, Find Replacement, open shifts).
3. **How the worker learns it** — mobile push / schedule view (WFM, SAP View
   Labor), station badge-in showing the pre-assigned location (Tulip), or the
   station-scoped dispatch list they see after login (Epicor Work Queue, SAP
   POD, Plex Control Panel). The huddle remains the human announcement layer.
4. **Does scheduling consume it?** — in ERP/MES cores and WFM: **no** (the
   loop is open everywhere; assignments are floor management). In APS: labor
   is a real constraint but sourced from calendars/pool quantities the planner
   maintains, not from a daily crew board. SAP DM is the only place the shift
   plan feeds dispatching, and even there ERP-level planning doesn't read it
   back. **Nobody closes the loop board → finite scheduler.**
5. **UI conventions** — see Pattern 6. Grid + drag-drop + color + unassigned
   pool + copy-forward + read-only floor view are the recurring elements.
6. **Lifecycle** — created day-before or at day start (SAP's apps plan
   weekly; the huddle finalizes daily); mid-shift reassignment is expected
   (REO drag-drop, magnet moves, supervisor reassignment in Tulip); the plan
   is NOT the historical labor record — actuals (clock-ins, labor on/off,
   production events) are. Plans are kept for reference (View Labor shows
   assigned dates/shifts/work centers) but costing/traceability reads actuals.

## Competitor-Specific Details

### SAP Digital Manufacturing (the reference implementation)
Two complementary apps: **Schedule Labor** (operator-oriented: "which operator
works on which work center during this period?") and **Schedule Labor 2.0**
(work-center-oriented: "who staffs this work center?"), both weekly planning
calendars restricted to certified workers, with capacity/demand KPIs.
Finalized plans surface in **View Labor** (read-only roster: worker, date,
shift, work center, allocation %) and are consumed by **Dispatching &
Monitoring** (Gantt drag-drop, automatic reallocation on absenteeism).
Distinct from **Manage User Assignments** (authorization: which stations a
user may ever operate). Execution actuals via POD Clock In/Out + Labor
On/Off. SAP's HR-side future is SuccessFactors Workforce Scheduling
(skills/absence-aware, DM-integrated, GA target H2 2026).

### Epicor Kinetic
No crew entity. Shop Employee carries a *default* Resource Group/Resource
(home station) + shift; Work Queue is station-scoped. To make labor a
scheduling constraint you model people as Resources — with a documented
limitation that the engine "cannot reassign resources" mid-operation (no
shift handoff), pushing users to virtual-operator workarounds or Advanced
MES. Crew size on operations is an anonymous duration/cost multiplier.

### Shiftboard (UKG) / UKG Pro WFM
Manufacturing-first position scheduling: required qualifications per shift,
compliance engine that hard-excludes ineligible workers, union seniority +
overtime equalization + codified call-out orders, audit trail. UKG models
jobs in a business structure with shift *transfers* and *segments*
(multi-station splits), job transfer sets as eligibility whitelists, Call
List backfill, coverage-overlay daily view. UKG acquired Shiftboard (May
2025) to be its manufacturing scheduling engine — evidence generic WFM was
weak here. No MES handoff from either.

### Modern MES platforms
- **Plex**: station login inherits work; "Training Required for Login" hard
  gate (badge login can't validate it); In/Out Board + HCM attendance;
  supervisor part-specific override.
- **Tulip**: Attendance Library app = badge-in → shows pre-assigned location →
  supervisor reassignment; Skill Manager matrix; DIY trigger-based hard gates.
- **L2L**: skills-matrix-first ("who is qualified to step in"), June 2026
  skills-matrix overview release; dispatch-based work assignment; no manning
  board. **Redzone**: huddle-first; skills matrix with expiry dashboard.
  **ION**: qualification enforced at step sign-off. **Manufacturo**: dispatch
  console configurable by work center or team/shift/skill group.

### APS engines
- **Asprova**: named workers as sub resources on machine operations; separate
  worker calendars; **skill map matrix drives assignment eligibility**;
  fixed-operations/resource-lock pinning; infinite-capacity mode doubles as a
  manning calculator. The closest structural match to Carbon's
  attended-window engine.
- **Preactor**: pooled headcount per shift via secondary constraint groups;
  2404's Remaining Capacity Suspension pauses ops through labor gaps.
- **PlanetTogether**: Named/Shared/Pool tri-modal; "Number of People" per
  capacity interval; labor importable from WFM; what-if before publishing.
- **Katana**: default operator per station Resource auto-assigns tasks —
  "assign worker to station, tasks follow" — but zero capacity semantics.

## Recommended Approach for Carbon

Carbon already has the pieces nobody else connects: binary qualifications
(`ability`/`employeeAbility`), shift calendars (`employeeShift` ⋈ `shift`),
an attended-window scheduler that books **named** employees onto operations,
reactive replanning (`carbon/schedule.inputs.changed` → stale-mark → replan
wave), and an MES where operators currently *self-select* a work-center
filter. The manning board is the missing managerial layer on top.

1. **New entity: `crewAssignment`** — `(id, companyId, locationId,
   workCenterId, employeeId, date, shiftId?, note?)`, unique per
   (employee, date, shift) so one person holds one station at a time
   (relaxable later to time segments for rotation, per Deputy
   micro-scheduling / UKG segments). This is the *plan*; `productionEvent`
   remains the *actual* — mirroring the universal plan-vs-actuals split
   (Pattern 1). History = just keep the rows (View Labor pattern).
2. **Manager UI: a "Crew" board in the Schedule area** (sibling view to
   Work Centers/Capacity/Timeline): date + shift picker; columns = work
   centers at the location (same mental model as the MES/ops Kanban);
   cards = people, dragged from an "Unassigned" pool column. Card
   affordances follow the physical board: qualification badge per station
   (green = qualified via the station's processes' abilities, amber = not —
   **advisory warning, not a block**, since stations host multiple processes
   and the hard gate already exists at MES start), absent toggle,
   copy-from-yesterday / copy-last-week, headcount per column, print/kiosk
   read-only mode for the floor (Magnatag/View Labor equivalents).
3. **MES consumption (v1 value):** on login/PIN-in, default the operator's
   operations view to *their assigned station today* (their assignment chip
   visible, override allowed — advisory-first, matching L2L/Redzone rather
   than Plex's hard lock). The supervisor's board replaces the whiteboard;
   the operator stops choosing their own filter.
4. **Scheduler consumption (v2, the differentiator):** for dates with
   assignments, constrain/prefer the attended allocator's eligible-member set
   at each work center to that day's assigned crew (Asprova's "resource valid
   condition" semantics — eligibility, not a new algorithm). Fall back to
   any-qualified-on-shift where no crew is defined (config: hard vs soft).
   Crew changes fire `schedule.inputs.changed` (new kind `"crew"` with
   `entityId = workCenterId`) so the existing replan wave absorbs call-outs —
   the automatic-reallocation behavior SAP REO advertises, which our
   pipeline already implements generically.
5. **Terminology:** call the surface **Crew** (board), the row a **crew
   assignment** — matches industry speech ("crew deployment", "manning")
   without inventing vocabulary.
6. **Explicit non-goals for v1:** within-shift rotation segments, overtime
   equalization/union rules (Shiftboard territory), attendance as a module
   (an `absent` flag on the day's board is enough; real T&A stays out of
   scope), and hard assignment-time blocking.

## Sources

### SAP
- https://learning.sap.com/courses/discovering-resource-orchestration-in-sap-digital-manufacturing/explaining-shift-planning
- https://learning.sap.com/courses/discovering-resource-orchestration-in-sap-digital-manufacturing
- https://community.sap.com/t5/supply-chain-management-blogs-by-sap/digital-manufacturing-user-onboarding/ba-p/14086620
- https://community.sap.com/t5/supply-chain-management-blog-posts-by-sap/clock-in-out-and-labor-on-off-with-sap-digital-manufacturing/ba-p/13561374
- https://community.sap.com/t5/supply-chain-management-blog-posts-by-sap/indirect-labor-tracking-within-sap-digital-manufacturing/ba-p/13577802
- https://www.igz.com/en/sap-manufacturing/sap-modules/sap-dm/sap-reo/
- https://incture.com/resource-orchestration-in-sap-digital-manufacturing/
- https://community.sap.com/t5/human-capital-management-blog-posts-by-sap/shift-planning-in-sap-digital-manufacturing-powered-by-sap-successfactors/ba-p/13562406
- https://www.sap.com/products/hcm/workforce-scheduling.html
- https://blog.sap-press.com/key-elements-for-capacity-planning-in-sap-s4hana
- https://community.sap.com/t5/enterprise-resource-planning-q-a/hr-assignment-in-work-centers-use-in-capacity-requirements-planning-and/qaq-p/12397964
- https://community.sap.com/t5/enterprise-resource-planning-q-a/person-responsible-for-work-center/qaq-p/4497976
- https://community.sap.com/t5/enterprise-resource-planning-q-a/individual-capacity-planning/qaq-p/8997248
- https://community.sap.com/t5/enterprise-resource-planning-q-a/sap-cm25-with-dispatching-production-orders-to-individual-work-center/qaq-p/11030227
- https://erproof.com/pp/sap-pp-training/sap-work-center-capacity/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/enter-more-than-one-personnel-number-for-the-same-confirmation-in-co11n/qaq-p/5584595
- https://help.sap.com/docs/r/e1adc70af32241619335c8768a892edb/15.1/en-US
- https://learning.sap.com/learning-journeys/configuring-sap-digital-manufacturing-for-execution-basic-data-and-configuration/controlling-the-production-process-with-user-certifications

### Epicor
- https://www.epiusers.help/t/resource-group-with-crew-size/81399
- https://www.epiusers.help/t/scheduling-a-machine-and-an-operator/87501
- https://www.epiusers.help/t/employee-production-info-fields/96624
- https://www.epiusers.help/t/using-scheduling-system-for-people/48566
- https://www.epiusers.help/t/scheduling-resources-and-resource-groups/66911
- https://www.epiusers.help/t/mes-user-and-employee/106844
- https://www.epiusers.help/t/account-security-settings-are-controlling-employee-access-in-mes/99843
- https://www.starlight.us.com/?page_id=4488
- https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/production-management/
- https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/planning-and-scheduling/
- https://www.epiusers.help/t/assigning-shifts-to-employees-in-hcm/83518
- https://erpvideo.epicor.com/detail/video/5734453279001/defining-a-shift
- https://www.epicor.com/en-us/products/manufacturing-execution-software-mes/advanced-mes/ptw-scheduling/
- https://www.top10erp.org/products/epicor-mattec-advanced-mes
- https://www.gingerhelp.com/erp-time-clock/epicor

### MES / connected-worker platforms
- https://www.l2l.com/solutions/frontline-workforce-management
- https://www.l2l.com/blog/shift-change-whats-new-in-l2l-june-2026
- https://www.l2l.com/blog/training-matrix-example
- https://support.leading2lean.com/hc/en-us/articles/18888827859853
- https://www.l2l.com/platform/dispatch
- https://www.rzsoftware.com/product/learning
- https://rzsoftware.com/our-approach/learning
- https://www.qad.com/solutions/qad-redzone-connected-workforce
- https://www.rfp.wiki/specialty-industries/manufacturing/qad-redzone
- https://rzsoftware.com/product/frontline-collaboration/
- https://support.tulip.co/docs/skill-manager
- https://support.tulip.co/docs/skill-matrix
- https://support.tulip.co/docs/attendance-management-simple-solution
- https://support.tulip.co/docs/overview-stations-and-interfaces
- https://support.tulip.co/docs/user-certifications
- https://support.tulip.co/docs/station-group-app-assignments
- https://www.firstresonance.io/ion
- https://manual.firstresonance.io/features/procedures/steps/fields
- https://manual.firstresonance.io/features/runs/runs-and-step-states
- https://manual.firstresonance.io/features/application-settings/role-based-access-control
- https://manual.firstresonance.io/training
- https://manufacturo.com/resources/blog/automated-work-order-dispatching-for-enhanced-efficiency-and-coordination/
- https://manufacturo.com/
- https://manufacturo.com/industries/aviation-industry-software/
- https://www.plex.com/products/manufacturing-execution-system
- https://www.plex.com/products/enterprise-resource-planning/human-capital-management
- https://blog.themerlanos.com/2025/09/from-operator-to-knowledge-worker.html
- https://plex.rockwellautomation.com/en-us/products/manufacturing-execution-system/production-planning-scheduling-and-management-software.html
- https://plex.com/products/manufacturing-operations-management-mom/production-management/plant-floor-control.html

### Workforce management
- https://communityfiles.ukg.com/support/KOL/OnlineHelp-WorkforceDimensions/en-us/Content/Scheduling_Manager/InsertShiftTransfer.htm
- https://customer2.kronos.com/support/kol/onlinehelp-workforcedimensions/en-us/content/Scheduling_Manager/ShiftTransfer.htm
- https://library.ukg.com/docs/en-us/UKG_Pro_WFM/Timekeeping/Basic_Schedules/Transfer_Shift_Using_Insert_Transfer/Transfer_Shift_Insert_Transfer.html
- https://library.ukg.com/docs/en-us/UKG_Pro_WFM/Advanced_Scheduling/Advanced_Scheduling/Review_Daily_Schedule/Review_Daily_Schedule.html
- https://library.ukg.com/docs/en-us/UKG_Pro_WFM/Advanced_Scheduling/Advanced_Scheduling/Open_Shifts/Open_Shifts.html
- https://customer2.kronos.com/support/kol/onlinehelp-workforcedimensions/en-us/Content/Employee/RequestSelfSchedulingMySchedule.htm
- https://www.ukg.com/learn/resources/product-info/ukg-pro-workforce-management-activities-manufacturing
- https://www.ukg.com/learn/article-library/executive-leaders/why-ukg-workforce-solution-built-manufacturing
- https://library.ukg.com/ukg-mobile-apps-for-employees
- https://tech.rochester.edu/faqs/ukg/
- https://www.shiftboard.com/industries/manufacturing/
- https://www.shiftboard.com/employee-scheduling-for-manufacturing/
- https://www.shiftboard.com/solutions/union-compliance/
- https://www.shiftboard.com/blog/shiftboard-releases-compliance-automation-to-help-enterprises-address-growing-labor-and-employment-laws/
- https://d3bql97l1ytoxn.cloudfront.net/app_resources/426658/documentation/1399553_1705589638501_en-US.pdf
- https://www.shiftboard.com/blog/how-to-manage-the-complexity-of-fair-overtime-distribution/
- https://play.google.com/store/apps/details?id=com.shiftboard.schedulepro
- https://www.ukg.com/company/newsroom/ukg-acquires-shiftboard-leading-energy-and-manufacturing-employee-scheduling-solutions-provider
- https://www.constellationr.com/insights/news/ukg-acquires-shiftboard-eyes-oil-and-gas-energy-and-manufacturing
- https://help.deputy.com/hc/en-au/articles/4621794547855-Organisations-Locations-and-Areas-set-up
- https://help.deputy.com/hc/en-au/articles/10713672481423-Work-a-shift-with-micro-scheduling
- https://help.deputy.com/hc/en-au/articles/10611651590159-Managing-micro-scheduled-shifts-and-timesheets
- https://help.deputy.com/hc/en-au/articles/4688987465743-How-do-I-find-a-replacement-for-a-team-member-that-can-t-work
- https://help.deputy.com/hc/en-au/articles/5930243429391-How-do-I-manage-team-members-calling-in-sick
- https://help.deputy.com/hc/en-au/articles/4688698300687-Open-shifts
- https://www.deputy.com/blog/ensure-the-most-suitable-employee-fills-your-open-shift
- https://www.quinyx.com/workforce-management/scheduling-software
- https://www.quinyx.com/workforce-management/labor-optimization
- https://www.quinyx.com/warehousing-delivery
- https://play.google.com/store/apps/details?id=quinyx.mobile
- https://www.scribd.com/document/919972899/5-Quinyx-Guide-Mobile-App-OOH-Sessional
- https://www.quinyx.com/product-hub/enhanced-employee-availability
- https://www.quinyx.com/solutions/integrations
- https://www.quinyx.com/en-gb/blog/quinyx-partners-epi-use

### Lean / IE practice
- https://www.magnatag.com/shift-manning-and-job-loading
- https://www.magnatag.com/manning-status
- https://www.magnatag.com/industry-job-printed-whiteboard-applications/factory/production-boards
- https://www.leansixsigmadefinition.com/glossary/cross-training-matrix/
- https://mapex.io/en/news/operator-skill-training/
- https://www.fabrico.io/blog/operator-skill-matrix-design/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7038130/
- https://www.veryableops.com/blog/understanding-the-hour-by-hour-board-a-lean-tool-for-efficiency
- https://shoplogix.com/hourly-production-board/
- https://safetychain.com/blog/using-tiered-management-system
- https://www.digilean.com/tier-meetings-in-manufacturing-explained/
- https://shop.ghent.com/product/daily-huddle-whiteboard/

### APS engines
- https://www.planettogether.com/aps-best-practices/labor-scheduling-manufacturing
- https://www.planettogether.com/finite-capacity-scheduling-software
- https://www.planettogether.com/en/knowledge/resource-capacity
- https://www.planettogether.com/en/knowledge/resource-options
- https://lean-scheduling.com/new-release-opcenter-aps-2404/
- https://lean-scheduling.com/products/preactor-advanced-planning-scheduling/preactor-advanced-scheduling/
- https://www.youtube.com/watch?v=j5rjFQnyuvM
- https://docs.ufpr.br/~agnelo.vieira/Preactor/Preactor_Versao17_01_UserGuide.pdf
- https://www.asprova.com/en/faq/use-instructions/000632-2.html
- https://lib.asprova.com/en/e-learning/old-version-e-learning/12661-begginerslesson6.html
- https://lib.asprova.com/en/library/profits/325-skills.html
- https://lib.asprova.com/onlinehelp/en/AS2003HELP00749200.html
- https://asprova.net/scheduling-logic-resource-quantity/
- https://fulcrumpro.com/manufacturing-software/production-scheduling
- https://fulcrumpro.com/manufacturing-software/job-tracking
- https://www.mrpeasy.com/resources/user-manual/settings/human-resources/users/planning/
- https://www.mrpeasy.com/demo-videos/departments-and-workforce-planning/
- https://support.katanamrp.com/en/articles/5967419-how-production-operations-resources-and-shop-floor-operators-are-related
- https://support.katanamrp.com/en/articles/5967423-assigning-tasks-to-operators
- https://support.katanamrp.com/en/articles/5967420-mapping-shop-floor-operators-to-resources
