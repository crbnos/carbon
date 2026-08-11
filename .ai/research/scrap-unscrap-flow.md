# Scrap & Rework Flow Research: Best Practices Survey

## Summary

Surveyed how SAP (ECC/S4 + SAP ME/DM), Oracle Fusion Cloud Manufacturing, NetSuite
(core WIP + Advanced Manufacturing), Epicor Kinetic, Infor (SyteLine/CSI, LN, M3),
JobBOSS², Plex, and Fulcrum handle: shop-floor scrap of the unit being made,
scrap of already-issued/produced components, serial vs batch tracked scrap,
warehouse scrap/unscrap, and the GL treatment. Strong consensus: scrap is a
distinct reported quantity with a mandatory reason code; the reason code (not the
transaction type) is the standard hook for GL account selection and normal/abnormal
analysis; serialized scrap is a **terminal status** on the serial with replacements
getting **new** serials; no mainstream system auto-inflates order quantity on scrap
(replacement is an explicit action — rework operations on the same order, a rework
order settling to the parent, or MRP-driven new supply); warehouse scrap is an
inventory movement to a scrap expense account with reversal as the mirrored
movement (SAP 551/552, Oracle Return-from-Scrap). Oracle Fusion is the only system
with a first-class **unscrap** ("Return from Scrap") that enforces serial/lot
alignment and reverses at original cost. Nobody auto-creates the next serial when
a serialized WIP unit is scrapped — SAP explicitly leaves the order short and
users complain about it — so Carbon auto-spawning the replacement serial (as it
already does on serial completion) is a genuine differentiator, matching how its
own `jobOperationSerialComplete` already works.

## Competitors Surveyed

- **SAP ECC/S4 + SAP ME/DM** — the enterprise reference: confirmation scrap (CO11N), movement types 551/552, scrap variance calculation, SFC scrap in MES.
- **Oracle Fusion Cloud Manufacturing** — most modern first-class model: Scrap/Return-from-Scrap operation transactions, reason-code-driven accounts.
- **NetSuite (core + Advanced Manufacturing)** — mid-market reference; scrap-by-variance vs first-class scrap modes; scrap account on the item.
- **Epicor Kinetic** — job-shop reference; MES scrap at End Activity, Nonconformance→DMR formal path, SCRAPPED serial status.
- **Infor SyteLine/CSI, LN, M3** — immediate scrap-expense posting at cost-through-operation (SyteLine); quarantine + rework-order disposition (LN).
- **JobBOSS²** — small job shop floor: pieces good / pieces scrapped, split-job replacement.
- **Plex** — container/label-status scrap model (SCRAP status excludes from nettable inventory).
- **Fulcrum** — operator UX benchmark: one-tap scrap with qty + reason from the checkpoint flow, live schedule/inventory effect.

## Key Consensus Patterns

### 1. Scrap is reported as a distinct quantity with a mandatory reason code
- **SAP**: CO11N carries Yield / Scrap / Rework quantities + Reason for Variance codes; only yield can be received to stock.
- **Oracle Fusion**: Scrap transactions *require* a reason code; reason codes are user-defined lookups.
- **Epicor**: scrap qty + mandatory scrap reason on the labor detail; **Infor CSI**: Quantity Complete + Quantity Scrapped per operation with reason; **Fulcrum/Plex/JobBOSS**: qty + reason at point of work.
- **Rationale**: the reason code is the analytic (Pareto/scrap heat map) and accounting hook.

### 2. Reason codes drive the GL account (the modern pattern)
- **Oracle Fusion**: costing uses the scrap reason code to derive the scrap account (SLA mapping).
- **Epicor**: Reason Codes of type Scrap/DMR carry a GL Control Code selecting the expense account.
- **SAP**: movement 551 → OBYC GBB-VNG per valuation class; custom movement copies for different accounts.
- **Rationale**: one scrap transaction type, N accounts by cause; avoids proliferating transaction types.

### 3. Scrap cost: expense at report time (at cost-through-operation) vs wash to variance at close
- **Expense-at-report**: Infor SyteLine removes the full accumulated WIP cost of scrapped units (this op + prior ops) from WIP and debits scrap expense when scrap is reported. Oracle Fusion: Dr scrap account / Cr WIP at cost-accumulated-through-operation (timing configurable: immediately vs at WO close).
- **Variance-at-close**: Epicor MES scrap and NetSuite core leave scrap cost in WIP; it settles to manufacturing/WIP variance at job close. Oracle EBS made the scrap account *optional* — with no account, scrap washes out as variance.
- **Doctrine**: normal scrap = product cost (absorbed via planned scrap % in standards or spread over good units); abnormal scrap = period expense. Mid-market systems do NOT auto-classify; reason codes are the analytic proxy.

### 4. Serialized scrap is a terminal status; replacements get new serials; no auto-spawn anywhere
- **SAP**: no automatic scrapped serial status (recommends user-exit to inactivate); scrapping a serialized WIP unit leaves the order short — users must manually change order qty or create a new order. SAP ME's Scrap SFC sets SFC status **Scrapped** (a Return/unscrap exists in ME).
- **Epicor**: serials get status **SCRAPPED** at DMR reject/labor scrap; blocked from reuse; no auto-replacement.
- **Oracle Fusion**: pick the specific serial when scrapping; Return-from-Scrap must match the original serial.
- **Rationale/Gap**: keeping the order whole is a manual pain point everywhere — auto-creating the next serial (which Carbon already does on serial *completion*) applied to scrap is an improvement on all surveyed systems.

### 5. Batch/lot scrap is a partial-quantity movement against the lot
- **SAP**: 551 posted per batch, supports partial quantity; batch has no "scrapped" status — stock just decrements.
- **NetSuite**: lot adjustments with `LOT#(qty)`; serialized items enumerate serials.
- **SAP ME**: partial scrap of an SFC = split the SFC, scrap the split.

### 6. Component scrap after issue: reverse-or-absorb, then replace explicitly
- **SAP**: reverse issue (262) + scrap from stock (551) + re-issue (261); or leave the 261 (order absorbs cost) and issue extra quantity (shows as input-quantity variance).
- **Epicor**: NonConf→DMR for the formal path; informally issue extra material. "Epicor does not provide any functionality to automate scrap" — replacement qty is a human decision (issue more, Production Yield Recalc → MRP new supply, or split job).
- **Infor LN**: rejects move to quarantine; disposition can create a **rework production order based on the originating order**.
- **SAP rework**: trigger points insert reference (rework) operations into the same order; or CO07 rework order settling costs to the original order.

### 7. Warehouse scrap/unscrap = mirrored inventory movements to/from a scrap account
- **SAP**: 551 scrap (Cr inventory BSX at current cost, Dr GBB-VNG scrap expense) / 552 reversal; 553/555 variants for QI/blocked stock; reason per movement (OMBS).
- **Oracle Fusion**: miscellaneous issue to scrap account; WIP-side **Return from Scrap** reverses at *originally scrapped cost*, reason required, serial/lot must match.
- **NetSuite**: negative inventory adjustment to scrap/expense account; reversal is a positive adjustment at entered/current cost (known audit weakness — original cost not preserved).
- **Plex**: container status → SCRAP excludes it from nettable inventory (status model rather than immediate movement).

### 8. Scrap does not auto-flow into order quantity changes
- **SAP**: confirmed scrap updates expected-yield variance; GR is limited to yield; order qty unchanged unless manually reduced (or underdelivery tolerance).
- **Oracle Fusion**: downstream operation requirements recalc for remaining qty; WO finishes short (completed + scrapped ≤ start).
- **Epicor (opt-in)**: Production Yield Recalculation can decrease job qty and let MRP create replacement supply — the only automated replacement, and it is explicit configuration.

## Answers to Research Questions

1. **Does any system auto-create the next serial when a serialized WIP unit is scrapped?** No (SAP explicitly manual; Epicor manual; Fusion finishes short). Carbon doing so mirrors its own serial-complete spawn and beats the field.
2. **How is scrap of an already-made subassembly handled when it was made-to-order?** Rework order settling to the parent (SAP CO07), rework ops inserted into the same order (SAP trigger points, Carbon's existing `trigger-rework` equivalent), or quarantine→rework order (Infor LN). Quantity replacement is always an explicit action.
3. **What accounts does warehouse scrap post to?** Cr inventory at current cost / Dr scrap expense (SAP GBB-VNG, NetSuite scrap account, Fusion reason-mapped account). Reversal mirrors it; Fusion reverses at original scrapped cost.
4. **WIP scrap valuation?** Cost accumulated through the operation where scrap occurred (Fusion, SyteLine) — materials issued + labor/overhead absorbed to that point. Simpler systems expense at item cost or wash to variance at close.
5. **Is "unscrap" a real pattern?** Only Oracle Fusion has it first-class (Return from Scrap, reason-coded, serial/lot aligned, reverses original cost). Everyone else: opposite movement/adjustment.
6. **Partial batch scrap?** Universal: decrement the lot by the scrapped qty; no lot-level status change unless the whole lot is dispositioned.

## Competitor-Specific Details

### SAP
Planned scrap master data (assembly % on MRP1, component scrap on MRP4/BOM item, operation scrap on routing with Net ID) inflates orders/requirements and bakes normal scrap into standard cost — Carbon's `itemReplenishment.scrapPercentage` → `job.scrapQuantity` is the same idea. Unplanned scrap surfaces via period-end variance calculation (scrap variance category) settling to price-difference accounts; MM scrap (551) is the only path hitting the dedicated scrap expense account.

### Oracle Fusion
Distinguishes **Reject** (park for disposition: rework / return to prior op / accept / scrap) from **Scrap** (terminal). Scrap valuation timing is a cost-profile option. Completion transactions exclude scrapped units' cost — scrap carries its own cost out of WIP.

### NetSuite
Scrap handling modes in Advanced Manufacturing: Do Not Post (metrics only), Post As Scrap, Post As Built and Move (to a Location Scrap Bin — the "scrap is a place" model). "Issue for Scrap" backflushes components for scrapped qty so material cost hits the WO (Carbon's scrap route already backflushes the same way).

### Epicor
Two-tier: cheap path (scrap qty + reason on labor, cost dies in WIP→variance at close) vs formal path (NonConformance → Inspection → DMR with dispositions, interim inspection account, reason-code GL). Serial status SCRAPPED blocks reuse.

### Infor
SyteLine is the cleanest "expense at report" reference: accumulated WIP cost of scrapped units (through the reporting op) → scrap expense immediately. LN's quarantine + "create rework production order from originating order" is the cleanest replacement-flow reference.

### Plex / Fulcrum (UX)
Fulcrum: scrap embedded in the operator checkpoint flow — out-of-tolerance → one tap → qty + reason → supervisor notified; NCR raisable in place. Plex: scrap is a container status change with a physical SCRAP label; quality alerts push recent defect history to the operator.

## Recommended Approach for Carbon

1. **Keep one scrap entry point per view (the existing Scrap action/modal), add tracked-entity awareness**: for the serial unit being made, scrap = terminal status on that entity + auto-spawn of the next serial (extends Carbon's existing `jobOperationSerialComplete` spawn — better than every surveyed system). For batches, partial-quantity scrap against the lot (SAP 551-per-batch pattern; split conventions per Carbon's batch-split spec).
2. **Add a terminal `Scrapped` tracked-entity status** (Epicor SCRAPPED / SAP ME Scrapped SFC precedent) rather than reusing `Consumed` — scrapped ≠ consumed-into-parent, and unscrap needs to find them.
3. **Post scrap at report time**: Dr `scrapAccount` / Cr WIP (WIP scrap, SyteLine/Fusion pattern) or Cr inventory (stock scrap, SAP 551) valued at cost-through-operation for WIP output scrap approximated by materials issued + absorbed labor (or item cost where WIP granularity is impractical). Carbon already has `accountDefault.scrapAccount` and the `bookAdjustment` offset-account mechanism.
4. **Replacement is explicit, never automatic order-qty inflation** (universal consensus): scrapping a made-to-order subassembly offers a rework/make-more action reusing Carbon's existing `trigger-rework` op-quantity-bump machinery; pull-from-inventory components simply re-issue from stock.
5. **ERP scrap/unscrap as a first-class adjustment pair** (SAP 551/552 + Fusion Return-from-Scrap): scrap = negative adjustment offset to `scrapAccount` with reason; unscrap = mirrored positive adjustment restoring the tracked entity, reason required, serial/lot must match the original scrap.
6. **Reason codes stay mandatory on every scrap** (universal). Instead of the Fusion/Epicor per-reason *account* mapping, keep ONE `scrapAccount` and tag scrap journal lines with dimensions (ScrapReason, WorkCenter, Employee, Item) — same analytic power, no account proliferation, per the no-matrix-config rule. (Decided by Brad, 2026-08-07 — see the spec.)

## Sources

### SAP
- https://answers.sap.com/questions/8757007/question-about-co11n.html
- https://community.sap.com/t5/enterprise-resource-planning-q-a/confirmation-co11n-scrap-rework-qty/qaq-p/3201221
- https://community.sap.com/t5/enterprise-resource-planning-q-a/reduce-order-quantity-based-on-confirmed-scrap/qaq-p/7748382
- https://blogs.sap.com/2014/02/26/different-scraps-and-their-effects-in-sap-pp/
- https://community.sap.com/t5/enterprise-resource-planning-q-a/serial-number-after-scrap/qaq-p/9931859
- https://community.sap.com/t5/product-lifecycle-management-q-a/sfc-scrap-capabilities-in-sap-digital-manufacturing/qaq-p/13623366
- https://community.sap.com/t5/enterprise-resource-planning-q-a/partial-sfc-qty-scrap-or-rework/qaq-p/10813526
- https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-scrap-issued-material/qaq-p/4818231
- https://blogs.sap.com/2020/04/28/setting-up-trigger-point-in-a-production-order/
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/create-production-order-without-material-for-rework/ba-p/13316098
- https://answers.sap.com/questions/10058788/account-determination-for-entry-gbb-vng-class-7920.html
- https://erproof.com/pp/sap-pp-training/sap-scrapping-process/
- http://saphelp.ucc.ovgu.de/NW750/EN/d7/efd45398184308e10000000a174cb4/content.htm (Scrap Variance)
- https://help.sap.com/docs/sap-digital-manufacturing/execution/defining-scrap-reason-codes-for-quantity-confirmation

### Oracle / NetSuite
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24b/faumf/how-you-report-operation-transactions.html
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24d/fapma/cost-accounting-for-manufacturing-work-orders.html
- https://docs.oracle.com/en/cloud/saas/readiness/scm/26b/mfg26b/26B-mfg-wn-f43097.htm (Redwood: Report Material Scrap)
- https://docs.oracle.com/cd/E18727-01/doc.121/e13635/T372621T374058.htm (EBS scrap/reverse-scrap entries)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2339352.html (Work Order Completions)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1508351779.html (AM Completion Settings)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2235043.html (Adjusting Serialized Inventory)

### Epicor / Infor / JobBOSS
- https://www.epiusers.help/t/understanding-scrap-in-kinetic/86276
- https://www.epiusers.help/t/nonconformace-dmr-proper-process/64200
- https://www.epiusers.help/t/dmr-and-inspection-processing-gl-entries/56208
- https://www.epiusers.help/t/reason-codes-type-gl-control-code/81966
- https://docs.infor.com/csi/9.01.x/en-us/csbiolh/lsm1454144795593.html (Recording Job Scrap Transactions)
- https://ipcplt.apptrix.com/syteline/language/en-us/lsm1454144443032.html (How Scrap Affects Job Cost)
- https://docs.infor.com/ln/10.6/en-us/lnolh/help/ti/onlinemanual/000523.html (Rejects of production orders)
- https://docs.infor.com/ln/10.5/en-us/lnolh/help/wh/onlinemanual/000707.html (Quarantine → rework)
- https://www.ecisolutions.com/products/jobboss2/features/mobile-apps/

### Plex / Fulcrum / Tulip
- https://plex.rockwellautomation.com/en-us/products/manufacturing-execution-system.html
- https://nal.com/wp-content/uploads/2025/01/Plex-Inventory-Training-for-Updated.pdf (SCRAP container labels)
- https://fulcrumpro.com/article/job-tracking-in-fulcrum-the-interface-for-the-shop-floor
- https://fulcrumpro.com/manufacturing-software/production-tracking-and-job-costing
- https://support.tulip.co/docs/defect-tracking-template-1

### Accounting doctrine
- https://www.dummies.com/article/business-careers-money/business/accounting/general-accounting/cost-accounting-job-costs-for-spoilage-reworked-products-and-scrap-164765/
- https://mbaknol.com/business-finance/accounting-treatment-for-material-losses-waste-scrap-and-spoilage/
