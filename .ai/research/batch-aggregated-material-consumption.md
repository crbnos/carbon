# Batch Aggregated Material Consumption Research: Best Practices Survey

> Researched: 2026-09-15 · Prompted by: vertical-farming customer use cases
> (`Work_Order_Stitching_Use_Cases.pdf` + the harvest-merge cases) — "pick the
> material ONCE for a batch run spanning N jobs" (64 ml chemical, 6,500 seeds, 2 tray
> lots) instead of N per-job issues.
> Complements: `.ai/research/job-operation-batching.md` (composition/costing — its §5
> established "consumption follows each order's own BOM") and
> `.ai/research/batch-output-lot-identity.md` (2026-08-27 — the OUTPUT-lot half of the
> same customer ask; single shared output lot = same-material, deliberate-act special
> case). This file covers only the INPUT side: the aggregated pick/issue.

## Summary

Surveyed SAP (PP-PI campaigns, collective orders, Mill Order Combination, SAP DM
process lots, EWM cross-order staging, batch where-used), Fulcrum, Steelhead,
nesting write-back (SigmaNEST/ProNest), process ERPs (BatchMaster, Deacom, Aptean
Ross), and pharma campaign weighing. Every system that supports cross-order runs
converges on one model: **the physical pick is aggregated at the run-level entity
(work order / load / nest / campaign / combined order), while per-member attribution
is derived** — either as per-order ledger postings from the shared pick (SAP EWM
staging, pharma campaign weighing) or as a costing/settlement-time allocation
(Fulcrum bounding-box, SAP MILL_OC quantity distribution). No system makes the
operator perform N picks, and no system loses per-order lot genealogy: one input
batch consumed by N orders is recorded as N consumption postings referencing the
same batch number. SAP's *default* (PP-PI campaign) aggregates only fixed
setup/clean-out costs and keeps variable consumption per order; its true
aggregate-then-split pattern (MILL_OC) exists but does it on a synthetic combined
order settled back to the originals — the shape Carbon's spec already rejected
(jobs are never merged).

## Competitors Surveyed

- **SAP** (PP-PI production campaigns, collective orders, Mill Order Combination /
  Combined Production Orders, SAP DM process lots, EWM cross-order staging) —
  enterprise reference; MILL_OC is the closest analog to combining N orders into
  one execution
- **Fulcrum** — job-shop MES; its grouped work orders "pick once" with automatic
  cost allocation is the strongest direct match for the ask
- **Steelhead Technologies** — plating MES; racks/loads span orders and customers
  daily; consumables consumed at tank/load level
- **SigmaNEST / ProNest** — nesting write-back: the program owns the sheet issue
- **BatchMaster / Deacom / Aptean Ross** — process-manufacturing ERPs (campaign /
  super batch concepts)
- **Pharma MES (BatchLine, LZ Lifescience)** — "campaign weighing/dispensing", the
  cleanest process-industry analog for the aggregated seed/chemical pick

## Key Consensus Patterns

### 1. One physical pick, owned by the run-level entity

- **Fulcrum**: "Material items will now be picked once to the work order, creating
  a single clean pick transaction."
- **SAP EWM cross-order staging**: open quantities of multiple Production Material
  Requests are summed into one consolidated requirement and staged to the
  Production Supply Area in one picking stream.
- **Pharma campaign weighing**: select the material once, list the batches that
  need it, weigh for all of them in one session.
- **SigmaNEST/ProNest**: the whole sheet is issued to the nest program; remnants
  return to inventory.
- **Rationale**: the operator's action mirrors the physical act — one lot comes off
  the shelf once.

### 2. Attribution back to members is derived, and the ledger stays per order in the mainstream pattern

- **SAP EWM staging**: consumption (261 goods issue) still posts **per order**
  against each order's reservation, from the shared staged stock. Aggregate the
  pick, keep the ledger per order.
- **Pharma campaign weighing**: each batch's quantity is recorded separately in the
  session, so genealogy stays per batch.
- **Fulcrum**: the single pick transaction is allocated across jobs **at costing
  time**, proportional to each job's bounding box (per-item "lock" for fixed
  quantities).
- **SAP MILL_OC**: goods issue posts once against the synthetic combined order;
  costs settle back to the original orders via Quantity Distribution at final
  confirmation (exit-overridable ratios).
- **Rationale**: per-order costing and genealogy are non-negotiable; only the
  *when* of the split differs (issue time vs costing/settlement time).

### 3. SAP's default aggregates fixed costs only, never variable consumption

- **PP-PI campaigns** are a scheduling/costing bracket: member process orders keep
  their own reservations and their own goods issues. Dedicated setup/clean-out
  orders distribute **fixed** campaign costs across members by rule; variable
  material cost is never aggregated.
- **SAP DM process lots** group SFCs for collective Start/Complete, but component
  consumption is recorded per SFC and flows back per each SFC's own order.
- **Rationale**: aggregation is an execution/UI convenience; the accounting model
  stays per order unless you opt into the synthetic-order pattern (MILL_OC).

### 4. Lot genealogy: N postings referencing the same input batch

- **SAP batch where-used (MB56)**: one batch consumed by N orders = N material
  documents, same batch number, each with its own order; the where-used tree just
  shows N branches. Granularity is order-level.
- **BatchMaster**: lots allocated per batch job by expiry/rotation → per-batch
  genealogy.
- **Rationale**: "one physical movement" and "N traceability records" are not in
  tension anywhere in the industry.

## Answers to Research Questions

1. **One aggregated issue split system-side, or N issues?** — Mainstream (SAP EWM
   staging, pharma, SAP DM): aggregate the *pick*, post *per-order* consumption.
   Aggregate-transaction-with-derived-allocation exists (Fulcrum, SAP MILL_OC) but
   Fulcrum defers the split to costing and MILL_OC needs a synthetic order.
2. **How does the operator experience it?** — One action: one pick line for the
   summed quantity (Fulcrum "one fell swoop"; campaign weighing session; EWM
   consolidated warehouse task). Never N repeated picks.
3. **Can staging aggregate multiple orders into one pick list?** — Yes: SAP EWM
   cross-order staging is purpose-built for it; stock staged non-order-bound to the
   PSA, consumed per order later.
4. **How is one input lot attributed to N orders?** — N consumption postings
   referencing the same batch/lot id (SAP MB56 pattern); genealogy per member.
5. **Cost attribution for aggregated consumption?** — Three SAP tiers: default
   per-order BOM issue (no split needed); MILL_OC ratio distribution at settlement;
   product cost collector (abandons per-order). Fulcrum: proportional (area) with
   per-item fixed-quantity lock. Nesting: actual per-part usage written back.
6. **Terminology?** — "pick to the work order" (Fulcrum), "campaign
   weighing/dispensing" (pharma), "cross-order staging" (SAP EWM), "combined order
   / quantity distribution" (SAP MILL_OC), "campaign / super batch" (BatchMaster).
   No vendor calls it "kitting" or "staging" for the multi-order pick itself.

## Competitor-Specific Details

### SAP
- **MILL_OC / Combined Production Orders** (mill products; now S/4HANA Cloud):
  components of the originals are *copied* to the combined order with the
  fixed-quantity indicator (not re-exploded); confirmation + GI post once on the
  combined order; GR posts per original order via explicit Quantity Distribution;
  settlement pushes collected costs back by that distribution; customer exits
  override ratios. The full aggregate-then-split machine — at the cost of a
  synthetic order.
- **Collective orders** are vertical (parent/sub-assembly), not sibling batching.
- **PP kanban + product cost collector**: consumption posts to a period cost
  collector, never per order — the "give up attribution" end of the spectrum.

### Fulcrum
- The batching entity is the Work Order (groups jobs); it owns the pick; job
  costing allocates the pick's value by nested bounding-box area; a per-item lock
  fixes quantities instead. Labor is tracked once against the group and
  apportioned the same way (matches Carbon's time-slice design).

### Steelhead
- Consumables consumed against tank/inventory item (weigh or QR scan), woven into
  job costing and surcharge invoicing downstream. Exact per-load allocation model
  not publicly documented.

### Process ERPs / pharma
- BatchMaster: campaign / super batch / sub-batch across lines; manual or
  backflushed consumption from formulas per batch job. Deacom/Aptean Ross:
  batch-centric genealogy; aggregated-issue transaction shape not publicly
  documented. Pharma campaign weighing: one weighing session, per-batch records.

## Recommended Approach for Carbon

1. **Aggregate the pick, keep the ledger per member** (SAP EWM staging / pharma
   campaign-weighing pattern, not Fulcrum's costing-time allocation). In MES batch
   mode, load materials for the whole batch (all member ops), group by item, show
   the summed requirement; one operator action issues/picks, and under the hood
   Carbon posts the existing per-member consumptions (`trackedEntitiesToOperation`
   / per-member `issue`) referencing the same lot. Zero changes to costing, GL, or
   traceability — the same "materialize per member, no downstream special-casing"
   principle as the time-slice design.
2. **Split basis: each member's own BOM quantity** (SAP default), not a
   proportional share of a total — each `jobMaterial.estimatedQuantity` already
   defines the member's requirement; the aggregate is just their sum (the
   customer's own examples are plain sums: 32+32=64, 4,000+2,500=6,500).
3. **Do NOT adopt the synthetic combined order** (MILL_OC / customer's "Case A"):
   it re-introduces order merging, which the batching spec and the lot-identity
   research both reject; every system that aggregates the *transaction* pays for
   it with a shadow order or deferred allocation.
4. **Genealogy needs nothing new**: N `trackedActivity` consumptions referencing
   one input `trackedEntity` is already the industry-standard shape (MB56).
5. **Naming**: plain "batch picking" / "batch material issue" in UI copy; reserve
   "campaign" (SAP PP-PI) — it means a scheduling bracket, not a pick.

## Sources

- https://help.sap.com/docs/SAP_ERP/698b19fa88b846359bc611f11184c810/6f80bf53f106b44ce10000000a174cb4.html (PP-PI production campaign)
- https://answers.sap.com/questions/12535983/setup-and-clean-out-orders-in-production-campaigns.html
- http://saphelp.ucc.ovgu.de/NW750/EN/3a/81bf53f106b44ce10000000a174cb4/content.htm (setup/clean-out orders)
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/4032610758dc437089f0c28320eec93f/09ccd8530439414de10000000a174cb4.html (collective orders)
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/combined-production-order-processing-dimp/ba-p/13266644 (MILL_OC)
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/34de0103497c4b80a7c7fbf6952ff971/19cfc353b677b44ce10000000a174cb4.html (components in a combined order)
- https://community.sap.com/t5/enterprise-resource-planning-q-a/confirmation-of-combined-orders-in-mill-oc/qaq-p/14273736
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/combined-production-orders-in-sap-s-4hana-cloud-public-edition/ba-p/14397369
- https://community.sap.com/t5/product-lifecycle-management-blog-posts-by-sap/configure-and-use-process-lots-in-sap-digital-manufacturing/ba-p/13553892 (SAP DM process lots)
- https://help.sap.com/docs/sap-digital-manufacturing/apis/process-lot
- https://community.sap.com/t5/supply-chain-management-blog-posts-by-sap/staging-to-production-in-sap-extended-warehouse-management-overview/ba-p/13514770
- https://www.saplogisticsexpert.com/mastering-cross-order-staging-in-sap-ewm-a-comprehensive-guide-to-production-supply-optimization/
- https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/019deb535cbb5d1ee10000000a441470.html (staging for production)
- https://community.sap.com/t5/enterprise-resource-planning-q-a/traceability-with-mb56/qaq-p/3294080 (batch where-used)
- https://community.sap.com/t5/enterprise-resource-planning-q-a/mb56-batch-where-used-list-components-used/qaq-p/5790159
- https://fulcrumpro.com/product-updates?ddcf7c2e_page=11 (pick-once / bounding-box allocation)
- https://fulcrumpro.com/article/streamline-production-with-work-orders-in-fulcrum
- https://fulcrumpro.com/manufacturing-software/grouped-work-and-nesting
- https://fulcrumpro.com/article/product-showcase-video-using-materials-for-remnant-tracking-quoting-purchasing-and-nesting-in-fulcrum
- https://gosteelhead.com/resource-library/managing-inventory-metal-finishing-steelhead
- https://finishingandcoating.com/index.php/new-technology/2380-using-software-in-barrel-plating-to-improve-efficiencies
- https://gosteelhead.com/chemical-processing
- https://www.sigmanest.com/nesting-software/work-order-basics/
- https://mecadmfg.co.za/how-sigmanest-streamlines-material-management-and-inventory-control/
- https://mecadmfg.co.za/3509-2/ (remnant write-back)
- https://www.hypertherm.com/products/software/pronest-erp-mrp-integration/
- https://www.batchmaster.com/erp-for-food-manufacturing/
- https://www.top10erp.org/products/batchmaster-manufacturing/production-management
- https://www.ecisolutions.com/products/deacom-erp-software/batch-manufacturing-software/
- https://www.aptean.com/en-US/solutions/erp/products/ross-process-manufacturing-erp
- https://batchline.com/simplify-your-pharmaceutical-weighing-operations-with-batchline/ (campaign weighing)
- https://www.lzlifescience.com/solutions/weigh-dispense/
