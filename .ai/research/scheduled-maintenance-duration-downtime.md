# PM Task Duration & "Takes Equipment Offline" — CMMS/EAM/APS Survey

Research on how best-in-class CMMS / EAM / APS model two PM-task attributes and how they
flow into scheduling: (1) **estimated duration**, and (2) whether the PM **takes the asset
offline / reserves production capacity**.

## Summary

Two distinct worlds. **CMMS/EAM** (Fiix, UpKeep, Limble, MaintainX, Maximo, SAP PM) store an
**estimated duration/labor estimate on the PM plan or job-plan/procedure template**, and that
estimate **copies down onto each generated work order** (usually overridable). Units are wall-clock
time (min/hr) and/or **labor-hours** (per-craft, summed across assignees). None of the pure-CMMS
tools treat "this PM makes the machine unavailable for production" as a first-class capacity
reservation — they carry an **asset status** (Online / Offline / Out-of-service) and a **"planned
downtime" event category** used for **OEE/availability reporting**, which is *reporting*, not a
block a production scheduler honors.

Reserving capacity is an **EAM↔ERP/APS integration** concern. **Maximo Scheduler** loads work-order
duration + craft hours onto a resource Gantt. **SAP PP-PM integration** surfaces the PM order in the
production planning board so the work center shows unavailable, and **SAP APO models a maintenance
order as downtime on the resource** — the cleanest example of a PM consuming finite capacity. In
**APS tools generically**, planned maintenance is a **resource-calendar exception / capacity block**:
a fixed window (start + duration) on the machine calendar, which the finite-capacity engine schedules
production around. The block is a **time window by construction, so a duration is inherently required**
to bound it; CMMS "offline" status has no such requirement because it isn't feeding a scheduler.

## Per-vendor

| Vendor | Duration defined on… | Copies to WO? | Units | "Takes offline" concept | Feeds a capacity scheduler? |
|---|---|---|---|---|---|
| **Fiix** | Task/PM template ("estimated time"); parts/SOP attached | Yes → generated WO | min/hr, labor time | Asset **status** + downtime tracking for OEE/availability | No native production scheduler; via ERP/FactoryTalk integration |
| **UpKeep** | PM/procedure template (est. time) | Yes | min/hr | Asset status; downtime logging | No finite production scheduler |
| **Limble** | PM template / task type; est. time | Yes | min/hr | Asset status; planned-downtime reporting | No; labor-oriented only |
| **MaintainX** | Maintenance plan / procedure ("estimated completion time"); **workload-based scheduling** | Yes | min/hr, labor | Asset status; downtime for OEE | **Labor** capacity (staff workload), not machine/production capacity |
| **IBM Maximo** | **Job Plan** (task-level durations, e.g. 30 min inspect / 2 h op / 8 h overhaul) + craft/labor est. | Yes → WO/PM | hr + labor-hours per craft | Asset status; downtime history | **Yes — Maximo Scheduler** loads WO duration + crafts on a resource Gantt (note: resource loading can desync if WO duration is edited in the activity view) |
| **SAP PM/EAM** | **Maintenance order operations** (work + duration, per work center/craft) | Yes (order from plan/task list) | hr + labor (work) | **PP-PM integration**: PM order shown in PP planning board → work center unavailable | **Yes**, via PP planning board; **SAP APO models the maintenance order as resource downtime** |
| **Oracle / Infor EAM** | Job-plan / operation standard hours | Yes → WO operations | hr + labor-hours | Asset status; downtime codes | Via ERP production scheduling integration |
| **APS (generic)** | n/a (not authored there) | — | fixed window (start + duration) | **Resource-calendar exception / capacity block** (hard by default) on the machine calendar | **Yes, by definition** — finite-capacity engine schedules production around it |

## Answers to the key questions

- **Template vs per-WO:** Duration lives on the **PM plan / job-plan / procedure template** and
  **copies to each generated work order** (overridable per WO). Per-WO-only entry is the exception,
  not the norm.
- **Explicit "offline" flag vs OEE category:** Pure CMMS do **not** expose a first-class "reserves
  production capacity" flag distinct from the OEE/downtime *reporting* category — they use an asset
  **status** (Online/Offline/Out-of-service). A true capacity-reserving flag only exists where the
  PM order flows into a production scheduler (SAP PP-PM / APO, Maximo Scheduler, APS).
- **How declared downtime reserves capacity:** In schedulers it's a **fixed window (start +
  duration)** realized as a **resource-calendar exception / capacity block** — typically a **hard
  block** the production sequence must route around (soft/preemptible blocks are rarer). SAP APO's
  "maintenance order = resource downtime" is the canonical shape.
- **Require a duration when offline?** Not enforced in CMMS (status is a boolean-ish state). In an
  APS/scheduler context the block **is** a bounded window, so a **duration is required by
  construction** to close the interval.

## Recommendations for Carbon

1. **Store duration on the PM plan/template, copy to the generated maintenance work order** (keep it
   editable per WO). This matches every EAM surveyed and the copy-down type chain Carbon already uses.
   Use existing numeric-precision helpers; store as an internal-scale duration (minutes or hours) —
   never a JS `Date` diff.
2. **Add an explicit `takesEquipmentOffline` (production-impact) flag on the PM plan**, distinct from
   any OEE/downtime reporting category. It is the signal that the PM should **reserve the work
   center's capacity**, not just log availability.
3. **When `takesEquipmentOffline` is true, require a duration** — the block must be bounded. Enforce
   in the zod model (`.refine`): offline ⇒ duration > 0. This is the one hard validation the survey
   supports.
4. **Reserve capacity as a resource-calendar exception / hard block** (start + duration) on the work
   center/resource, so Carbon's finite-capacity scheduler routes production around it — mirroring SAP
   APO and generic APS. Represent it the same way as a shift/calendar exception on the resource
   timeline the scheduling module already renders, not as a bespoke object.
5. **Keep OEE/availability reporting separate** from the capacity block: the block drives the
   *schedule*; a downtime/availability category (if added later) drives *reporting*. Do not overload
   one field for both.

### Sources

- Fiix PM & work orders: https://fiixsoftware.com/cmms/preventive-maintenance-software/ , https://fiixsoftware.com/cmms/work-orders/
- Limble task types / PM scheduling: https://help.limblecmms.com/en/articles/2982304-types-of-tasks-in-limble , https://limblecmms.com/learn/preventive-maintenance/schedule/
- MaintainX maintenance plans / workload scheduling: https://help.getmaintainx.com/about-maintenance-plans , https://www.getmaintainx.com/compare/maintainx-vs-upkeep
- Maximo PM & job-plan durations: https://info.banetti.com/maximo-preventive-maintenance/ , https://www.ibm.com/docs/en/masv-and-l/maximo-manage/cd?topic=module-preventive-maintenance
- Maximo Scheduler resource-loading vs WO duration: https://community.ibm.com/community/user/discussion/maximo-scheduler-resource-loading-is-not-updated-when-work-order-duration-is-updated-in-the-activity-view
- SAP PP-PM integration (PM order → work center unavailable): https://community.sap.com/t5/enterprise-resource-planning-q-a/pp-pm-integration/qaq-p/10917351 , https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/efc7922405fd4d56b7571930c5eaa798/d784b8535c39b44ce10000000a174cb4.html
- SAP APO maintenance orders as resource downtime: https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/d8a0d82aa9c041028502c8c175143205/4d2bc95360267614e10000000a174cb4.html
- APS resource availability / maintenance windows / calendar exceptions: https://www.parsec-corp.com/blog/advanced-planning-scheduling-manufacturing , https://www.theaccessgroup.com/en-us/manufacturing/software/production-planning-and-scheduling/what-is-advanced-planning-and-scheduling/
- CMMS planned downtime + production scheduling coordination: https://www.fabrico.io/blog/cmms-software-prevent-planned-downtime-overruns-manufacturing/ , https://oxmaint.com/industries/manufacturing-plant/maintenance-impact-production-schedule-manufacturing
