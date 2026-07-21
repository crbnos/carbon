# Research: How Manufacturing ERPs Classify Routing Operations

Date: 2026-07-20
Question: Validate Carbon's consolidation to a single per-operation `operationType` enum — `Process` (in-house), `Assembly` (guided assembly w/ 3D instructions), `Inspection` (quality step), `Outside Processing` (subcontract) — against industry practice.

---

## SAP PP / QM (S/4HANA, ECC)

SAP puts **one field on every routing operation — the control key (STEUS)** — and that single field drives in-house vs external behavior, costing, confirmation, and inspection relevance. A control key is a named *profile of indicators*: scheduling, capacity planning, costing relevance, auto goods receipt, **external processing**, confirmation type (incl. milestone), print, and "inspection characteristics required" ([SAP Help: Control Key](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/efc7922405fd4d56b7571930c5eaa798/90a1b8535c39b44ce10000000a174cb4.html); [SAP Community: control key indicators](https://community.sap.com/t5/enterprise-resource-planning-q-a/operation-control-key/qaq-p/7090989)).

Standard values:
- **PP01 — in-house production**: operation is scheduled, capacity-planned, costed, confirmed; no auto-GR ([SAP Community](https://community.sap.com/t5/enterprise-resource-planning-q-a/control-key-in-pp/qaq-p/8095872)).
- **PP02 — external processing**: flags the op as externally procured; requires a purchasing info record; the system **creates a purchase requisition when the production order is created/released**, and goods receipt against the resulting PO sets the operation status to EODL (externally delivered) — no shop-floor confirmation needed ([SAP Community: PP02](https://community.sap.com/t5/enterprise-resource-planning-q-a/control-key-pp02-external-processing/qaq-p/5902949); [PReq on release](https://community.sap.com/t5/enterprise-resource-planning-q-a/routing-and-externally-process-and-purchase-requisition/qaq-p/5678180)).
- **PP03 — in-house with auto goods receipt** on confirmation ([Guru99: SAP Routing](https://www.guru99.com/create-change-routing-sap-pp.html)).
- **QM01 — inspection operation** ("inspection characteristics required" set by default), used in inspection plans/task lists ([SAP Community: QM01](https://community.sap.com/t5/enterprise-resource-planning-q-a/sap-qm-control-key/qaq-p/5276394)).
- **Milestone confirmation** is a *confirmation-type setting inside* the control key: confirming a milestone op auto-confirms all prior operations ([unogeeks: milestone confirmation](https://unogeeks.com/milestone-confirmation-in-sap-pp/)).

In production routings, inspection is usually **attached to an operation** (in-process inspection characteristics on any op), not a distinct op type; dedicated inspection *operations* exist in QM inspection plans via QM* control keys. So SAP's answer to "one field or orthogonal flags?" is **both**: one field on the operation, whose *semantics* are a bundle of orthogonal indicators. Users can define custom control keys (Z*) without code changes — extensibility lives in configuration.

## Oracle Fusion Cloud Manufacturing

The closest match to Carbon's design. Work definition / standard operations carry an explicit **Operation Type enum: `In-House` or `Supplier`** (default In-House); REST payloads use `IN_HOUSE` / `SUPPLIER` ([Create a Standard Operation](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/faumf/create-a-standard-operation.html); [REST: work order operation](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/fasrp/op-maintenanceworkorders-workorderid-child-workorderoperation-wooperationid-patch.html)). Behavior branches on the enum: if In-House, the Supplier/Supplier Site/lead-time attributes "aren't collected"; if Supplier, you must specify an **outside-processing (OSP) item** (the value-added service as a product) and a supplier, and POs/receipts drive the operation ([Work orders with supplier operations](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faims/how-you-create-and-manage-work-orders-with-supplier-operations.html); [Plan OSP operations](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24b/fausp/plan-outside-processing-operations.html)). Oracle's feature name is **"Outside Processing (OSP)"** ([Outside Processing Services](https://docs.oracle.com/en/cloud/saas/supply-chain-management/21b/famli/outside-processing-services.html)).

Orthogonal to the type enum, each operation is a **Count point / Automatically transact / Optional** operation (mutually exclusive reporting attributes). **Inspection is not an operation type**: quality inspection plans are attached at the operation level and enforced as inline WIP inspection — completion is blocked until the prescribed samples are inspected ([Perform Inline Inspections](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faumf/perform-inline-inspections.html); [inline WIP inspection REST use case](https://docs.oracle.com/en/cloud/saas/supply-chain-management/22c/fasrp/use_case_perform_inline_work_in_process_inspection.html)).

Legacy contrast: classic **Oracle EBS WIP** had no operation-type enum — OSP was a *resource* with autocharge type PO Move/PO Receipt assigned to an operation, plus count-point/autocharge flags ([Oracle WIP: Overview of Routings and Operations](https://docs.oracle.com/cd/A60725_05/html/comnls/us/wip/ovwopctl.htm)). Fusion's move to a per-operation enum is a deliberate simplification. **JD Edwards** likewise flags outside operations on the work-order routing and generates POs per outside step (P3112, `*OP` service items) ([JDE: Understanding Outside Operations](https://docs.oracle.com/en/applications/jd-edwards/supply-chain-manufacturing/9.2/eoash/understanding-outside-operations.html)).

## NetSuite (Advanced Manufacturing)

Manufacturing routings are sequences of operation tasks; for subcontracted steps you **insert an outside-processing operation** carrying a vendor, lead time, cost driver, and an attached service item that captures the vendor charge; WIP ships to the vendor location and the vendor bill rolls into WIP/FG cost ([NetSuite: Manufacturing Routing and Work Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2346224.html); [NetSuite: Outsourced Manufacturing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_157833700001.html); [RSM walkthrough](https://technologyblog.rsmus.com/technologies/netsuite/netsuite-outsourced-manufacturing-starting-from-the-po-or-work-order/)). Terminology mixes "outsourced manufacturing" (feature) and "outside processing" (the routing step).

## Epicor Kinetic

Job/part routings distinguish plain operations from **"subcontract operations" — "a special type of operation"** added explicitly (Job Entry → Add Subcontract Operation) with a Supplier and unit price; job cost is broken into material / labor / burden / **subcontract** buckets; PO lines are created with **Buy For = Subcontract Operation**, and supplier price lists exist per subcontract operation ([epiusers: subcontract operations](https://www.epiusers.help/t/subcontract-operations-for-job-material/106830); [epiusers: subcontract price list](https://www.epiusers.help/t/subcontract-operation-price-list/76284); [job costing categories](https://scaledsolutionsgroup.com/how-to-use-epicor-kinetic-for-accurate-job-costing-and-margin-analysis/)). **Inspection is an attribute, not a type**: attaching an inspection plan to an operation auto-selects its "Inspection Required" checkbox for in-process inspection ([Epicor Community: Inspection Required](https://community.epicorusers.org/kinetic-epicor-erp-81/inspection-required-87136); [Tomerlin: Enhanced Quality Assurance](https://tomerlin-erp.com/epicor-enhanced-quality-assurance/)).

## Infor SyteLine / CloudSuite Industrial

Explicit per-operation classification: on the routing you **"set the operation type to Outside Process"** (stored in the routing table's `op_type` column), backed by a work center of **type Outside Process (O)** holding the default vendor and cost; a "Generate Outside Process POs" utility batch-creates POs for released jobs with pending outside-process operations ([Netray: How to Configure Outside Processing](https://www.netray.co/resources/how-to-configure-syteline-outside-processing); [Netray: OSP setup](https://www.netray.co/resources/syteline-outside-processing-setup)). Sage X3 similarly types the *work center* (machine / labor / subcontract) ([Sage X3 routing management](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESROU.htm)).

## Microsoft Dynamics 365

**No operation-type enum.** In D365 Supply Chain Management a subcontracted route operation is one whose costing resource/resource requirement points to a **resource of type `Vendor`**, paired with a **BOM line of type `Vendor`** carrying a service product allocated to that operation; estimating the production order creates the PO ([Microsoft Learn: Manage subcontracting work in production](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/manage-subcontract-work-production)). Lean manufacturing has a second model ("activity-based subcontracting", Direct outsourcing cost group) ([Microsoft Learn: activity-based subcontracting](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/activity-based-subcontracting)). Practitioners find the resource-indirection model harder to reason about than an explicit flag — the classification is smeared across resource, BOM line, and service item.

## Job shop software: Fulcrum, JobBOSS²/E2

- **Fulcrum** treats **"outside processing operations"** as a first-class routing-step kind: OSP steps appear alongside material and internal steps in the BOM/routing builder, show their linked POs in the job operations drill-down, and support continuous flow (ship partials to the vendor) ([Fulcrum: PO info on outside processing operations](https://fulcrumpro.com/product-update/po-info-on-outside-processing-operations); [continuous flow on OSP operations](https://fulcrumpro.com/product-update/continuous-flow-on-outside-processing-operations)).
- **JobBOSS² / E2** (ECI) uses **"outside services"** as the job-shop term — estimating pre-sets Outside Services alongside labor/burden rates, and outside services carry vendors and lead times for scheduling ([JobBOSS² estimating](https://jobboss.com/job-shop-manufacturing-software/jobboss2/quote-processing-software-for-manufacturing); [JobBOSS² scheduling blog](https://www.ecisolutions.com/blog/manufacturing/jobboss2/common-roadblocks-to-implementing-the-scheduling-module-in-jobboss2/)).

## MES / work instructions: is "Assembly" ever an operation type?

**No vendor surveyed classifies routing operations as "Assembly."** Assembly guidance is delivered as *content attached to an operation*, not as an operation taxonomy:
- **Tulip**: routings order tasks/procedures; work instructions are apps attached to steps, with in-line quality inspection steps and poka-yoke inside the workflow ([Tulip: digital work instructions](https://tulip.co/digital-guidance/digital-work-instructions/); [Tulip: work instructions use case](https://support.tulip.co/docs/digital-work-instructions-use-case)). VKS and Poka are positioned the same way (work-instruction platforms layered on process steps).
- **iBase-t Solumina** (aerospace assembly MES): operations carry work instructions with 3D model animations plus **buyoff points** — operator/inspector "stamps" recorded per unit; inspectors can raise discrepancies directly from a buyoff — i.e., inspection is an *embedded hold point on an operation*, per AS9100 practice ([iBase-t MES](https://www.ibaset.com/solutions/manufacturing-execution-system); [Solumina MES brochure](https://www.ibaset.com/wp-content/uploads/iBase-t-Solumina-MES-Brochure_v1.pdf)).
- **Siemens Opcenter Execution** Discrete/Electronics: "complex assembly" is a *market segment*; execution guides operators with electronic work instructions (EWI) and step validation attached to operations ([Opcenter Execution](https://www.siemens.com/en-us/products/opcenter/execution/); [Opcenter Execution Electronics](https://www.siemens.com/en-us/products/opcenter/execution/electronics/)).

Standards note: **ISA-95** classifies Level-3 operations into four categories — **production, quality, inventory, maintenance** — one categorical axis, with the same activity model applied to each. Treating a quality step as a first-class operation category has standards backing ([Rhize: What is ISA-95](https://rhize.com/blog/what-is-isa95/); [Symestic: MOM per ISA-95](https://www.symestic.com/en-us/what-is/manufacturing-operations-management)).

---

## Comparison table

| System | Classification mechanism | In-house label | Subcontract label | Inspection | PO link for external ops |
|---|---|---|---|---|---|
| SAP PP | One field (control key) = named profile of indicators | "In-house production" (PP01) | **"External processing"** (PP02) | Indicator ("insp. char. required") / QM ops in inspection plans | PReq auto-created at order create/release |
| Oracle Fusion | **Per-op enum `Operation Type`** | **In-House** (default) | **Supplier** ("Outside Processing"/OSP feature) | Inspection plans attached to any op (inline WIP) | OSP item + auto PO/receipt |
| Oracle EBS (legacy) | Orthogonal flags + OSP *resource* | count-point/autocharge ops | OSP resource (PO Move/PO Receipt) | Quality plans at ops | PO via OSP resource charge |
| JD Edwards | Outside-op flag on routing step | — | "Outside operation" | — | P3112 POs, `*OP` items |
| NetSuite | Step kind inserted in routing | operation task | "Outside processing" op / outsourced mfg | — | Service item + vendor PO/bill |
| Epicor Kinetic | Operation vs **subcontract operation** (special type) | "Operation" | **"Subcontract operation"** | "Inspection Required" checkbox + plans on any op | PO "Buy For: Subcontract Operation" |
| Infor SyteLine | **Per-op `op_type`** + work center type | (standard op) | **"Outside Process"** | — | Generate Outside Process POs utility |
| D365 SCM | No enum — Vendor-type resource + Vendor BOM line | (default) | "Subcontracting" | — | PO created at order estimation |
| Fulcrum | Step kind in routing | (internal op) | **"Outside processing operation"** | — | PO shown on OSP op |
| JobBOSS²/E2 | Estimating/routing line kind | (labor step) | **"Outside service"** | — | Vendor + lead time on service |
| Tulip / Solumina / Opcenter (MES) | No op taxonomy — instructions attached | — | — | Inline inspection steps / buyoff hold points | — |
| ISA-95 | Single category axis | Production | — | **Quality** (first-class category) | — |

## Naming findings

- **"Outside Processing" is the dominant modern term** (Oracle Fusion OSP, NetSuite, Infor "Outside Process", Fulcrum, legacy Oracle/JDE "outside operation"). SAP alone says "external processing"; Epicor/D365/Sage say "subcontract"; small job shops say "outside service." Carbon's `Outside Processing` matches the largest cluster and the term buyers see in Oracle/NetSuite/Fulcrum docs.
- **No precedent for "Process" as the in-house label.** Oracle uses **In-House**; SAP "in-house production"; others leave the default unnamed ("operation", "standard"). "Process" is not wrong (Tulip/lean literature uses "process step"; D365 lean calls internal activities "process activities"), but In-House / Standard / Production are the attested labels.
- **No precedent for "Assembly" as an operation type** in any ERP or MES surveyed — assembly is a work-instruction/content concern (Tulip, VKS, Solumina 3D instructions, Opcenter EWI) attached to ordinary operations.
- **Inspection as a step**: attested both as dedicated operations (SAP QM01 inspection-plan operations; shops adding inspection ops to routings; Solumina buyoff/hold points) and as an attribute on any operation (Epicor checkbox, Oracle inline plans, SAP in-process characteristics). ISA-95 legitimizes "quality" as a peer category of "production."

## Implications for Carbon

1. **A single per-operation enum is the modern pattern.** Oracle Fusion (In-House|Supplier) and Infor (`op_type` = Outside Process) do exactly what Carbon proposes; both are simplifications of older orthogonal-flag models (EBS resources, D365 vendor-resource indirection) that practitioners found opaque. Oracle's docs even describe behavior as "if operation type is In-House, supplier attributes aren't collected" — the same branch shape as `operationType !== 'Outside Processing'`.
2. **The in-house/outside boundary is the load-bearing distinction everywhere**: it decides PO generation, costing bucket (subcontract vs labor/overhead), scheduling by lead time vs capacity, and completion by receipt vs confirmation. Every vendor hard-wires exactly one binary: external or not. Writing all logic against `!== 'Outside Processing'` mirrors that and keeps the in-house side open for new values — SAP achieves the same openness via custom control keys whose *indicators* (not names) drive behavior; the lesson is to branch on the one semantic that matters (external), never on exhaustive lists of in-house types.
3. **`Inspection` as a type is defensible but ahead of ERP practice.** ERPs model inspection as plans/flags attachable to *any* operation (Epicor, Oracle, SAP in-process); dedicated inspection steps are nonetheless common practice (SAP QM ops, aerospace hold points/buyoffs, ISA-95 quality category). Expect users to eventually want inspection *characteristics on non-inspection operations* too; the type should mean "this step exists to inspect," not "only here can inspection happen."
4. **`Assembly` as a type is a Carbon-specific choice with no competitor precedent** — competitors attach 3D/guided instructions to ordinary operations. It is safe under the extensibility rule (it behaves in-house), but expect the same evolution: guided-instruction content may later be wanted on `Process` ops; keep the 3D-instruction machinery attachable rather than hard-bound to the type.
5. **Naming**: `Outside Processing` — strongly validated. `Inspection` — validated (universal term). `Assembly` — novel but clear. `Process` — the only weakly-attested label; Oracle's `In-House` names the semantic the code branches on, while `Process`/`Standard` names the default work kind. If renaming is cheap, "Standard"/"In-House" have more precedent; if not, "Process" has no conflict with any competitor term.

### Sources (primary)
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/faumf/create-a-standard-operation.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faims/how-you-create-and-manage-work-orders-with-supplier-operations.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faumf/perform-inline-inspections.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/efc7922405fd4d56b7571930c5eaa798/90a1b8535c39b44ce10000000a174cb4.html
- https://community.sap.com/t5/enterprise-resource-planning-q-a/control-key-pp02-external-processing/qaq-p/5902949
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/manage-subcontract-work-production
- https://www.netray.co/resources/how-to-configure-syteline-outside-processing
- https://docs.oracle.com/en/applications/jd-edwards/supply-chain-manufacturing/9.2/eoash/understanding-outside-operations.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_157833700001.html
- https://www.epiusers.help/t/subcontract-operations-for-job-material/106830
- https://fulcrumpro.com/product-update/po-info-on-outside-processing-operations
- https://www.ibaset.com/solutions/manufacturing-execution-system
- https://tulip.co/digital-guidance/digital-work-instructions/
- https://rhize.com/blog/what-is-isa95/
