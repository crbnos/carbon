# Inventory Adjustment GL Posting Research: Best Practices Survey

## Summary

Surveyed how SAP S/4HANA, NetSuite, Fishbowl, and Epicor Kinetic post inventory
quantity adjustments (cycle counts, manual adjustments, shop-floor scrap) to the
general ledger. Strong consensus: an adjustment is a posting event that hits the
GL immediately (perpetual inventory), valued at quantity × the item's current
cost under its costing method (never a user-entered cost on decreases), with the
inventory asset account on one side and a dedicated "inventory adjustment"
(gain/loss/shrinkage) P&L account on the other. The offset account resolves from
a company-level default, optionally refined by reason codes (Epicor) or separate
scrap accounts (Fishbowl, SAP movement types). Cycle counts do not have their own
posting mechanism — count approval funnels into the same adjustment transaction
(NetSuite creates literal Inventory Adjustments on approval; SAP PI difference
posting *is* a goods movement; Epicor Post Counts creates ADJ-QTY transactions).
Carbon's current gap: `insertManualInventoryAdjustment` writes quantity-only
`itemLedger` rows with no `costLedger` or `journal`/`journalLine` counterpart,
which is exactly the tie-out variance the valuation workbench warns about.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference for physical inventory,
  movement types, and automatic account determination (OBYC).
- **NetSuite** — closest analogue to Carbon: perpetual inventory in a cloud ERP
  with costing methods (Average/FIFO/LIFO/Standard) and a native Inventory
  Count → Inventory Adjustment pipeline.
- **Fishbowl** — inventory point solution posting journal entries to an external
  GL (QuickBooks); relevant for its simple account-mapping model.
- **Epicor Kinetic** — discrete-manufacturing reference for reason-code-driven
  account routing and shop-floor scrap treatment.

## Key Consensus Patterns

### 1. An adjustment is a paired subledger + GL posting, created synchronously

- **SAP**: posting a physical-inventory difference (MI07) creates a material
  document and, for valuated stock, an accounting document *together,
  synchronously*. "From the accounting point of view, this corresponds to a
  goods receipt or goods issue."
- **NetSuite**: the Inventory Adjustment is a posting transaction — GL impact on
  save, no separate post step. Count approval generates adjustments that post
  immediately.
- **Fishbowl**: each adjustment sends a journal entry to QuickBooks instantly.
- **Epicor (outlier)**: part transactions accumulate and the batch **Capture
  COS/WIP Activity** process materializes GL entries periodically — a documented
  source of "why can't I see GL activity during the month?" complaints and
  reconciliation pain. The industry trend even within Epicor shops is to run
  capture nightly to approximate real-time.
- **Rationale**: perpetual inventory requires the subledger and GL to move in
  lockstep or tie-outs break — the exact problem Carbon has today.

### 2. Adjustment value = quantity × current cost under the costing method

- **SAP**: difference qty × current valuation price (standard price for price
  control S, moving average for V). No price-difference (PRD) posting arises —
  there is no external value on a PI posting.
- **NetSuite**: **negative** adjustments never take a user cost — the system
  computes the credit from the costing method (average cost; FIFO consumes
  oldest layers, LIFO newest; standard at standard). **Positive** adjustments
  take an "Est. Unit Cost" that defaults to current average cost and creates a
  new cost layer (behaves like a receipt).
- **Fishbowl**: Cycle Count and Scrap take no user cost (valued from costing
  layers / set cost); only "Add Inventory" lets the user assign a cost, to
  create a real costing layer.
- **Rationale**: decreases must relieve the same value the subledger is
  carrying, or the asset account drifts from the subledger. Increases need a
  cost source; current cost is the default, with optional override for
  found/donated stock.

### 3. Offset is a dedicated inventory-adjustment P&L account with a default + override hierarchy

- **SAP**: transaction key **GBB-INV** — "expenditure/income from inventory
  differences" — resolved by valuation class (item grouping). Scrap uses a
  *different* key (GBB-VNG) so shrinkage and deliberate scrap are separable on
  the P&L. The inventory (BSX) side is never manually posted.
- **NetSuite**: "Adjustment Account" chosen per transaction (usually an expense
  account); cycle counts pre-fill from the global preference **Default
  Inventory Count Account**. Not per-item or per-reason natively.
- **Epicor**: resolution hierarchy — reason-code GL control → part GL control →
  part-class GL control → company default ("Inventory COS and WIP" GL control's
  Inventory Adjustment account).
- **Fishbowl**: mandatory part-type default mapping + optional per-part
  override; separate Inventory Adjustment vs Scrap accounts.
- **Rationale**: one company default makes the feature usable day one; the
  hierarchy exists so businesses can separate shrinkage / scrap / count
  variance on the P&L without reclassing journal entries.

### 4. Adjustment direction determines debit/credit, same accounts both ways

Consensus entry shape (SAP example, valuation price $10, difference 5 EA):

| Case | Debit | Credit |
|---|---|---|
| Gain (count > book) | Inventory asset $50 | Inventory adjustment (income) $50 |
| Loss (count < book) | Inventory adjustment (expense) $50 | Inventory asset $50 |

NetSuite and Fishbowl post the same shape. Most shops use a single P&L account
for both directions (SAP training text describes an expense/revenue pair, but a
single "inventory differences" account per valuation class is common practice).

### 5. Cycle counts funnel into the same adjustment posting path

- **NetSuite**: count lifecycle (Open → Started → Completed/Pending Approval →
  Approved); approval creates one positive and/or one negative **Inventory
  Adjustment** transaction — the count itself never posts.
- **SAP**: the PI document lifecycle (create → count → recount → post
  difference) ends in a goods movement (701/702) like any other.
- **Epicor**: Post Counts creates ADJ-QTY part transactions stamped with the
  count-discrepancy reason code.
- **Rationale**: one posting code path, many entry points. The count feature is
  workflow (snapshot, count, approve); the posting is just an adjustment.

### 6. Posting lands in an open accounting period, dated at posting time

- **SAP**: the count date fixes the posting period; differences must post in
  the same (or next open) period — cross-fiscal-year posting is blocked.
- **NetSuite**: posts to the selected open posting period; date defaults to
  today; closed periods reject postings.
- **Rationale**: shrinkage discovered in July must hit July's P&L; backdating
  into closed periods breaks reported financials.

### 7. Shop-floor scrap during production is a WIP problem, not an inventory-adjustment problem

- **Epicor**: scrap reported on a job operation has *no* immediate GL impact —
  cost stays in WIP and purges as manufacturing variance (MFG-VAR) at job
  close. Only inventory-level scrap (ADJ-QTY with a scrap reason) posts an
  adjustment.
- **SAP**: scrapping *from stock* (movement 551 → GBB-VNG) posts immediately;
  scrap *within an order* flows through order settlement/variance.
- **Rationale**: material already issued to a job is WIP, relieved by the
  production-costing flow. Inventory adjustments cover on-hand stock only.

## Answers to Research Questions

1. **What document/entity is created, and what lifecycle?** SAP: a physical
   inventory document (create → count → recount → post difference) ending in a
   material document + accounting document pair. NetSuite: an Inventory
   Adjustment posting transaction (no draft state); Inventory Counts have a
   lifecycle (Open → Started → Pending Approval → Approved) and materialize
   adjustments at approval. Epicor: ADJ-QTY part transaction, GL entry at
   capture. Consensus: the *adjustment* itself posts immediately without its
   own approval workflow; approval lifecycles belong to the *count*, upstream.

2. **Which accounts, and how is the offset determined?** Inventory asset
   (auto-determined from the item — SAP valuation class, NetSuite item record's
   asset account, Carbon's `resolveInventoryAccount` equivalent) against a
   dedicated inventory-adjustment P&L account. Offset resolution: SAP GBB-INV
   by valuation class; NetSuite per-transaction with a global default for
   counts; Epicor reason → part → part class → company default; Fishbowl
   part-type default + per-part override.

3. **How is the adjustment valued?** Quantity × current cost under the item's
   costing method (SAP, NetSuite, Fishbowl agree). Negative adjustments consume
   cost layers exactly like a sale/issue (FIFO oldest-first, LIFO newest-first,
   average at current average, standard at standard) with no user cost input.
   Positive adjustments default to current cost; NetSuite/Fishbowl allow a user
   override which creates a new cost layer. NetSuite's "underwater" preference
   (last purchase price / zero / average for depletions below zero) handles
   negative-inventory costing with corrections posted when stock resurfaces.

4. **Do cycle counts, manual adjustments, and scrap post differently?** Same
   mechanism, different offset routing. SAP separates by movement type
   (701/702 PI diff → GBB-INV vs 551/552 scrap → GBB-VNG); Epicor and Fishbowl
   separate by reason code / mapped scrap account. NetSuite doesn't natively
   (reason codes are a common customization). In-production scrap is a WIP
   variance concern, out of scope for inventory adjustments (see pattern 7).

5. **When does posting happen and with what date?** Immediately at
   posting/approval (SAP, NetSuite, Fishbowl), into an open accounting period,
   dated at posting time (NetSuite count-generated adjustments date at
   approval; SAP forces same-period-as-count). Epicor's batch capture is the
   outlier and a documented pain point — not a model to copy.

6. **Standard terminology?** "Inventory Adjustment" (NetSuite/Epicor/Fishbowl —
   the natural fit for Carbon, which already uses "Positive Adjmt."/"Negative
   Adjmt." entry types), "physical inventory difference" (SAP), "Adjustment
   Account" / "expense or income from inventory differences" for the offset,
   "shrinkage" colloquially for losses, "cost layers" for FIFO/LIFO valuation.

## Competitor-Specific Details

### SAP S/4HANA
- Movement types auto-selected by stock type at difference posting: 701/702
  (unrestricted gain/loss), 703/704 (quality inspection), 707/708 (blocked).
  Scrap 551/552; initial stock load 561/562 (offset GBB-BSA, the only flow here
  that can hit a price-difference account under standard costing).
- OBYC lookup chain: chart of accounts → transaction key (BSX/GBB) → valuation
  grouping code (plant grouping) → general modification (INV/VNG/BSA/VBR) →
  valuation class (item grouping) → GL account.
- BSX (stock) accounts are posted **only automatically** — manual FI postings
  to them are prohibited by convention, or the stock account stops tying to the
  subledger.
- MI07 posts in the background with no cost-center field; cost-center
  assignment for the P&L account comes from OKB9 defaults.
- Tolerances: max difference amount per line/user tolerance group.

### NetSuite
- Inventory Adjustment: header Adjustment Account (required), Date, Posting
  Period, Memo, Department/Class/Location segments, optional Customer for job
  costing; lines carry Adjust Qty By (delta) and Est. Unit Cost
  (increases only).
- Inventory Adjustment **Worksheet** (absolute "New Qty" reset) is explicitly
  discouraged for FIFO/LIFO — it destroys costing history ("sells the items and
  buys them back"). Delta adjustments preserve layers. Carbon's "Set Quantity"
  adjustment type should internally resolve to a delta for exactly this reason.
- Zero-GL escape hatch: a positive adjustment at cost 0 creates a zero-cost
  layer and posts nothing.
- Count feature: snapshot at Start Count; Calculated (next-count-date driven)
  vs Manual counts; approval gate reviews variance detail; rejection re-counts;
  a preference re-snapshots on reject to absorb mid-count transactions.

### Fishbowl
- Three adjustment types with distinct offsets: Cycle Count (set-to-counted →
  inventory adjustment account), Add Inventory (delta with user cost → creates
  costing layer), Scrap (→ separate mapped scrap account).
- Cost Adjustment: changing a part's cost posts (cost change × on-hand qty) to
  inventory vs the adjustment account — value corrections are also GL events.
- Initial go-live count deliberately posts nothing (value assumed already on
  the books).

### Epicor Kinetic
- Reason codes typed (Inventory Adjustment, Scrap, RMA, DMR), each optionally
  carrying a GL control; multiple reasons can share one control; falls back to
  the company COS-and-WIP control's Inventory Adjustment account.
- Documented gotcha: if the inventory account and adjustment account resolve to
  the same GL account, Epicor suppresses the $0-net entry — adjustments appear
  to vanish from the GL.
- Batch capture evaluates GL controls at *run* time, not transaction time —
  another reconciliation failure mode Carbon avoids by posting synchronously.

## Recommended Approach for Carbon

1. **Post adjustments synchronously through an edge function, following the
   `post-receipt` pattern** (SAP/NetSuite immediate-posting model, and Carbon's
   own established pattern). Manual adjustments currently write quantity-only
   `itemLedger` rows from `insertManualInventoryAdjustment`
   (`apps/erp/app/modules/inventory/inventory.service.ts`); the posting path
   must add paired `costLedger` and `journal`/`journalLine` writes in the same
   transaction, guarded by `accountingEnabled` like receipts/shipments.

2. **Value adjustments by the item's costing method** (SAP qty × valuation
   price rule; NetSuite layer consumption): negative adjustments consume open
   `costLedger` layers via the existing `calculateCOGS`-style layer logic
   (FIFO/LIFO) or current `itemCost` unit cost (Average/Standard); positive
   adjustments post at current cost and create a `costLedger` layer so the
   valuation RPC and the GL carry the same value. No user-entered cost on
   decreases, ever.

3. **Add a single company-level `inventoryAdjustmentAccount` to
   `accountDefault`** as the offset (NetSuite Default Inventory Count Account /
   SAP GBB-INV analogue). This respects Carbon's flat-defaults-over-matrix
   convention. The inventory side reuses the existing `resolveInventoryAccount`
   (rawMaterials vs finishedGoods by replenishment system) so adjustments hit
   the same asset accounts the tie-out already watches.

4. **One posting path, all entry points**: quantities page, item master
   shelves, cycle count confirm, and MES shop-floor adjustments all already (or
   should) funnel through `insertManualInventoryAdjustment` — attach GL posting
   there, not per-surface (NetSuite count-approval-creates-adjustment pattern).
   In-production scrap on jobs stays in the WIP/variance flow (Epicor/SAP
   consensus) and is out of scope.

5. **Resolve "Set Quantity" to a signed delta before posting** (NetSuite
   worksheet lesson: absolute resets destroy FIFO/LIFO cost history; delta
   adjustments preserve layers).

6. **Post into the current open accounting period, dated at posting time**,
   reusing `getCurrentAccountingPeriod` — matching SAP/NetSuite period
   discipline and the tie-out RPC's `postingDate <= as_of_date` filter.

7. **Defer reason-code → account routing** (Epicor hierarchy, Fishbowl scrap
   account) to a follow-up. Capture the existing adjustment comment/type on the
   journal description now so a later reason-code feature has a seam. If a
   second account is ever wanted, scrap-vs-shrinkage is the first split the
   industry makes.

8. **Backfill question for the spec**: historical unposted adjustments will
   still show a tie-out variance after the feature ships. The spec must decide
   between a one-time catch-up journal (SAP-style opening adjustment) or
   documenting the variance start date. Carry this into Open Questions.

## Sources

### SAP
- https://learning.sap.com/courses/inventory-management-and-physical-inventory-in-sap-s-4hana/conducting-physical-inventory — PI phases, qty × price valuation, expense/revenue from PI offsets, period rules
- https://www.guru99.com/all-about-physical-inventory.html — PI lifecycle MI01/MI04/MI07, posting block/freeze flags, movement types
- https://community.sap.com/t5/enterprise-resource-planning-q-a/accounting-entries-for-movement-types-701-702/qaq-p/3408376 — Dr BSX / Cr GBB-INV for 701, reverse for 702
- https://www.erpgreat.com/financial/obyc-different-transaction-like-bsx-gbb.htm — BSX auto-posting-only rule, GBB modifier list
- https://erpcorp.com/sap-controlling-blog/fundamentals-of-mm-fi-account-determination — OBYC lookup chain
- https://community.sap.com/t5/enterprise-resource-planning-q-a/reg-703-704-and-707-708-movement-types-for-stock-adjustments-mi10-migo/qaq-p/11317683 — movement type by stock type
- https://community.sap.com/t5/enterprise-resource-planning-q-a/account-determination-for-entry-gbb-vng-class-7920-not-possible/qaq-p/9531456 — 551 scrap → GBB-VNG
- https://userapps.support.sap.com/sap/support/knowledge/en/1589511 — cross-period/fiscal-year PI posting blocked
- https://robertsap.wordpress.com/2014/05/23/posting-period-of-count-difference/ — count date fixes posting period
- https://community.sap.com/t5/enterprise-resource-planning-q-a/select-cost-center-for-physical-inventory-difference-posting/qaq-p/7483436 — MI07 background FI doc, OKB9
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/4603118feda9495892abadbe8f8c3d14/32ddb3c915ed47fd9bca1b86ca2da762.html — goods movement → material doc + accounting doc
- https://community.sap.com/t5/enterprise-resource-planning-q-a/accounting-entries-for-initial-stock-upload-urgent-help-needed/qaq-p/3419752 — 561 → GBB-BSA

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_161981111273.html — Entering an Inventory Adjustment (Adjustment Account field)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2259648.html — Adjustment vs Worksheet overview
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4337970267.html — FIFO/LIFO on the worksheet (costing-history destruction)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2191818.html — costing methods / layer consumption
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1497451045.html — negative-inventory cost-estimate preference
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2296970.html — Inventory Count overview
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2297156.html — Default Inventory Count Account preference
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2299731.html — count lifecycle, snapshot, approval
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_155993309646.html — approval creates inventory adjustments
- https://www.hotwax.co/blog/decoding-netsuite-transaction-types-impact-on-financials-and-inventory — DR/CR shape for adjustments
- https://technologyblog.rsmus.com/technologies/netsuite/how-to-set-up-inventory-adjustment-reason-codes-in-netsuite/ — reason codes as customization
- https://archive.netsuiteprofessionals.com/t/382050/how-to-do-inventory-adjustments-without-gl-impact — zero-cost positive adjustment trick

### Fishbowl
- https://blog.tarabyte.com/blog/how-do-inventory-adjustments-work-in-fishbowl — adjustment types → JE targets
- https://blog.tarabyte.com/blog/oops-vs-ugh-a-guide-to-inventory-adjustments-for-fishbowl-inventory — Add vs Cycle Count vs Scrap, per-part account coding
- https://inventorygurutarabyte.blogspot.com/2015/07/fishbowl-inventory-accounting-basics.html — part-type default + per-part mapping, costing layers
- https://help.fishbowlinventory.com/advanced/s/article/Accounting-Journal-Entries — canonical JE table (not machine-fetchable; corroborated via TaraByte)

### Epicor
- https://www.epiusers.help/t/reason-codes-type-gl-control-code/81966 — reason-code GL controls, COS-and-WIP fallback, job scrap stays in WIP
- https://www.epiusers.help/t/accounting-help-where-do-adj-qty-transactions-hit/38775 — ADJ-QTY posting, $0-net suppression gotcha
- https://www.studocu.com/row/document/shah-abdul-latif-university/computer-science/kinetic-hierarchy-required/109050892 — ADJ-QTY account resolution hierarchy
- https://community.epicorusers.org/kinetic-epicor-erp-81/controlling-the-inventory-adjustment-account-used-for-cycle-count-variances-physical-inventory-variances-cost-variances-created-during-the-mfg-stk-transaction-87738 — count-discrepancy reason routing
- https://www.epiusers.help/t/timing-of-gl-trans-from-parttrans-capture-cos-wip/42682 — batch Capture COS/WIP creates GL entries
- https://www.epiusers.help/t/how-often-to-capture-cos-wip-monthly-weekly-daily/70759 — capture cadence pain
- https://www.epiusers.help/t/job-closing-detail-information/74699 — MFG-VAR purges remaining job cost at close
