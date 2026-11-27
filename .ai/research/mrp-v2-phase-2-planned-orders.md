# MRP v2 Phase 2 (Planned Orders) Research: Best Practices Survey

## Summary

This survey covers the questions that MRP v2 Phase 2 must answer before the spec
(`.ai/specs/2026-08-22-mrp-v2-planned-order-generation.md`) goes to a plan. The
earlier research (`.ai/research/mrp-v2-planner-ui.md`) set the basic model: a
planned order, a Planned → Firm → Released lifecycle, a low-level-code sweep and
action messages. This file goes one level deeper. It covers 6 topics:

1. Buffer policies on Make items.
2. Release.
3. Firming and time fences.
4. Netting segments.
5. Lead time, capacity and capable-to-promise.
6. The details of the BOM explosion.
 It also checks the spec against the code on `main` (2026-11-14).

The main findings:

1. SAP and Dynamics 365 explode the **lot-sized** quantity of every planned
   order in the same run. The source of the order does not matter: a buffer
   policy and real demand get the same explosion.
   Carbon still explodes the raw net requirement (`mrp-engine.ts:428`).
2. "Firm" has two meanings in the market. Carbon must pick one name per concept.
3. SAP persists only a manual firm. It computes time-fence firming again on each
   run. The spec persists both, and so it needs a cleanup sweep that SAP does not need.
4. The vendors that publish this behavior use a fixed lead time for planned orders. They schedule on the
   routing only for real orders or inside a time fence.
5. About 10 Carbon features landed after 2026-08-22, the date of the spec. The spec does not
   mention them. The largest are project netting segments, planning groups with
   `projectPeg`, and Consume First.

## Competitors Surveyed

- **SAP S/4HANA (and ECC help)** — the enterprise reference for MRP, firming
  types, individual and collective requirements, scrap and discontinuation.
- **Microsoft Dynamics 365 SCM (Planning Optimization)** — a regenerative cloud
  engine with coverage codes, time fences, marking, delay tolerance and CTP.
- **Oracle Fusion Supply Planning and Oracle EBS ASCP** — time fences, project
  netting, hard pegging and the planning-group concept.
- **Oracle NetSuite** — the closest mid-market peer. It has a reorder-point path and an
  MRP path, planned work orders, and Earliest Item Availability.
- **Epicor Kinetic** — discrete manufacturing. It has unfirm jobs, Make Direct, and Plan as Assembly. Epicor
  hides its MRP help behind a login. Every Epicor claim here comes from the
  epiusers.help forum and is **not confirmed**.
- **Katana, MRPeasy** — SMB tools, used only for capable-to-promise and run mode.

Source quality: much of the SAP help that we could read is release 4.6C, 4.7 or
1610. No current S/4HANA page contradicted it, but we did not confirm it against
current help.

## Key Consensus Patterns

### 1. Lot-size first, then explode — for every planned order

- **SAP**: The BOM explodes "after … procurement quantity calculation, lot-size
  calculation and scheduling". Every procurement proposal for an assembly
  explodes.
- **Dynamics 365**: Planning creates the planned production order with its
  coverage settings. Then it creates the BOM line requirements for all levels.
  The coverage code (Min/Max, Requirement, Period) does not change this.
- **NetSuite**: The MRP path makes a supply plan for each component. The
  reorder-point path is single-level and manual.
- **Rationale**: If the explosion uses the raw need, the components fall short
  by the lot-size surplus. The shortfall shows only after a person creates the
  parent job.

### 2. A buffer need is a planned order like any other

- **SAP**: In MRP (type PD), safety stock lowers the stock available for
  planning, so the run refills it. Reorder-point type VB is the deliberate
  exception. It does not net dependent demand, and the component's own buffer
  absorbs the parent's need.
- **Dynamics 365**: Safety stock is a requirement type, like a sales line. Min/Max
  orders up to the maximum. The planned order explodes the same way.
- **Epicor (forum)**: MRP makes unfirm jobs to protect minimum plus safety.
- **Rationale**: A buffer need that does not explode is the exact Carbon defect
  (the COMMS-001 case in the spec).

### 3. Firm means "MRP must not change this order"

- **SAP**: MRP never changes or deletes a firm planned order. It emits
  "postpone" (15) or "cancel" (20) instead. A firm order still explodes.
- **Oracle**: A firm order is "frozen in quantity and time".
- **Dynamics 365**: Uses **Approved** for this state. "Firming" in Dynamics 365
  means converting to a real order.
- **Rationale**: The planner needs a way to override the plan and still see what
  MRP thinks is wrong.

### 4. Firming by time fence is computed, not stored

- **SAP**: Manual creation or a manual change sets a stored firming indicator.
  Firming by the planning time fence does not set it. It lasts only while the
  order sits inside the fence. MRP treats the two cases differently.
- **Oracle, NetSuite, Epicor**: Store a firm flag only. We found no provenance.
- **Rationale**: A computed fence cannot leave a "zombie" firm order behind when
  its demand goes away.

### 5. A new need inside the fence moves to the fence end, or waits

- **SAP**: Firming types 1 and 3 move the new order to the end of the fence.
  Types 2 and 4 create nothing and leave the shortage open.
- **Oracle Fusion**: The due date is never before the fence. With a natural
  fence, the order is due one day after it.
- **Dynamics 365**: Inside the freeze fence, planning suggests no new orders.
- **Rationale**: Near-term churn ("nervousness") damages the shop more than a
  short delay that the planner can see.

### 6. Fixed lead time for planned orders; the routing for real orders

- **Dynamics 365**: A planned production order uses the static lead time of the
  product. Route scheduling happens only at firming, or inside the capacity time
  fence.
- **SAP**: Offers "basic dates" (in-house production time, workdays) or "lead
  time scheduling" (the routing). Lead time scheduling also creates capacity
  requirements.
- **NetSuite**: Lead time = the item's work order lead time × quantity.
- **Rationale**: The routing is expensive to compute at every level of every
  run. A real order needs the precise date. A planned order does not.

### 7. Rough-cut load per work center per bucket, with no automatic fix

- **SAP**: The "Manage Work Center Capacity" app shows load per work center per
  day or week. pMRP uses infinite loading and buckets. The planner fixes an
  overload by hand.
- **Dynamics 365**: Moves orders automatically only in finite mode, and only
  inside the finite capacity time fence.
- **Rationale**: An automatic reschedule over rough data creates noise. The
  planner decides.

### 8. Components may leave the parent's segment

- **SAP**: The individual/collective indicator on the component, or on the BOM
  item, decides. A collective component uses plant stock under a project parent.
- **Oracle**: Each item has a pegging level and "Allow Use of Common Supplies".
  A soft-pegged component under a hard-pegged parent nets as common supply.
- **Dynamics 365**: The BOM line type decides. "Pegged supply" links a line to
  the order. "Item" draws from pooled stock.
- **Rationale**: Hardware and fasteners are common stock even on a project
  build.

## Answers to Research Questions

1. **How does a buffer need on a Make item become a planned order, and does it
   explode at once?** — SAP and Dynamics 365 make a planned order. They explode
   its lot-sized quantity in the same run. Safety stock is a requirement (Dynamics 365)
   or lowers available stock (SAP PD). SAP VB is the only documented exception,
   and a company chooses it on purpose. NetSuite's reorder-point path does not
   cascade; its MRP path does. Dynamics 365 treats negative on-hand as 0.
2. **What happens at release?**
   - Components: SAP copies the planned order's components to the production
     order as reservations. It explodes the BOM again only if the order type says
     so. SAP warns that a new explosion can differ from the plan. Dynamics 365
     stores the BOM on the planned order. NetSuite commits nothing until release.
   - PO grouping: every vendor groups by supplier. SAP adds the purchasing
     organization and group. Dynamics 365 adds the buyer group, the agreement and
     the period. NetSuite adds the location.
   - Partial release: SAP supports it. The remainder becomes firm and keeps its
     dependent demand. Dynamics 365 splits the order first. Others are silent.
   - Pegging: Dynamics 365 "marking" keeps the link after firming. It has 5
     levels, from No to Extended. SAP and NetSuite do not say.
   - Approval: SAP holds a requisition until a release strategy approves it.
     NetSuite can create work orders in Pending Approval.
3. **How do firming and time fences work?** — See patterns 3–5. Three fence
   types recur:
   - **Planning time fence**: no new or moved orders, or auto-firm.
   - **Demand time fence**: forecast stops counting (Oracle, NetSuite).
   - **Release time fence**: auto-release (Oracle EBS, Dynamics 365 "firming
     fence"). SAP and Oracle count working days. Dynamics 365 Planning Optimization
   tests the order's start date. Each vendor sets the fence per item-site, with
   a group or plant default.
4. **How does the cascade behave across netting segments?** — See pattern 8.
   Oracle Fusion nets the same project first, then the project group, then common
   supply where a rule allows it. SAP's grouping WBS element shares project stock
   across its projects, like a Carbon planning group. Lot-size surplus: Oracle
   EBS gives it to the nearest future unmet project demand, else to common
   supply. Dynamics 365 leaves the surplus unmarked, so it is free supply. SAP
   uses lot-for-lot in project segments by default.
5. **Lead time, RCCP, CTP and run mode?**
   - Lead time: see pattern 6. Dynamics 365 has safety margins in workdays or
     calendar days. SAP has a safety time in workdays.
   - RCCP: see pattern 7.
   - CTP: Dynamics 365 CTP checks material and capacity, and writes the confirmed
     dates to the sales line. Microsoft recommends CTP for make-to-order and ATP
     for make-to-stock. SAP APO CTP simulates, then commits real orders. NetSuite
     Earliest Item Availability only simulates, and writes a date when the user
     accepts.
   - Late supply: since 2023, Dynamics 365 nets a late production order at its
     expected completion, not "today". It passes the delay up every BOM level to
     the sales order. A delay tolerance lets planning peg late supply instead of
     creating new supply.
   - Run mode: SAP MRP Live and Dynamics 365 regenerate. SAP dropped one
     net-change mode because HANA is fast. Dynamics 365 merges up to 10 CTP
     requests into one job. Epicor sites (forum) run a weekly regen and a daily
     net change.
6. **Phantoms, configured BOMs, scrap, supersession, effectivity, cycles?**
   - Phantom: SAP and NetSuite plan nothing for the phantom and pass the demand
     to its components. Dynamics 365 creates a phantom planned order that firms
     only with its parent.
   - Configured BOMs: SAP plans configurable items with planning variants or
     usage probabilities. Dynamics 365 plans each configuration as a variant. No
     vendor documents planning a model with no configuration.
   - Scrap: SAP assembly scrap grosses up the order quantity, and the bigger
     quantity explodes. Component scrap raises only that component. Dynamics 365
     uses constant plus variable scrap per line.
   - Supersession: SAP uses the old part's stock first. Then it moves the rest of
     the demand to the follow-up part, in the planning run, not in the explosion.
     Dynamics 365 has no equivalent.
   - Effectivity: each vendor selects the BOM that is valid on the order's start
     date. Dynamics 365 does not select again when the order moves.
   - Cycles: SAP needs a "recursive" flag on the BOM item. Dynamics 365 blocks a
     cycle when a user saves the BOM, and a cycle fails the planning run.
7. **What in Carbon today must Phase 2 respect?** (code on `main`, 2026-11-14)
   - The core defect stands. `grossDemand` has 6 sources: sales lines, job
     materials, project materials, project borrows, the unconsumed projection
     and the supersession redirect (`plan-company.ts:585-952`). No reorder policy
     feeds it. Sizing runs after the engine, in `generatePlanningActions`
     (`mrp.ts:658`).
   - Lot-sizing has 2 copies, not 3. The copies are the SQL `calculate_quantity_to_order` and
     `computePlanningOrders` (`packages/utils/src/planning-sizing.ts:154-252`). A parity test
     pins them together. The client mirror in `ItemReorderPolicy.tsx` is gone.
   - These features landed later. The spec does not mention them:
     - Netting segments (`planningSegmentId` in every key).
     - Planning groups and the `projectPeg` table.
     - Consume First redirects.
     - Configured BOMs (`bomChildren` drops quantity-0 lines).
     - Non-nettable storage.
     - The planning horizon.
     - Frozen orders and order rules (#1869).
     - Per-batch dating for Demand-Based Reorder (#1912).
     - `allowCommonSupplyForProjects` on `itemPlanning`.
   - MRP applies no scrap today. `job-quantities-engine.ts` applies scrap to
     jobs only.
   - `projectPeg` (`20261021005000_planning-groups-and-pegs.sql`) has a
     polymorphic supply, `parentPegId`, run ids and supersede-not-delete history.
     Its `planningGroupId` and `projectId` are NOT NULL, so it serves groups
     only. It uses the id prefix `peg`, the same as the spec's `plannedOrderPeg`.
   - No table, enum or column in migrations uses the spec's new names
     (`plannedOrder`, `planningRun`, `planningState`, `planningTimeFenceDays`).
     The UI already says "planned orders" for `supplyForecast` rows and
     action-derived drafts.
   - `jobCompletionDate` (`supply-date.ts:61`) dates job supply from the due date. It
     does not read `projectedCompletionAt`.
   - `runQuoteLeadTimeWhatIf` and `runExpediteWhatIf` already exist in
     `packages/planning/src/scheduling/`. The spec does not cite them.
   - Many spec citations are stale. `explodeBom` is now
     `packages/database/src/mrp-engine.ts:260`. Phases 3–6 moved into the pure
     `planCompany`.

## Competitor-Specific Details

### SAP S/4HANA

- Firming types 0–4 on the MRP type control the planning time fence (pattern 5).
- Partial conversion reduces the planned order. When the conversions cover the full quantity, SAP
  deletes the planned order.
- Strategy 20 plans each sales order in its own segment, with no netting
  against other orders.
- Discontinuation: from the effective-out date, MRP creates no new proposals for
  the old part. It ignores safety stock on that part.
- "Safety stock availability" lets MRP use a percentage of safety stock, so the run does not
  create very small orders.
- Exception 64: the production finish date is later than the order finish date.

### Microsoft Dynamics 365 SCM

- Time fences per coverage group, item coverage and master plan: coverage,
  freeze, firming, capacity, action message, forecast plan.
- Approved planned orders carry into each new plan unchanged. Planning deletes
  unprocessed orders on each run.
- A manual planned order does not explode until a user approves it.
- Firming dialog groups POs by vendor, buyer group, agreement or period.
- "Update marking": No, Standard, Extended, Single level standard, Single level
  extended.
- Infinite-capacity route scheduling in Planning Optimization does not support
  resource load.

### Oracle Fusion and EBS

- Hard Pegging Level per item: None, Project and Task, Project, Project Group.
- Reservation Level in EBS: Planning Group, Project, Task, None.
- Borrow and payback between projects: the payback is supply for the lender and
  demand for the borrower.

### NetSuite

- Each run purges and creates planned orders again. Firmed orders stay.
- Reschedule In applies only to unapproved orders outside the planning time
  fence.
- The suggested maximum is 363 days for the planning fence and 364 days for the demand fence.

### Epicor Kinetic (forum only, not confirmed)

- Only MRP creates unfirm jobs. A user cannot edit one without firming it.
  Firming deletes the MRP job and creates a firm job.
- Regen deletes unfirm jobs and suggestions. Net change keeps them.
- "Reorder to Max" orders up to the maximum. Without it, MRP orders back to
  minimum plus safety.
- "Plan as Assembly" splits a subassembly into its own unfirm job. "Pull as
  Assembly" keeps it inside the parent job.

## Recommended Approach for Carbon

Each item names the pattern it follows. Items marked **(spec change)** differ
from the 2026-08-22 spec and need a decision before `/plan`.

1. **Explode the lot-sized quantity in the same run** (pattern 1, SAP and
   Dynamics 365). Move sizing into the LLC sweep. Extend `computePlanningOrders`
   to size one net requirement and return a trace. Do not write the spec's new
   `computePlannedOrderQuantity`. Add the surplus to the parent's projected
   on-hand, so later periods use it. **(spec change: reuse, not new function)**
2. **Make every buffer policy a planned-order source** (pattern 2). Fixed Reorder
   Quantity, Demand-Based Reorder safety stock and Maximum Quantity create
   planned orders that explode. Keep per-batch dating (#1912) and order rules
   (#1869) in that path. Do not add an SAP VB-style "no dependent demand" option
   in Phase 2.
3. **Use one meaning of "Firm"** (pattern 3, SAP and Oracle). Firm = MRP must not
   change the order. Released = a real job or PO exists. A firm order still
   explodes. Its problems come out as the existing `Defer` and `Cancel` planning
   actions. Name the Dynamics 365 mismatch in the glossary entry.
4. **Persist only a manual firm. Compute fence firming on each run** (pattern 4,
   SAP). This removes the spec's `firmedBy='system'` rows and the orphan sweep
   that cleans them up. **(spec change)**
5. **One planning time fence, SAP type-1 behavior** (pattern 5). Inside the
   fence, MRP does not move an order. It moves a new order to the fence end and
   raises an Expedite action for it. Count working days. Test the order's start
   date. Keep `planningHorizonDays` (a display filter) separate from
   `planningTimeFenceDays`. Defer a demand time fence, because forecast
   consumption covers part of that need.
6. **Fixed lead-time offset for planned orders** (pattern 6, Dynamics 365). Keep
   the weekly offset in the sweep. Change it to working days with the shared
   calculator. Leave routing-based dates to the finite scheduler, for real jobs.
7. **Net open jobs at `projectedCompletionAt`** (Dynamics 365 since 2023). Change
   only `jobCompletionDate` and the `openProductionOrders` view. The rule says
   no other place may date supply. Keep `rescheduleToleranceDays` as the delay
   tolerance.
8. **Release reads the make method again**, through the existing job-creation
   path. If the method changed since the run, show the difference in the release
   drawer. SAP copies the planned components by default, and warns that a new
   explosion can differ from the plan.
   Group planned purchases by supplier and location (NetSuite). This extends the
   current `plannedOrdersFromActions` merge. Defer partial release.
9. **Keep the planned order in its parent's netting segment** (pattern 8, Oracle
   order of netting). The existing `allowCommonSupplyForProjects` flag already lets
   project demand draw common surplus. It does not plan a component in the common
   segment. A per-component "plan in common" switch (SAP collective requirements)
   is a later addition. Keep project segments lot-for-lot, as today. Add
   `planningSegmentId` to the planned order's natural key.
10. **Build pegging on the `projectPeg` shape** (Dynamics 365 recomputes pegging
    each run, marking persists). Generalize the table, or copy its design for
    common-segment pegs. Do not add a second table with the `peg` prefix.
    **(spec change)**
11. **Explosion details**:
    1. Explode through the Consume First redirect, in the run (SAP
       discontinuation).
    2. Reuse `bomChildren`, so configured BOMs skip quantity-0 lines.
    3. Gross up the order quantity for scrap, then explode it (SAP assembly
       scrap). Use the same rule as `job-quantities-engine.ts`, so the plan and
       the released job agree.
    4. Release an inline Make to Order child together with its parent (Dynamics 365 phantom rule).
    5. Keep the deterministic cycle break, and add a BOM-save warning (Dynamics 365).
12. **Rough-cut capacity per work center per week, infinite loading, no automatic
    fix** (pattern 7, SAP). The spec already says this.
13. **CTP simulates and writes nothing until the user accepts** (NetSuite). Build
    it on `runQuoteLeadTimeWhatIf`, not as a new engine. Label it with its
    assumptions. **(spec change: reuse)**
14. **Stay regenerative and event-triggered.** SAP MRP Live and Dynamics 365 run
    regenerative. The measured ~0.3–0.5 s full-company run supports a debounced
    trigger. Keep the cron as the drift backstop.

### Open questions to carry into the spec

1. Firm by fence: compute on each run (SAP), or persist with `firmedBy`, as the
   spec says?
2. Inside the fence, which behavior do we want?
   - Move the new order to the fence end (SAP types 1 and 3).
   - Create nothing and show the shortage (SAP types 2 and 4, Dynamics 365
     freeze fence).
3. Release: copy the planned components (SAP default), or read the make method
   again (Carbon job creation today)?
4. Pegging: generalize `projectPeg`, or add a common-segment table?
5. Is a demand time fence needed, or does forecast consumption cover it?
6. Lot-size surplus in a project segment: keep lot-for-lot, or allow Oracle's
   "surplus goes to common supply"?

## Sources

### Buffer policies and explosion order
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d2a8f44af11d182b40000e829fbfe/content.htm
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d27c444af11d182b40000e829fbfe/content.htm
- https://help.sap.com/saphelp_46c/helpdata/en/51/953c22a1fa11d189ba0000e829fbbd/content.htm
- https://learning.sap.com/courses/exploring-production-planning-in-sap-s-4hana/understanding-mrp-in-sap-s-4hana
- https://blog.sap-press.com/safety-stock-with-sap
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/replenishment-methods-quantity-modification
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/production-planning
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/safety-stock-replenishment
- https://learn.microsoft.com/en-gb/dynamics365/supply-chain/master-planning/planning-optimization/negative-on-hand
- https://community.dynamics.com/article/KA-23820
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2330082.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2328390.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2293372.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159172130393.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159172238892.html
- https://www.epiusers.help/t/safety-stock-should-create-unfirm-jobs-but-it-doesnt/91372
- https://www.epiusers.help/t/mrp-suggestions-min-safety-stock/132173
- https://www.epiusers.help/t/how-does-reorder-to-max-work/72367
- https://www.epiusers.help/t/mrp-plan-as-assembly-and-make-to-job/108796
- https://www.epiusers.help/t/unfirm-jobs-pulling-in-manufactured-material-parts-as-subassemblies/108503

### Release
- https://learning.sap.com/courses/manage-production-orders-in-sap-s-4hana-manufacturing/creating-production-orders-by-planned-order-conversion
- https://learning.sap.com/courses/manage-production-orders-in-sap-s-4hana-manufacturing/analyzing-master-data-selection
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d31d944af11d182b40000e829fbfe/content.htm
- https://help.sap.com/saphelp_46c/helpdata/EN/b1/c04108439a11d189410000e829fbbd/content.htm
- https://learning.sap.com/courses/automating-procurement-processes/creating-purchase-orders-from-purchase-requisitions-automatically_b8ef4a72-74ae-4236-8f5f-a64a2ee52658
- https://learn.microsoft.com/en-us/troubleshoot/dynamics-365/supply-chain/planning/bom-explosion-works-differently
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/planned-order-firming
- https://learn.microsoft.com/en-in/dynamics365/supply-chain/master-planning/planning-optimization/purchase-requisitions
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/approved-planned-order
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/marking
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/production-process-overview
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3872474232.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2403352.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_161945464537.html
- https://www.epiusers.help/t/10-1-600-mrp-and-jobs/41997
- https://www.epiusers.help/t/unfirm-jobs-with-no-demand-min-or-safety-stock/51049
- https://www.epiusers.help/t/where-do-the-firmed-jobs-go/132621
- https://www.epiusers.help/t/planning-workbench-new-exceptions-how-to-fix/88263
- https://www.epiusers.help/t/how-to-unfirm-a-job-in-job-entry/61901
- https://www.epiusers.help/t/cannot-firm-mrp-job/115820
- https://www.epiusers.help/t/mrp-and-unfirmed-jobs/45954

### Firming and time fences
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d30b644af11d182b40000e829fbfe/content.htm
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d2ca444af11d182b40000e829fbfe/content.htm
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d2c9744af11d182b40000e829fbfe/content.htm
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d320044af11d182b40000e829fbfe/content.htm
- https://learning.sap.com/courses/exploring-advanced-production-planning-with-sap-s-4hana-pp-ds/examining-additional-topics-in-production-planning-1
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-plans
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/keep-supply-for-confirmed-demand
- https://docs.oracle.com/cd/E18727_01/doc.121/e15188/T478564T479135.htm
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faspf/considerations-for-configuring-supply-plan-attributes.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25a/faspf/predefined-supply-planning-exceptions.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faurp/how-the-natural-time-fence-controls-the-creation-of-planned.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_3848105838.html
- https://www.epiusers.help/t/getting-change-suggestions-instead-of-new-suggestions/54306
- https://epiusers.help/t/mrp-suggestions-for-cancel-and-creating-unfirm/74719

### Netting segments and pegging
- https://learning.sap.com/courses/exploring-production-planning-in-sap-s-4hana/outlining-make-to-order-production
- https://help.sap.com/saphelp_me60/helpdata/en/03/83c1536ca9b54ce10000000a174cb4/content.htm
- https://help.sap.com/doc/b5cfb65334e6b54ce10000000a174cb4/2.6/en-US/b7ceb65334e6b54ce10000000a174cb4.html
- https://help.sap.com/doc/78f5c353b677b44ce10000000a174cb4/1610%20002/en-US/9df4c353b677b44ce10000000a174cb4.html
- https://help.sap.com/saphelp_46c/helpdata/en/d3/a51112e32311d1a6ab0000e83235d4/content.htm
- https://userapps.support.sap.com/sap/support/knowledge/en/3213460
- https://docs.oracle.com/cd/E26401_01/doc.122/e48795/T478564T479443.htm
- https://docs.oracle.com/cd/E26401_01/doc.122/e48955/T243813T243825.htm
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fausp/item-attributes-for-project-specific-supply-planning.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/fausp/examples-of-project-netting.html
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/make-to-order-supply-automation
- https://learn.microsoft.com/en-us/training/modules/create-bill-materials-dyn365-supply-chain-mgmt/3-line-type
- https://erpvideo.epicor.com/detail/videos/production-management/video/5804404888001/create-a-make-to-job-demand-link
- https://www.epiusers.help/t/two-make-direct-releases-on-1-job/43334

### Lead time, capacity, CTP and run mode
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d292344af11d182b40000e829fbfe/content.htm
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d297144af11d182b40000e829fbfe/content.htm
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f3/dbbb16b36111d1a6770000e83235d4/content.htm
- https://userapps.support.sap.com/sap/support/knowledge/en/2461479
- https://userapps.support.sap.com/sap/support/knowledge/en/3772905
- https://userapps.support.sap.com/sap/support/knowledge/en/2422602
- https://learning.sap.com/courses/exploring-the-capacity-planning-in-sap-s-4hana/evaluating-with-the-manage-work-center-capacity-app
- https://learning.sap.com/courses/exploring-production-planning-in-sap-s-4hana/introducing-predictive-mrp-pmrp-
- https://learning.sap.com/courses/exploring-production-planning-in-sap-s-4hana/executing-the-planning-run-in-sap-s-4hana
- https://help.sap.com/saphelp_SCM700_ehp01/helpdata/en/4c/56297de7c33a0de10000000a42189c/content.htm
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/safety-margins
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/finite-capacity
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/infinite-capacity-planning
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/calculate-delivery-dates-using-ctp
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/planning-optimization-fit-analysis
- https://learn.microsoft.com/en-us/dynamics365/release-plan/2023wave1/finance-operations/dynamics365-supply-chain-management/plan-manufacturing-planning-optimization
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/delay-tolerance
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-architecture
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2332170.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2301636.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162755810967.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3865354301.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159172025754.html
- https://support.katanamrp.com/en/articles/5914289-sales-item-availability
- https://www.epiusers.help/t/how-does-make-to-stock-unfirm-job-created-by-mrp-calculate-due-date/47184
- https://www.epiusers.help/t/capable-to-promise/89981
- https://www.epiusers.help/t/should-we-run-generate-po-suggestions-as-regenerative-each-night-if-no-why-not/45378

### BOM explosion details
- https://help.sap.com/doc/802eb853dcfcb44ce10000000a174cb4/1610%20002/en-US/6cb3bb536b13b44ce10000000a174cb4.html
- https://help.sap.com/saphelp_46c/helpdata/EN/ca/72d91b941b11d1801200c04fadcb73/content.htm
- https://help.sap.com/saphelp_46C/helpdata/EN/cb/7f945b43b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_46c/helpdata/EN/cb/7f946843b711d189410000e829fbbd/content.htm
- https://help.sap.com/saphelp_46c/helpdata/en/f4/7d28e244af11d182b40000e829fbfe/content.htm
- https://help.sap.com/doc/6297d7531a4d414de10000000a174cb4/1610%20002/en-US/d195d7531a4d414de10000000a174cb4.html
- https://learning.sap.com/courses/exploring-basic-data-for-manufacturing-and-product-management-in-sap-s-4hana/routing-scrap
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d2bd444af11d182b40000e829fbfe/content.htm
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d2b0444af11d182b40000e829fbfe/content.htm
- https://help.sap.com/SAPHelp_46c/helpdata/EN/f4/7d276944af11d182b40000e829fbfe/content.htm
- https://help.sap.com/saphelp_470/helpdata/en/ea/e9b3b74c7211d189520000e829fbbd/content.htm
- https://learn.microsoft.com/en-us/troubleshoot/dynamics-365/supply-chain/planning/planned-orders-created-for-phantom-products-master-planning
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/pim/product-configuration-models
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/pim/product-lifecycle
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/scrap-calculations
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/item-substitution
- https://www.microsoft.com/en-us/dynamics-365/blog/?p=25600
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4724775678.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_161486914160.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2324073.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2334515.html
- https://epiusers.help/t/phantoms-eli5/101210
- https://www.epiusers.help/t/mrp-and-scrap-qty/52516
- https://www.epiusers.help/t/linking-discontinued-parts-with-replacements/81425
- https://www.epiusers.help/t/can-mrp-use-future-revisions-for-future-demand/106462
