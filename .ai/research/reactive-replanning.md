# Reactive Replanning Research: Best Practices Survey

## Summary

Researched how ERP/APS systems keep finite-capacity schedules current when scheduling
inputs change after job release (operator qualifications added/removed, shift/calendar
changes, work-center downtime, new resources). Surveyed SAP (MRP + PP/DS), dedicated
APS tools (Siemens Opcenter APS/Preactor, PlanetTogether, just plan it, Asprova),
mid-market ERPs (Dynamics 365 SCM, Epicor Kinetic, Infor CloudSuite Industrial/SyteLine,
Plex), and SMB competitors (Katana, MRPeasy, Odoo, Fulcrum, Fulfil). The industry
consensus is unambiguous: **no system silently rewrites a released schedule when master
data changes.** The standard architecture is *change-event → mark affected work stale →
surface actionable staleness to the planner → planner (or a bounded periodic run)
replans*, with explicit firm/pin/lock flags and a frozen near-term window protecting
human decisions from automation. Operator-skill-aware scheduling exists only in the
enterprise tier (D365, Epicor APS, Opcenter secondary constraints, PlanetTogether,
Plex Finite Scheduler); **no SMB competitor models it at all**, and no system anywhere
auto-replans on a qualification change — the closest is Opcenter 2510's new
`SecResEvent`, which merely *fires an event* when a labor-type constraint changes.

## Competitors Surveyed

- **SAP S/4HANA (MRP + embedded PP/DS)** — the enterprise reference for planning-run
  architecture (planning file entries, net change, exception messages, firming).
- **Siemens Opcenter APS (Preactor)** — market-leading dedicated APS; the reference for
  schedule repair vs regenerate and secondary (labor) constraints.
- **PlanetTogether** — APS with the most aggressive near-real-time replanning story,
  bounded by frozen spans and lock/anchor.
- **just plan it (NETRONIC)** — SMB APS with true recalc-on-every-change automatic mode.
- **Dynamics 365 SCM** — Planning Optimization (regenerative-only), action messages,
  resource capabilities with expiration + HR competencies.
- **Epicor Kinetic** — nightly MRP + Global Scheduling, firm vs locked jobs, capability
  scheduling in APS; the cautionary tale for churn ("MRP runs at night and undoes my
  changes").
- **Infor CloudSuite Industrial/SyteLine** — regenerative + incremental "Plan on Save",
  frozen scheduled operations.
- **Plex (Rockwell)** — Finite Scheduler models skilled/certified employees as
  constraints (docs thin on replan mechanics).
- **Katana, MRPeasy, Odoo, Fulcrum, Fulfil** — Carbon's closest in-market competitors;
  static-until-touched except Fulcrum's autoschedule + freeze window.

## Key Consensus Patterns

### 1. Change events mark work stale; planning consumes the marks in batch

- **SAP**: every MRP-relevant change writes a **planning file entry**; the nightly
  **net-change** run (NETCH) plans only flagged materials; periodic **regenerative**
  (NEUPL) runs rebuild everything. Even PP/DS's "event-driven" planning procedures
  default to *writing a planning file entry* for the next run; immediate replan is
  reserved for capable-to-promise.
- **Epicor**: net-change MRP processes only parts/jobs with logged changes.
- **Infor**: regenerative APS runs + **incremental planning** triggered on saving
  *demand* (Plan on Save) — not on master-data edits.
- **D365**: Planning Optimization is regenerative-only but fast enough to run
  intraday; plan filters scope the run.
- **Rationale**: decouples detection (cheap, synchronous) from planning (expensive,
  serialized); gives a natural batching point and audit trail.

### 2. Master-data changes never auto-reschedule released orders

- **SAP**: factory-calendar changes don't even propagate to PP/DS resources
  automatically (KBA 3116595); repair is a planner-run heuristic (SAP_DS_01 "stable
  forward scheduling").
- **D365**: docs explicitly instruct "rerun all tasks that depend on calendars" after
  calendar edits; capability expiration gates only *future* scheduling runs.
- **Opcenter APS**: shop-floor/MES deviations appear in an auto-refreshing **Alerts
  Window**; the planner decides when to run Schedule Repair or regenerate.
- **SMB tier**: Odoo — planned work orders "pile up" at a downed work center until a
  user re-plans; MRPeasy/Katana — labor/calendar changes have no effect on existing
  schedules.
- **Exceptions**: just plan it's *automatic mode* recalcs after every data change
  (pins protect manual work); Fulcrum's Autoschedule continuously re-optimizes outside
  a user-owned **freeze window**; PlanetTogether can trigger rescheduling from live
  ERP signals but bounds it with frozen/stable spans and a what-if→publish gate.
- **Rationale**: silent rewrites destroy shop-floor trust ("schedule nervousness");
  the planner must stay the author of the plan.

### 3. Staleness is surfaced as actionable, cause-specific messages

- **SAP**: MRP **exception messages** on firmed receipts — "bring forward" (10),
  "postpone" (15), "cancel" (20) — reviewed in MD04/MD06; PP/DS **Alert Monitor**
  (lateness/pegging/resource-overload alerts) linked to the planning board.
- **D365**: **action messages** (Advance/Postpone/Increase/Decrease + derived actions
  down the BOM) with margins and an action-message fence; "calculated delays"
  propagate lateness up to the sales order.
- **Epicor**: expedite/postpone **suggestions** in the Planning Workbench.
- **Infor**: exception messages + Material Planner Workbench.
- **Katana/MRPeasy/Odoo**: red/overdue badges only.
- **Rationale**: tell the planner *what changed, which orders are affected, and what
  the system would do* — then let them apply it.

### 4. Nervousness control: frozen window + explicit firm/pin/lock

- **SAP**: planning time fence with four firming types (P1–P4); firmed orders are
  never auto-changed; PP/DS distinguishes **firmed** (existence/quantity) from
  **date-fixed** (position) — deliberately no "semi-firmed" state.
- **PlanetTogether**: **Frozen Span** (head of schedule locked+anchored) + **Plant
  Stable Span** (slushy zone) + per-activity **Lock** (resource) / **Anchor** (time).
- **Fulcrum**: configurable **freeze window** (e.g. 48h) — humans own the near term,
  the algorithm owns the future.
- **Opcenter**: **Schedule Repair** modes preserve prior sequence/resource choices
  ("Maintain Sequence when Possible", "Prevent any Sequence Change" leaves unfittable
  ops *unallocated* rather than reshuffling); locked ops never move without an explicit
  ignore-locks override.
- **Rationale**: bounded change beats optimal-but-different; repair > regenerate for
  trust.

### 5. Operator skills as scheduling constraints — enterprise-only, never a replan trigger

- **D365**: resource **capabilities** (level, priority, **validity/expiration dates**)
  + route requirements referencing HR **competencies** (skills, certificates).
  Expiration gates future scheduling only.
- **Epicor APS**: capability/dependent-capability scheduling across equipment and
  employees.
- **Opcenter**: labor as **secondary constraints** with Match Field rules; 2510's
  **SecResEvent** fires events on secondary-constraint changes (disabled by default).
- **PlanetTogether / Plex**: capabilities / "skilled, certified employees" as
  constraints.
- **SMB tier (Katana, MRPeasy, Odoo, Fulcrum, Fulfil)**: none model skills as a
  scheduling constraint (MRPeasy's advice: model five welders as five workstations;
  Odoo's "Allowed Employees" is an execution gate, not a planning constraint).
- **Rationale for Carbon**: ability-gated finite scheduling at SMB price point is
  white space; matching it with staleness detection would exceed the incumbent
  baseline.

## Answers to Research Questions

1. **Auto-replan vs periodic vs stale-flag?** — Overwhelmingly *stale-flag + periodic
   batch + planner-applied suggestions* (SAP, D365, Epicor, Infor, Opcenter). True
   reactive auto-replan exists only where guarded: just plan it (pins), Fulcrum
   (freeze window), PlanetTogether (frozen span + what-if gate). No system
   auto-replans on a *qualification* change specifically.
2. **Replan scope?** — Net change (only flagged/affected orders) for routine runs +
   periodic full regeneration to clear drift (SAP NETCH/NEUPL, Epicor net
   change/regen). Repair-style replans preserve sequence and resource assignments
   (Opcenter Schedule Repair, SAP_DS_01 stable forward scheduling). Affected-set
   computation is via change flags on the planning object (SAP planning file,
   low-level codes), not dependency inference.
3. **Nervousness control?** — Frozen window at the schedule head (48h–2wk), firm/lock
   flags on orders/operations, repair-over-regenerate, and (D365) action-message
   margins so small drifts don't generate noise.
4. **Staleness UX?** — Exception/action-message queues in a planner workbench, colored
   flags on affected orders, alert monitors tied to the planning board, what-if
   simulation separate from the live schedule with an explicit publish step.
5. **Pins vs automation?** — Explicit, binary, durable flags (firm/lock/anchor/pin)
   that every automated pass honors; overriding them requires an explicit switch
   ("Ignore Locked Operations", jpi "force move"). Carbon's `manuallyScheduled` is
   this pattern.
6. **Terminology to adopt**: *net change*, *regenerative*, *firm/pinned*, *frozen
   window*, *schedule repair*, *action/exception message*, *stale schedule*.

## Competitor-Specific Details

### SAP
Planning file entries (MD21) written by every MRP-relevant transaction; processed in
low-level-code order; NETCH nightly + NEUPL weekly is the classic cadence. Exception
messages 10/15/20/30 within a configurable rescheduling horizon (OMDW). PP/DS planning
procedures decide per-event: do nothing / plan immediately / write planning file entry.
Repair heuristics: SAP_DS_01 (stable forward scheduling for capacity loss), SAP_PP_009
(bottom-up date repair). Qualifications live in classic CRP (HR-linked work-center
capacities) and SAP MRS (separate product); not a PP/DS planning event.

### Siemens Opcenter APS
Alerts Window (MES-agnostic, auto-refreshing) + planner-triggered regeneration.
Schedule Repair re-places all ops but remembers prior order/resource; four strictness
modes; unfittable ops go *unallocated* rather than forcing resequencing. SecResEvent
(2510) fires on labor/tool secondary-constraint changes. Labor = secondary resources
with Match Field eligibility rules.

### PlanetTogether
Optimize + Optimize Rules; Frozen Span / Plant Stable Span / Lock / Anchor /
job-specific optimize (12.3); what-if scenarios against a copy, publish to commit.
Resources carry capability checklists; operator/supervisor resource types; Shiftboard
integration for labor availability.

### just plan it
Global automatic vs manual scheduling mode; automatic = recalc after every data
change; hybrid pins specific jobs. New-order auto-schedule doesn't move existing
schedules; manual moves propagate only within the same order chain. Explicit
anti-"one big optimize button" philosophy.

### Dynamics 365 SCM
Planning Optimization regenerative-only; freeze + firming time fences (auto-firm
inside fence); action messages with margins; resource capabilities carry
level/priority/expiration; route requirements can reference HR competencies
(skills/certificates/courses); master planning never reschedules firmed/released
production orders.

### Epicor Kinetic
Nightly MRP (regen or net change) + Global Scheduling; **firm** protects from MRP,
**locked** protects from Global Scheduling/Load Leveling — practitioners auto-lock on
release via BPM to stop the nightly run shuffling the floor. Suggestions reviewed in
Planning Workbench. APS adds capability/dependent-capability scheduling.

### Infor CloudSuite Industrial (SyteLine)
Regenerative APS + incremental Plan-on-Save for demand; scheduler-sequenced operations
are treated as *frozen* by subsequent planning runs; exceptions reviewed in Material
Planner Workbench.

### SMB tier (Katana, MRPeasy, Odoo, Fulcrum, Fulfil)
Katana: priority-list recompute of reservations/deadlines, red-deadline staleness, no
labor constraints. MRPeasy: drag-only rescheduling constrained to free slots; started
ops immovable; workers never gate the schedule. Odoo: daily scheduler cron is
procurement-only; Plan button per MO; downed work centers pile up work. Fulcrum:
continuous Autoschedule + freeze window + one-click Reschedule; labor availability in,
skills unconfirmed. Fulfil: priority queue only.

## Recommended Approach for Carbon

1. **Adopt the SAP planning-file pattern with Carbon's existing event system**: DB
   triggers on scheduling-relevant master data (`employeeAbility`,
   `process.requiresAbility`/`ability`, `shift`/`employeeShift`, `workCenter.active`,
   `workCenterProcess` mappings) enqueue a "scheduling input changed" event; a handler
   computes the affected set (jobs with unfinished ops on processes/work centers
   touched by the change) and stamps them **schedule-stale with a reason** (e.g.
   `job.scheduleOutdatedReason = "Operator qualification changed: Solder"`). Cheap,
   auditable, no replan yet.
2. **Surface staleness as an actionable badge (exception-message pattern)**: dates
   board + job header show "Schedule outdated — qualification changed" with one-click
   **Replan** (existing per-job trigger) and **Replan all affected** (the
   clear-reservations + due-date-priority cascade already prototyped this session).
   This matches SAP/D365/Epicor UX at SMB simplicity.
3. **Make the nightly replan net-change**: consume stale flags (replan only stale
   jobs, in due-date/priority order per company) instead of regenerating everything —
   also fixes the nightly-replan defects flagged in self-review (truncation, timeout)
   by shrinking the work set and fanning out per-job events.
4. **Keep pins sacred**: `manuallyScheduled` already survives replans — document it as
   Carbon's "firm/pinned" and never let any automated pass override it (matches the
   universal pattern; an explicit "unpin" is the only escape).
5. **Later, optional auto-mode**: a per-company setting "automatically replan stale
   jobs" (just-plan-it/Fulcrum style) that feeds stale jobs straight into the
   serialized per-company reschedule queue — default OFF; the badge is the default.
   Consider a small frozen window (e.g. don't auto-move ops starting within N hours)
   before ever enabling this by default.
6. **Positioning**: no SMB competitor schedules on operator qualifications; shipping
   ability-gated scheduling *plus* cause-aware staleness detection exceeds both the
   SMB baseline (no skills) and the enterprise baseline (skills but no
   qualification-change detection — even Opcenter only just added SecResEvent).

## Sources

- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/mrp-processing-keys-explained/ba-p/13003625
- https://community.sap.com/t5/enterprise-resource-planning-q-a/netch-netpl-neupl/qaq-p/2396889
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f899ce30af9044299d573ea30b533f1c/c82fc95360267614e10000000a174cb4.html
- https://userapps.support.sap.com/sap/support/knowledge/en/3116595
- https://learning.sap.com/courses/planning-with-advanced-planning-methods-in-eppds/explaining-heuristics
- https://www.stechno.net/repository/sap-notes.html?id=560969
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/21aead0c98bd4755abdacd91c99e3393/8b73b6535fe6b74ce10000000a174cb4.html
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/mrp-types-p1-to-p4/ba-p/13262708
- https://help.sap.com/docs/SUPPORT_CONTENT/mrp/3138697863.html
- https://sapinsider.org/manage-material-requirements-planning-exception-messages-in-sap/
- https://help.sap.com/docs/SAP_ADVANCED_PLANNING_AND_OPTIMIZATION,_ON_SAP_ERP/04c48971d2ec453e9094c516c8ff4e5a/4fb3e1b35882209de10000000a42189d.html
- https://sapinsider.org/manage-alerts-with-the-alert-monitor-in-sap-pp-ds/
- https://www.brightworkresearch.com/firming-in-apo/
- https://help.sap.com/doc/b183ce53118d4308e10000000a174cb4/700_SFIN3E%20006/en-US/8ec7b65334e6b54ce10000000a174cb4.html
- https://community.sap.com/t5/enterprise-resource-planning-q-a/using-sap-hr-qualifications-in-sap-mrs/qaq-p/11656312
- https://blogs.sw.siemens.com/opcenter/whats-new-in-opcenter-aps-2510/
- https://snicsolutions.com/knowledge/what-does-schedule-repair-do-to-create-a-valid-schedule
- https://lean-scheduling.com/products/preactor-advanced-planning-scheduling/preactor-advanced-scheduling/
- https://www.planettogether.com/aps-trends/advanced-planning-and-scheduling-software-features
- https://www.planettogether.com/blog/lock-anchor-improve-production-schedule-stability
- https://www.planettogether.com/aps-best-practices/labor-scheduling-manufacturing
- https://www.just-plan-it.com/smb-production-scheduling-blog/new-module-advanced-scheduling-ii-further-job-shop-scheduling-enhancements
- https://blog.netronic.com/comparing-drag-drop-production-scheduling-with-automatic-scheduling
- https://asprova.net/reschedule-again-change-scheduling-basis-time/
- https://usersolutions.com/blog/schedule-nervousness-manufacturing
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-home-page
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/action-messages
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/supply-chain-calendars-master-planning
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/planned-order-firming
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/resource-capabilities
- https://www.epiusers.help/t/mrp-regen-vs-net-change/16732
- https://www.epiusers.help/t/scheduling-locked-jobs/51651
- https://www.epiusers.help/t/mrp-runs-at-night-and-undoes-the-schedule-changes-i-have-made/67211
- https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/planning-and-scheduling/
- https://docs.infor.com/csi/10.x/en-us/csbiolh/inventory_user_cl_sl/lsm1454144402967.html
- https://docs.infor.com/csi/latest/en-us/csbiolh/inventory_user_cl_sl/lsm1454144405698.html
- https://plex.rockwellautomation.com/en-us/products/plex-finite-scheduler.html
- https://katanamrp.com/production-scheduling-software/
- https://support.katanamrp.com/en/articles/5914369-managing-manufacturing-order-priorities
- https://www.mrpeasy.com/resources/user-manual/production-planning/production-schedule/
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/workflows/work_center_time_off.html
- https://fulcrumpro.com/manufacturing-software/production-scheduling
- https://fulcrumpro.com/article/maximize-on-time-delivery-with-fulcrums-advanced-autoschedule-a-video-overview
- https://www.fulfil.io/products/manufacturing/
