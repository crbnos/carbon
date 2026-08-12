# Labor vs Machine Capacity in Finite Scheduling: Best Practices Survey

## Summary

Surveyed how 14 systems across four tiers (enterprise ERP, dedicated APS, mid-market ERP, job-shop/SMB tools) model labor and machine availability as scheduling constraints — specifically operator-to-machine assignment vs skill pools, the machine-tending problem (small labor time on a long machine run; one operator running N machines), whether machine hours derive from operator shifts, and fallback behavior when labor isn't configured. Strong consensus: (1) machine = finite primary resource with its own calendar; (2) labor = a *pooled, skill-matched secondary constraint* consumed **per phase** (setup / run / fraction of run), never a hard operator→machine binding — dedicated-station assignment exists only as a *default/dispatch* layer on top of the pool; (3) machine calendars are never derived from operator shifts — staffing constrains through the labor resource, not by darkening the machine; (4) unconfigured labor is universally **infinite/invisible** (graceful degradation), with "informational/plot" modes as a stepping stone; finite-labor adoption is rare (Epicor: <5% of 30k installs ever get finite scheduling working). Carbon's current model (finite machines + qualified-pool-on-shift labor, operator held full op duration) is already ahead of everything below the APS tier; the two gaps vs best practice are full-duration operator holds and no assignment/dispatch layer.

## Competitors Surveyed

- **SAP S/4HANA (classic PP + PP/DS)** — enterprise reference; capacity categories, secondary resources, pool capacities
- **Siemens Opcenter APS (Preactor)** — APS reference for secondary constraints and phase-based labor usage
- **Asprova** — APS; sub-resources, fractional required quantity, internal/external setup
- **PlanetTogether** — APS; helper resources, multi-tasking resources, Attention Percent
- **Epicor (Kinetic/E10)** — mid-market; resource groups, people size, capabilities, adoption data
- **Infor VISUAL** — mid-market; concurrent resources with Setup/Run/Duration% — closest match to Carbon's target model
- **ECI JobBOSS² / E2 Shop System** — job shop; dispatching grids, machines-run-by-operator, unattended ops
- **ProShop ERP** — job shop; machine-hours scheduling + per-employee queues for support functions
- **Global Shop Solutions** — job shop; workcenter capacity + employee constraint management
- **Katana, MRPeasy, Odoo Manufacturing, Fulfil.io** — SMB tier; the "simplest shipped model" baseline
- **Schedlyzer, JobPack** — point APS corroboration

## Key Consensus Patterns

### 1. Labor is a pooled secondary constraint on the operation, not an operator→machine binding

- **SAP**: work center carries separate machine + labor **capacity categories** (each its own calendar and headcount); PP/DS models labor pools as **multi-activity resources** (capacity N) attached as **secondary resources** loaded simultaneously with the machine (primary). Pool capacities (CR11) are shared across many work centers. Person-to-work-center HR assignment exists but is *evaluative* (qualification checks, costing), not binding in scheduling.
- **Preactor/Opcenter**: machine = primary resource; labor = **secondary constraint** with pooled levels per calendar period; **Secondary Constraint Groups** pick a specific multi-skilled operator at schedule time with ranking.
- **PlanetTogether**: labor = **Helper Resources** matched by **Capability**; **Allowed Helpers** optionally restrict which people may serve a machine.
- **E2/JobBOSS²**: two grids on the work center — **Operator Dispatching Grid** (who *can* run it = pool) and **Shift Dispatching Grid** (default operator per shift = dedicated station as a *default*, not a constraint).
- **Rationale**: pools survive absences and shift swaps; hard bindings rot. Assignment layers exist to *restrict or default*, never as the only path to schedulability.

### 2. Machine tending is modeled as phase-based / fractional operator consumption

- **Infor VISUAL** (most explicit): operation's **Concurrent Resources** each carry a **Setup checkbox, Run checkbox, Duration %** ("used during half the run → 50"), and **At Start** (front-loaded) — a labor row with Setup✓ + fractional/zero run attendance while the machine row runs full duration.
- **Preactor**: **Constraint Usage** = which span consumes the operator (setup only, run, whole op, or spanning multiple ops); **Constraint Quantity** = how much of the pool.
- **Asprova**: sub-resource use instructions with capacity on **setup/teardown only** (internal setup) or fully offline (external setup); fractional **required resource quantity** (0.5 operator ⇒ one person tends two machines).
- **PlanetTogether**: **Multi-Tasking resource + Attention Percent** — concurrent operations' attention must sum ≤ 100%.
- **SAP**: separate standard values (machine time 60, labor time 5) load each capacity category independently; PP/DS attaches the operator secondary resource **to the setup activity only**. Man-machine ratio encoded in labor formulas (no first-class field).
- **Epicor** (the cautionary tale): **people size is costing-only**; a scheduling resource is "100% applied for the duration" — no fractional finite labor. Users fake it with Concurrent Capacity or fractional people sizes that some reports round back to 1.
- **Job-shop tier**: costing knobs only — E2's **Machines Run (By Operator)** divides labor cost, **Unattended Operation** drops run-labor cost; the schedule is untouched (JobBOSS's open feature request for "unmanned shifts" confirms the gap).

### 3. Machines own their calendars; staffing constrains via the labor resource, not by deriving machine hours

- Every system that constrains labor at all gives machines and people **independent calendars** (SAP per-capacity calendars — machine 3-shift, labor 1-shift; Preactor per-resource shift patterns; Asprova per-resource calendar + quantity per band; VISUAL per-resource weekly calendars + exceptions; Epicor plant/group/resource calendars).
- Nobody derives machine available-hours from assigned operators' shifts. The "unstaffed machine is dark" effect emerges from the **labor constraint binding** (no operator on shift ⇒ gated work can't start), which is exactly how Carbon already works. E2's one small coupling: a default shift operator's breaks reduce that work center's availability.

### 4. Unconfigured labor = infinite, with visibility modes as the on-ramp

- **SAP**: "Relevant to finite scheduling" unchecked by default per capacity; unmaintained labor is invisible to scheduling.
- **Preactor**: "Use as a Constraint" off ⇒ informational plots of labor demand; FCS mode treats secondary constraints as infinite and shows overload plots.
- **Asprova**: `[Not constrained]` sub-resource ⇒ labor demand computed and plotted, never delays.
- **Epicor**: resources default infinite; **<5% of ~30,000 installs successfully run finite scheduling** (Tomerlin-ERP via Epicor).
- **SMB tier**: labor *never* constrains (Katana operators = task assignees; MRPeasy assigns workers after scheduling "without considering workers' capacity"; Odoo Allowed Employees = eligibility + costing; Fulfil = clock-in costing). Vendor guidance when labor is the real bottleneck: **fold labor into the machine model** — "open only as many workstations as your average skilled headcount" (MRPeasy), set work-center capacity to staffed levels (Odoo community).
- **Rationale**: labor data is the first thing shops fail to maintain; a scheduler that stalls on missing labor config never gets adopted.

## Answers to Research Questions

1. **Pooled vs assigned?** Pooled + skill-matched everywhere; assignment is a default/restriction layer (E2 dispatch grids, PlanetTogether Allowed Helpers, Preactor constraint groups with ranking), never the schedulability mechanism. Carbon's chosen model (standing assignment that *restricts* the pool, fallback to pool) mirrors E2's two grids and PlanetTogether's Allowed Helpers.
2. **Machine tending?** Phase-based consumption is the consensus at the APS/VISUAL tier: operator held for **setup (+ load/tend labor) at the start**, machine held for the full duration; fractional attention (PlanetTogether/Asprova) is the generalization. Carbon's "setup + labor at start" window matches VISUAL's Setup✓ + front-loaded Duration% and Preactor's setup-usage.
3. **Machine hours from operator shifts?** No system does this. Machines keep their own (usually always-open or shift) calendars; staffing constrains through the labor resource. Carbon should keep machines always-open and let assigned-operator shifts constrain gated work — same architecture.
4. **Fallback when unassigned?** Infinite labor is the industry default; Carbon's fallback-to-qualified-pool is *stricter* than industry default and safe. The E2 rule "a work center with no operator assigned still gets scheduled" is the pattern: assignment optional, only ever restricting. A "visibility before constraint" mode (plot labor overload without delaying) is the industry on-ramp worth keeping in mind.
5. **Terminology?** "Attention percent" = PlanetTogether; "constraint usage" = Preactor; "people size" = Epicor **costing** (avoid — misleading); "concurrent resource / Duration %" = VISUAL; "sub resource" = Asprova; "secondary resource" = SAP PP/DS; "tended/unattended" = E2/ProShop. For Carbon: **"attended time"/"attended window"** for the operator hold, **"assigned operators"** for the work-center assignment.
6. **SMB baseline?** Work center calendar + capacity N; people recorded for assignment/costing but never constrain. Carbon already exceeds this tier.

## Competitor-Specific Details

### Infor VISUAL (closest existing implementation of Carbon's target)
Shop resources typed Work Center / Individual|Team / Group; per-resource per-shift capacity (blank = unlimited; "Schedule Normally" = finite opt-in). Operations take concurrent resources with Setup✓/Run✓/Duration%/At Start/#Members; Group resources have "Schedule One" (pool) vs "Schedule All" (people) and per-shift member re-picking. Consultant practice: finitely schedule only the bottleneck resource.

### E2/JobBOSS² (closest job-shop analog to Carbon's user base)
Work center capacity = calendar × Utilization% × Capacity Factor (# machines). Operator/Shift dispatching grids as pool/default layers. Multi-machine work centers (Capacity Factor > 1) **cannot** be finitely loaded — must be Infinite. Machines Run By Operator / Team Size / Unattended Operation are costing-only.

### SAP
Capacity categories per work center transfer to PP/DS as separate resources (`WC_PLANT_001` machine, `_002` labor). Finiteness per resource with "finiteness levels" letting different tools treat the same resource finitely/infinitely. Pool capacities shared across work centers.

### Epicor
OpDtl rows = simultaneous resource requirements (machine + labor rows both must have capacity). Setup vs production have separate people and separate primary resources. All-or-nothing resource allocation blocks fractional finite labor; Concurrent Capacity (max simultaneous ops per resource) is the workaround.

## Recommended Approach for Carbon

1. **Attended-window labor (Part A)**: reserve the operator for `setup + labor` at the start of the operation; reserve the machine for the full `setup + run`. If labor ≥ run, the operator is held throughout (current behavior degenerates out naturally). This is VISUAL's Setup/Run/front-loaded model and Preactor's setup-usage — the consensus pattern — and it makes one operator genuinely able to tend N machines with staggered starts, with zero schema change (`setupTime`/`laborTime`/`machineTime` already exist).
2. **Standing operator→work-center assignment (Part B)**: an employee may be assigned to a work center (durable default, reassignable from a board). Where assignments exist, the work center's labor pool = its assigned qualified people **and an assigned person leaves the pools of other work centers** (otherwise the "2 machines, 1 guy ⇒ everything queues on his machine" case doesn't materialize). Follows E2's Shift Dispatching Grid and PlanetTogether's Allowed Helpers as a *restriction layer*.
3. **Fallback**: a work center with no assignments uses the full qualified pool exactly as today (minus people assigned elsewhere). Never let missing assignment data stall scheduling — the <5% Epicor finite-adoption stat and the universal infinite-labor default are the strongest findings in this survey.
4. **Keep machine calendars independent** (always-open horizon now; a future maintenance/downtime calendar slots in without touching the labor model). Do not derive machine hours from operator shifts.
5. **Terminology**: "attended time" for the operator window; "assigned operators" on the work center. Avoid "people size."
6. **Future on-ramp** (not now): an informational mode that plots labor overload without delaying placements, mirroring Preactor/Asprova's `[Not constrained]` — useful if we ever add stricter labor constraints that shops need to grow into.

## Sources

### SAP
- https://help.sap.com/doc/saphelp_scm700_ehp02/7.0.2/en-US/e6/47c95360267614e10000000a174cb4/content.htm
- https://www.guru99.com/capacity-requirement-planning-sap-pp.html
- https://www.brightworkresearch.com/scm-resource-types/
- https://learning.sap.com/courses/exploring-advanced-production-planning-with-sap-s-4hana-pp-ds/exploring-concepts-and-principles-of-detailed-scheduling
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f899ce30af9044299d573ea30b533f1c/e77d5b580b9d9344e10000000a4450e5.html
- https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-model-the-labor-and-machine-capacity-in-work-center-and-to-have/qaq-p/11797274
- https://community.sap.com/t5/enterprise-resource-planning-q-a/use-of-capacity-relevant-to-finite-scheduling-tick-in-work-center/qaq-p/9777768
- https://community.sap.com/t5/supply-chain-management-q-a/ppds-planned-order-and-secondary-resource/qaq-p/12313202
- https://help.sap.com/docs/SAP_ADVANCED_PLANNING_AND_OPTIMIZATION,_ON_SAP_ERP/881e9c98c2e64900bc5ec58ce4b97939/cc4dc95360267614e10000000a174cb4.html
- https://www.learntosap.com/pptutorialpooledcapacity.html

### APS (Preactor, Asprova, PlanetTogether, point tools)
- https://docs.ufpr.br/~agnelo.vieira/Preactor/Preactor_Versao17_01_UserGuide.pdf
- https://lean-scheduling.com/products/preactor-advanced-planning-scheduling/preactor-advanced-scheduling/
- https://lib.asprova.com/en/e-learning/old-version-e-learning/12661-begginerslesson6.html
- https://asprova.net/scheduling-logic-resource-quantity/
- https://www.asprova.com/en/faq/use-instructions/
- https://www.planettogether.com/en/knowledge/multi-tasking-resources
- https://www.planettogether.com/knowledge/helper-resources
- https://optisol.biz/schedlyzer/
- https://jobpack.com/aerospace-manufacturing-scheduling-software/

### Epicor / Infor VISUAL
- https://www.epiusers.help/t/scheduling-multiple-resources-when-to-use-people-size-vs-machines/116744
- https://www.epiusers.help/t/aps-and-labor-scheduling/57930
- https://www.epiusers.help/t/scheduling-blocks-vs-people-size/50090
- https://www.epiusers.help/t/people-size-1-person-working-multiple-machines/80945
- https://www.epiusers.help/t/concurrent-capacity/65444
- https://usersolutions.com/blog/epicor-scheduling-gaps
- https://docs.infor.com/visual/11.x/en-us/useradminlist/VISUALMANUFACTURING.pdf
- https://f.hubspotusercontent30.net/hubfs/2623780/CSI%20Upgrade%20Information%20Links/Infor_ERP_VISUAL_Detailed%20Functionality_Version10%205-2021.pdf
- https://www.visualsouth.com/blog/advanced-planning-and-scheduling

### Job-shop tier
- https://client.shoptech.com/faq/Enterprise/Manuals/User_Guide.pdf
- https://ideas.jobboss.com/ideas/JBCORE-I-1385
- https://www.ecisolutions.com/products/jobboss2/features/scheduling/
- https://www.globalshopsolutions.com/blog/step-by-step-implementing-aps-in-your-manufacturing-operation
- https://globalshopsolutions.com.mx/wp-content/uploads/2020/09/How-to-Make-Your-Life-Easier-with-ERP-Scheduling-for-Manufacturing.pdf
- https://proshoperp.com/better-shop-floor-scheduling/
- https://proshoperp.com/blog/why-shops-experience-low-throughput-and-how-this-erp-can-help/

### SMB tier
- https://support.katanamrp.com/en/articles/5914350-managing-tasks-for-resources-and-operators
- https://support.katanamrp.com/en/articles/5967419-how-production-operations-resources-and-shop-floor-operators-are-related
- https://support.katanamrp.com/en/articles/5914341-managing-production-deadlines
- https://www.mrpeasy.com/resources/user-manual/settings/human-resources/users/planning/
- https://www.mrpeasy.com/resources/user-manual/production-planning/work-stations/details/
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/using_work_centers.html
- https://www.odoo.com/forum/mrp-14/manufacture-planning-based-on-employee-226220
- https://www.odoo.com/forum/help-1/using-cost-per-employee-and-employee-capacity-correctly-246016
- https://www.fulfil.io/products/manufacturing/
