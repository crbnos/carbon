# Job Operation Batching Research: Best Practices Survey

> Researched: 2026-07-03 · For spec: `.ai/specs/2026-07-03-job-operation-batching.md`
> Question: how do best-in-class systems model batch processing of operations across
> work orders — where does "batchable" live, how are batches planned (material-property
> filtering), and how do time/cost/output fan back out to member orders?

## Summary

Surveyed SAP (PP, PP/DS, PP-PI, Digital Manufacturing), APS tools (Siemens Opcenter
APS/Preactor, PlanetTogether, Asprova, frePPLe), and sheet-metal/job-shop systems
(Fulcrum, SigmaNEST, ProNest, Lantek, Epicor Kinetic/NestLink, JobBOSS², STRUMIS,
Tekla PowerFab). Three findings are unanimous: (1) **batch capability is a property of
the resource/machine** — a furnace, oven, tank, or laser table can run several orders'
operations simultaneously; a brake press cannot — while compatibility criteria come
from the operation/material; (2) grouping happens at the **operation** level, never by
merging orders; (3) allocation back to member orders is **proportional** (by quantity
or area), never even. In sheet metal, "filter by material grade + thickness + machine,
then group across work orders" is the standard planner workflow in every product.
The academic literature calls this a **batch processing machine** ("parallel batch
scheduling", the "Oven Scheduling Problem").

## Competitors Surveyed

- **SAP S/4HANA (PP, PP/DS, PP-PI, Digital Manufacturing)** — enterprise reference: Order Combination, multi-activity resources, campaigns, process lots
- **Siemens Opcenter APS (Preactor), PlanetTogether, Asprova, frePPLe** — APS tools with first-class batch-resource concepts
- **Fulcrum, SigmaNEST, ProNest, Lantek, Epicor Kinetic + NestLink, JobBOSS², STRUMIS, Tekla PowerFab** — job-shop/sheet-metal systems where cross-order nesting is the daily workflow

## Key Consensus Patterns

### 1. Batch capability is modeled on the resource/machine, not the part

- **SAP PP/DS**: resource master's category — *multi-activity resource* runs several orders' activities concurrently; *single-activity* is loaded-or-idle. ECC work-center capacity header has "number of individual capacities" + "can be used by several operations".
- **PlanetTogether**: resource Capacity Type (Single-Tasking vs Multi-Tasking), plus resource-level Operation Batching (Batch Type by Percent/Volume, "Batch Volume" = max units per batch).
- **Asprova**: resource class "Furnace resource" — "multiple operations start and finish at the same time".
- **Critical Manufacturing MES**: batch limits sit on the equipment; compatibility on the recipe.
- **Rationale**: the machine's physics determines simultaneity. Parts/orders only determine *which* operations are compatible within a batch — via attributes (PlanetTogether "Batch Code", Asprova spec values, SAP classification characteristics).

### 2. Grouping is operation-level; orders are never merged

- **SAP Order Combination** (Mill Products/DIMP; S/4HANA Cloud "Combined Production Orders"): combines the *identical operation sequence* of several orders into a combined order; orders diverge again downstream. SAP DM **process lots** group SFCs from different shop orders at the same operation/resource and complete them as one unit.
- **Fulcrum**: "work is grouped together into a single operation in Job Tracking" — its Grouped Work & Nesting is explicitly operation-level.
- **Odoo-style order merging** destroys order identity and is the anti-pattern (confirmed in the prior research pass, 2026-07-02).

### 3. Planner workflow: filter by material + thickness + machine, then group

- **Fulcrum**: nest suggestions grouped by material, machine type, schedule; planner filters by material, thickness, due date.
- **SigmaNEST**: parts auto-sorted "into tasks by material and machine"; work orders sync with material + due date.
- **Lantek**: sub-jobs keyed "Machine – Material – Thickness"; MES collates parts by material type, thickness, delivery date.
- **JobBOSS²**: nesting candidates selected by "scheduled date, due date, work center, material thickness".
- **STRUMIS**: Multi-Contract Nesting matches on section size, grade, thickness.
- **Rationale**: nesting best practice — same material and thickness must share a sheet; the ERP's job is to make that filter cheap.

### 4. Fan-out to member orders is proportional, never even

- **SAP Order Combination**: confirmation posts on the combined order; "Quantity Distribution" fans yield back **pro-rata to order quantities** (manual override when yield differs); costs settle back quantity-proportionally.
- **CADTALK (nesting↔ERP)**: scrap/material amortized by "weighted ratio — big parts take a bigger hit"; per-part machine time comes from the nesting software's computed per-part cut time.
- **Fulcrum**: "proportionately allocates machine time and material costs to individual parts".
- **SAP DM process lots**: each SFC reports yield/time to its own order pro-rata to SFC quantity.
- (Exception proving the rule: SAP campaign *setup/clean-out* orders distribute evenly — but that is a sequential-campaign changeover cost, not a shared simultaneous run.)

### 5. Material consumption follows each order's own BOM

- **SigmaNEST/ProNest/NestLink**: after the nest, actual material usage per part is written back and issued to each job/shop order; the cutting operation on each routing is closed. The whole sheet is issued to the run; remnants return to inventory.
- No product even-splits a raw consumption number across dissimilar jobs.

### 6. Batch building UX: solver-driven in APS, manual pick/drag in MES

- APS engines auto-group compatible operations (Opcenter "operation aggregation"/campaigning, PlanetTogether batch codes, Asprova spec matching); manual control is via the interactive Gantt.
- The manual batch composer precedent is MES: Critical Manufacturing offers "batch group creation and dissolution", visibility into loaded vs waiting, and running at reduced capacity when too few compatible orders exist. Epicor shops without tooling suffer: "a single operator would have to sign in and out of every single one of the 200 jobs" on one nest.

## Answers to Research Questions

1. **Where does batchability attach?** The resource/process (SAP multi-activity resource, PlanetTogether Capacity Type, Asprova Furnace resource class). Compatibility attributes attach to the operation/material.
2. **Grouping keys for nesting?** Material (grade) + thickness + machine are the hard keys everywhere; sheet size chosen afterward from inventory; due date is the soft key.
3. **Industry terminology?** "Nest" (the sheet program), "grouped work" (Fulcrum), "Job Batching"/"nesting batches" (Epicor), "combined order" (SAP), "process lot" (SAP DM), "batch processing machine" (academic). "Batch" is well-supported — but every vendor also carries the batch-as-material-lot collision (SAP Batch Management = lot numbering) and lives with it.
4. **Time/cost attribution?** Proportional to quantity (SAP quantity distribution, DM process lots) or to area/cut time (nesting integrations). Never even.
5. **Completion mechanics?** One confirmation on the shared run fans out per member order (SAP combined order confirmation; DM process-lot completion applies to every member SFC; Fulcrum one-click confirm per parts).
6. **Planner UX precedent for attribute-filtered batch building?** Filter-then-group is universal in sheet metal (§3); a drag/pick composer is an MES-side pattern (Critical Manufacturing), not an APS one — APS auto-groups.

## Competitor-Specific Details

### SAP
- Order Combination uses a **reference order** for master data/scheduling; goods receipt still posts per original order — member identity is never lost.
- Terminology collision handled by context: "Batch Management" (= material lots/charges) is unrelated to order batching; docs simply coexist.

### PlanetTogether
- "Only operations with the same batch code will schedule together in the same batch"; Batch Type by Percent (each op's share = Required Finish Qty / Qty Per Cycle) or by Volume.

### Fulcrum
- Does not nest natively: exports DXFs to nesting software, re-imports the nest PDF, extracts per-part material usage + machine time, creates and schedules a nesting work order automatically; operators one-click confirm parts and remnants.

### frePPLe / just plan it
- Documented gap: default resources with size > 1 allow overlap but no compatibility key and no synchronized start/finish — the "cheap" model to avoid copying.

## Recommended Approach for Carbon

1. **`process.batchable` boolean** on the process master (SAP resource-category / Asprova furnace-class pattern): job operations are batchable iff their process is batchable. No per-item, per-method-operation, or per-job flags.
2. **Operation-level batch entity** over real job operations (SAP Order Combination / DM process-lot pattern): jobs keep their identity; only the shared operation is grouped; downstream operations untouched.
3. **Filter-then-drag batch planning board** keyed by process + work center + material form/substance/grade/dimension (the SigmaNEST/Lantek/Fulcrum planner workflow), with manual drag-into-batch composition (Critical Manufacturing MES pattern) — Carbon is the planner's manual tool in v1; solver suggestions are a v2.
4. **Proportional fan-out** of shared run time/cost by member operation quantity (SAP quantity-distribution pattern); material consumption issued per member job's own BOM (nesting write-back pattern); produced quantity entered per member, not split from one number.
5. **No batch size cap** — no surveyed system caps member count; capacity is a physical property (v2: real capacity/volume modeling à la PlanetTogether Batch Volume).
6. Keep lot-tracking "batch" and operation-batch terminology explicitly distinguished in docs/UI copy (the SAP coexistence pattern).

## Sources

- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/5e23dc8fe9be4fd496f8ab556667ea05/09ccd8530439414de10000000a174cb4.html
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/combined-production-orders-in-sap-s-4hana-cloud-public-edition/ba-p/14397369
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/combined-production-order-processing-dimp/ba-p/13266644
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/c7894a248ca14f74aca67f97528e5ad7/6b1bbf53d25ab64ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/34de0103497c4b80a7c7fbf6952ff971/1cda81ceef6c4e7f8f2b6f41af400ac0.html
- https://help.sap.com/saphelp_SCM700_ehp02/helpdata/en/76/35c95360267614e10000000a174cb4/content.htm
- https://help.sap.com/docs/SAP_ERP/698b19fa88b846359bc611f11184c810/6f80bf53f106b44ce10000000a174cb4.html
- https://help.sap.com/saphelp_scm700_ehp02/helpdata/en/e6/47c95360267614e10000000a174cb4/content.htm
- https://community.sap.com/t5/product-lifecycle-management-blog-posts-by-sap/configure-and-use-process-lots-in-sap-digital-manufacturing/ba-p/13553892
- https://blogs.sw.siemens.com/opcenter/available-now-opcenter-aps-18-3/
- https://www.siemens.com/en-us/products/opcenter/advanced-planning-scheduling-aps/advanced-scheduling-software/
- https://lean-scheduling.com/watch-oven-furnace-scheduling-with-opcenter-aps-preactor/
- https://www.planettogether.com/en/knowledge/batching
- https://www.planettogether.com/en/knowledge/resource-options
- https://asprova.net/furnace-resource/
- https://frepple.com/docs/current/model-reference/resources.php
- https://www.criticalmanufacturing.com/blog/how-mes-supports-advanced-scenarios-in-semiconductor-batching/
- https://fulcrumpro.com/manufacturing-software/grouped-work-and-nesting
- https://fulcrumpro.com/product-update/nesting-work-orders---looking-for-beta-users
- https://sigmanest.com/nesting-software/work-order-basics
- https://mie-solutions.com/sigmanest-mie-trak-software-integration/
- https://www.hypertherm.com/products/software/pronest-optional-modules/
- https://www.hypertherm.com/resources/more-resources/blogs/pronest-and-tekla-powerfab-integration/
- https://cadtalk.com/the-value-of-nesting-integration-with-erp-system/
- https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/nestlink/
- https://www.epiusers.help/t/job-batching-nesting-sheet-parts-for-cnc/124778
- https://customers.jobboss.com/nesting-integration
- https://strumis.com/steel-fabrication-nesting-software-strumis
- https://fabricatingandmetalworking.com/lantek-nesting-by-attribute-v45-upgrade/
- https://link.springer.com/article/10.1007/s10601-023-09347-2
- https://arxiv.org/pdf/2410.11981
