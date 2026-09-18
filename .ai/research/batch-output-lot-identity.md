# Cross-Job Batch Output & Lot Identity Research: Best Practices Survey

> Researched: 2026-08-27 · Prompted by: Slack discussion (Sid/Brad) on Zero's requirement
> that batched-operation output share a single LOT identifier, and Brad's ask to research
> how systems like Steelhead treat cross-job batching as a core feature.
> Complements: `.ai/research/job-operation-batching.md` (2026-07-03 — composition, costing,
> scheduling; still current). This file covers only what that one didn't: Steelhead's
> model, and the lot identity of a batch run that spans jobs.

## Summary

Surveyed Steelhead Technologies (metal finishing MES), Bluestreak (heat-treat QMS/MES),
SAP Digital Manufacturing (process lots, SFC merge) + SAP Batch Management, Epicor Kinetic
Advanced Production, and the CQI-9 heat-treat quality standard. The industry consensus is
unambiguous: **the shared identifier of a cross-job batch run is a run/load/process-lot ID
layered on top of per-job lot identity — never a replacement of it.** Each work order keeps
its own output lot and its own certification; the shared run (furnace load, rack, process
lot) has its own identifier that every member's traceability record references. A literal
single merged output LOT across orders exists only as a same-material special case (SAP SFC
merge; SAP batch-at-material-level goods receipt), is always a deliberate manual act, and
destroys or bypasses per-order identity — no surveyed system does it by default. Separately,
Steelhead/SAP DM confirm that a batch can *persist across consecutive operations* (the rack
travels the whole line; process lots complete operation after operation), which is the
"core feature" shape Brad pointed at — one batch per single operation is the more
conservative variant Carbon v2 shipped.

## Competitors Surveyed

- **Steelhead Technologies** — MES/ERP purpose-built for plating/anodizing/powder-coating
  job shops; Brad's named reference; cross-order racking is its daily workflow
- **Bluestreak** — incumbent QMS/MES for commercial heat treaters; NADCAP/CQI-9 oriented
- **SAP Digital Manufacturing** (process lots, SFC merge) + **SAP Batch Management** —
  enterprise reference for grouping and for lot identity rules
- **Epicor Kinetic (Advanced Production / Advanced MES)** — job-shop ERP batching
- **CQI-9 (AIAG Heat Treat System Assessment)** — the quality standard governing what a
  furnace load record must preserve

## Key Consensus Patterns

### 1. The batch run gets its own identifier; members keep theirs

- **SAP DM process lot**: "a group of SFCs with a unique ID"; SFCs — including from
  different shop orders — are processed "all together as one"; SFCs can be added/removed
  at different points; member SFC numbers never change. Completing at an operation
  requires all members on the same routing, same operation activity, same status, same
  resource.
- **Heat treat (CQI-9 / Bluestreak)**: documentation is required for every load, and "lot
  traceability shall be maintained throughout the entire process" — the load record is
  shared, the lots stay distinct. Bluestreak issues certifications **per order** (multiple
  certs per order for partial shipments), not per furnace load.
- **Steelhead**: "multiple part numbers, work orders, and even multiple customers are put
  on to a single rack … easy movement of many parts through the plant in a single click,
  while maintaining cost tracking and quality on all parts"; inspections/NCRs log "against
  the specific job and part they came from"; NADCAP audit trails pull per job.
- **Epicor Advanced Production**: batching groups "multiple parts or operations together …
  resulting in a single reporting entity or job for simplified scheduling, tracking, and
  reporting" — a reporting/execution entity; the member jobs remain the costing and
  completion units.
- **Rationale**: certs, quality claims, and shipments are per-order commercial artifacts;
  the physical run is an execution artifact. Two identities, linked — never collapsed.

### 2. A literal shared output LOT exists only as a same-material special case

- **SAP DM SFC merge**: merged SFCs must have "the same material and material version",
  status New/In Queue only; the parent SFC absorbs the whole quantity and "the child SFCs
  have a quantity of zero" — identity merge is possible but destroys the members.
- **SAP Batch Management**: the batch definition level is the **material** (or client),
  not the order — so goods receipts from multiple production orders *can* post into one
  shared batch number, but only by deliberate manual assignment (no auto-batch in the
  scheduling profile; batch pre-created in MSC1N and keyed in at GR). Default behavior is
  a batch per order (order-header batch).
- **Rationale**: "one LOT" is only well-defined when every member produces the same item;
  and even then the mainstream default keeps per-order batches, with the shared batch as
  an opt-in.

### 3. Mixing rules are a quality gate on composition, not on identity

- **CQI-9**: material from different heat lots "which may preclude achieving the specified
  metallurgical properties" must be prevented from being processed together — the standard
  constrains *what may share a load*, and then requires the load record + per-lot
  traceability; it never merges the lots.
- This matches the v2 spec's locked decision that material filters are advisory planning
  aids — but note CQI-9 makes certain mixes a hard quality violation, which a customer's
  quality workflow (not schema) is expected to enforce.

### 4. Batches can persist across consecutive operations (the "core feature" shape)

- **Steelhead**: the rack is loaded once and moves through the whole treatment line
  (degrease → plate → seal → bake) "in a single click" per move — the batch is a
  multi-operation traveler, not a single-operation grouping. Grouping is driven by "setup
  requirements like paint color or coating mix, to cut changeovers between runs".
- **SAP DM process lots**: explicitly designed so SFCs can be added/removed "at different
  points during the manufacturing process" and completed operation-by-operation as a
  group — the process lot survives across operations.
- **Carbon v2's one-batch-per-operation** is the conservative subset of this; SAP DM shows
  the multi-operation extension keeps per-member identity intact (nothing about persisting
  across ops requires merging lots).

## Answers to Research Questions

1. **What entity represents the cross-job batch?** Steelhead: the rack/load (part-level
   membership, multi-customer). SAP DM: the process lot (unique ID over SFCs). Epicor: a
   batch "reporting entity or job". Bluestreak/CQI-9: the furnace load + its load record.
   In every case a first-class execution entity referencing member orders.
2. **Is batchability a routing property or ad-hoc at execution?** Steelhead groups by
   setup/recipe compatibility at execution; SAP DM process lots are composed at execution
   (manually or auto-created by rule); Epicor batching is planned. None require the BOP
   itself to be authored "batchable per step" — grouping is an execution/planning act over
   compatible operations, which supports Brad's instinct that batching should be a core
   execution capability rather than a per-BOP modeling burden. (Carbon's `process.batchable`
   master-data flag is still the right gate per the 2026-07 research — it marks the
   *machine's* capability, not the BOP.)
3. **Does the batch output get one LOT?** No system does this by default. Consensus: each
   job's output keeps its own lot; the batch/load/process-lot ID is recorded in every
   member's traceability so the shared run is citable (certs reference the load). One
   shared output lot is a same-material-only, opt-in pattern (SAP GR-into-existing-batch;
   SFC merge), and SFC merge zeroes the children.
4. **Intermediate-operation batching and lot identity?** SAP DM process lots operate at
   any operation, including intermediate ones — the group completes the operation together
   and the SFCs continue on their own orders. Lot identity is untouched by *where* the
   batching happens; only the run reference is recorded.
5. **What must the shared record preserve (quality standards)?** CQI-9: per-load process
   documentation + unbroken per-lot traceability; incompatible material lots must not share
   a load. NADCAP audit expectations (per Steelhead's marketing): per-job who/when/where
   audit trails pulled from shared runs.
6. **Terminology**: rack/load (finishing, heat treat), process lot (SAP DM), batch
   (Epicor), load record (CQI-9). "Process lot" is the cleanest precedent name for "the
   shared run identifier recorded in member traceability".

## Competitor-Specific Details

### Steelhead
- Racking is the primary floor unit: multi-part-number, multi-work-order, multi-customer
  racks moved in one click; cost and quality remain per part/WO. Public material is
  marketing-level — no data-model docs found; claims are from their product pages and a
  third-party review. Not verifiable publicly: their internal load/lot schema.

### SAP Digital Manufacturing
- Process lot = unique-ID group of SFCs, cross-shop-order, add/remove mid-process,
  complete-at-operation requires same routing/operation/status/resource. Auto-creation by
  rule exists ("Create Process Lots Automatically"). SFC merge is the separate,
  same-material, identity-destroying operation.

### SAP Batch Management
- Batch number belongs to the material (or client) — enabling deliberate shared batches
  across orders; order-header batch → all GRs of that order carry one batch number.

### Bluestreak / CQI-9
- Certs per order (multiple per order for partial shipments); control plans at work-order
  or step level; CQI-9 load documentation + lot traceability + mixing restrictions.

### Epicor Kinetic
- Advanced Production batching creates a single reporting entity for scheduling/labor
  across parts/operations; MES reports labor once against it.

## Recommended Approach for Carbon

1. **Do not merge output lots across jobs.** Keep per-job tracked entities/lots exactly as
   today (SAP GR-per-order, Bluestreak cert-per-order, CQI-9 pattern).
2. **Make `jobOperationBatch` the shared identity Zero is asking for**: at batch completion,
   record the batch (`BAT…` readableId) into each member's tracked-entity activity/genealogy
   — the "load number on the cert" pattern (SAP DM process-lot ID, CQI-9 load record). Every
   member lot then *shares one citable identifier* without any lot surgery, and it works
   identically at intermediate operations. This is the smallest change that satisfies the
   requirement as stated ("batch output share the same LOT identifier") in the way the
   industry actually means it.
3. **Optional same-item extension (only if Zero literally needs one lot number):** when all
   members produce the same item, offer an opt-in "shared output batch number" at batch
   completion (SAP batch-at-material-level precedent). Deliberate, never default, and
   scoped same-item-only. Needs its own design pass against `trackedEntity` semantics.
4. **Brad's brittleness concern → v2 direction, not schema change now:** the Steelhead/SAP
   DM precedent for batches that persist across consecutive operations (rack-as-traveler,
   process-lot-per-operation-chain) is real and keeps per-member identity. Treat
   multi-operation batches as the designed future extension of `jobOperationBatch` (batch
   completes an operation, members advance, batch re-forms/continues), rather than adding
   per-BOP batch-step authoring — no surveyed system authors batchability into the BOP
   step-by-step.
5. **Quality-gate mixing (future, quality module):** CQI-9-style incompatible-lot rules are
   a quality-workflow concern; keep material filters advisory (locked decision) but note
   the hook for quality rules on batch composition.

## Caveats

- Steelhead and Epicor claims come from vendor marketing pages, a third-party review, and
  search summaries — no public data-model documentation exists for either. SAP claims are
  grounded in help-portal/community documentation. CQI-9 claims are from the published
  assessment PDFs.
- Fulcrum's lot-traceability handling of nested batch output is not publicly documented
  (searched; nothing beyond the 2026-07 grouped-work findings) — explicitly unanswered;
  carry into the spec's open questions if it matters.

## Sources

- https://gosteelhead.com/plating-anodizing-software
- https://gosteelhead.com/resource-library/metal-finishing-production-management-software
- https://softwareconnect.com/reviews/steelhead-software/
- https://community.sap.com/t5/supply-chain-management-blogs-by-sap/create-process-lots-automatically/ba-p/13577849
- https://help.sap.com/docs/sap-digital-manufacturing/apis/process-lot
- https://community.sap.com/t5/product-lifecycle-management-blog-posts-by-sap/configure-and-use-process-lots-in-sap-digital-manufacturing/ba-p/13553892
- https://community.sap.com/t5/product-lifecycle-management-blog-posts-by-members/sfc-merge-split-in-sap-digital-manufacturing/ba-p/13555778
- https://help.sap.com/docs/sap-digital-manufacturing/execution/sfc-merge
- https://sites.google.com/site/sapswords/home/sap-pp-pppi/sap-shop-floor-control/goods-receipt-in-sap-production-order-or-process-order
- https://sites.google.com/site/sapswords/home/sap-batch-management/sap-batch-management-overview
- https://community.sap.com/t5/enterprise-resource-planning-q-a/multiple-batch-receipt-against-one-production-orders/qaq-p/6054021
- https://www.go-bluestreak.com/home
- https://www.go-bluestreak.com/solutions-services
- https://www.aiag.org/training-and-resources/manuals/details/CQI-9
- https://uploads-ssl.webflow.com/5ce60004d355ee060ae09de8/6070634bea45a1f34b572c55_CQI-9%204th%20Ed%20AMP%20041021.pdf
- https://www.top10erp.org/products/epicor-kinetic/production-management
- https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/production-management/
