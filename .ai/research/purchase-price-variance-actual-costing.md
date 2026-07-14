# Purchase Price Variance under Actual Costing Research: Best Practices Survey

## Summary

Surveyed how SAP S/4HANA, Microsoft Dynamics 365 Business Central, NetSuite, Odoo (16–19),
and Epicor Kinetic handle the difference between goods-receipt cost and supplier-invoice cost
for inventory items under **actual** costing methods (FIFO/Average — not standard costing),
including GR/IR clearing, stock-coverage splits, invoice-before-receipt, partial documents,
and retroactive COGS adjustment. Purpose: validate the design in
`.ai/plans/2026-07-10-purchase-cost-layer-gl-consistency.md` (receipt-created cost layers,
invoice-time variance split between inventory write-up and PPV by stock coverage).

**Verdict: the plan's design is validated.** Its core mechanics are the SAP moving-average
stock-coverage treatment implemented with Odoo 16/17's exact data structure (correction layers
linked to the receipt layer — Odoo's `stock_valuation_layer_id` link is structurally identical
to the plan's `appliesToCostLedgerId`). The invoice-before-receipt treatment (receipt valued at
invoice price, no variance) is verbatim SAP behavior. Every surveyed system confirms that a
PPV-style expense-always account is a **standard-costing** concept; under actual costing the
consensus is to absorb the difference into inventory for on-hand quantity. Notably, the bug the
plan fixes (variance expensed **and** layer written at invoice cost) is a hybrid no surveyed
system exhibits.

## Competitors Surveyed

- **SAP S/4HANA (MM/FI)** — enterprise reference; the origin of GR/IR clearing and the
  stock-coverage split for moving-average materials.
- **Microsoft Dynamics 365 Business Central** — mid-market manufacturing reference; the most
  complete actual-costing engine (value entries + retroactive cost adjustment).
- **NetSuite** — mid-market ERP; deliberately simple receipt-is-cost-authority model.
- **Odoo 16–19** — closest architectural cousin to Carbon (stock valuation layers ≈ costLedger
  rows); its 16.0 redesign is essentially the same fix the plan makes.
- **Epicor Kinetic** — job-shop manufacturing ERP; behavior differs by costing method.

## Key Consensus Patterns

### 1. A GR/IR clearing account decouples receipt from invoice

- **SAP**: GR/IR (transaction key WRX), credited at PO price on GR, debited on invoice;
  quantity-based clearing per PO line; F.13/F.19/MR11 hygiene jobs.
- **BC**: Inventory Account (Interim) / Invt. Accrual Acc. (Interim) hold "expected cost"
  until invoicing.
- **NetSuite**: Accrued Purchases ("Inventory Received Not Billed"), receipt at PO rate.
- **Odoo**: "Stock Interim (Received)"; auto-reconciled on bill posting.
- **Epicor**: "AP Clearing"/"Accrued Receipts" at PO cost.
- **Rationale**: three-way match requires a balance-sheet parking account; every system agrees.
  Carbon's `goodsReceivedNotInvoicedAccount` already matches.

### 2. Inventory value is created at receipt (at PO price) and trued up at invoice

- **SAP**: GR debits stock at PO price; invoice revalues (MAP) per stock coverage.
- **BC**: receipt posts an "expected cost" value entry; invoicing reverses expected and posts
  actual on the same item ledger entry.
- **Odoo 16+**: receipt creates the SVL at PO price; the bill creates a correction SVL.
- **Epicor (FIFO)**: each receipt is its own FIFO cost bucket, corrected to invoice cost.
- **Exception — NetSuite**: the item receipt is the *permanent* cost authority; a differing
  bill never touches inventory (delta sits in Accrued Purchases until a manual variance-posting
  batch expenses it, or the user edits the receipt cost to trigger a full recalculation).
- **Rationale**: goods are an asset the moment they arrive; the invoice refines the estimate.
  Validates plan D1 (receipt creates the layer) — and shows Carbon's current
  layer-at-invoice-only model matches no surveyed system.

### 3. Under actual costing, the invoice-vs-receipt delta splits by stock coverage

- **SAP (MAP)**: full coverage → all to stock account (revaluation); partial → proportional
  split `stock qty / invoiced qty` between stock and the price-difference account (PRD);
  zero coverage → all to PRD. SAP PRESS worked example: $10 delta, 80/100 pc on hand →
  $8 inventory, $2 expense.
- **Odoo 16/17** (source-verified in `purchase_stock/models/account_move_line.py`):
  `_apply_price_difference()` creates a correction SVL **linked to the receipt layer**
  (`stock_valuation_layer_id = corrected_layer.id`) for the remaining quantity and expenses
  the already-delivered portion via COGS-tagged journal lines. Skips products with
  `cost_method == 'standard'`.
- **BC**: no split — the full delta lands in the value entries and `Adjust Cost – Item Entries`
  pushes the consumed share retroactively into posted COGS (see pattern 5).
- **Epicor**: FIFO parts get an automatic inventory cost adjustment (clearing PPV);
  Average/Last parts get GL-only PPV with **no** inventory correction (documented as a
  weakness requiring "close management").
- **NetSuite**: no split; all to variance accounts, never inventory (unless receipt edited).
- **Rationale**: the on-hand portion is an asset-measurement refinement, not a period expense;
  expensing it distorts both margin and the balance sheet. Validates plan D2; per-layer
  coverage (Odoo/BC style) is finer-grained than SAP's whole-material stock check.

### 4. Invoice-before-receipt: the later receipt is valued at the invoice price, no variance

- **SAP**: invoice debits GR/IR at invoice value (no stock posting); the later GR is valued at
  the **invoice price** — GR/IR settles exactly, no PRD posting. Received qty beyond the
  invoiced qty reverts to PO price.
- **BC**: structurally forbidden — invoiceable quantity is capped by received quantity; a
  standalone item invoice creates the receipt simultaneously.
- **NetSuite**: allowed; IRNB carries a debit; the later receipt still posts at PO rate and the
  delta stays in IRNB for the variance batch.
- **Odoo**: a known gap — `_apply_price_difference` skips when no receipt layers exist
  ("Don't create value for more quantity than received"); invoice-first gets no revaluation
  (criticized in RFC #118687).
- **Rationale**: when actual cost is known before goods arrive, there is nothing to estimate —
  SAP's treatment is the correct one and the plan's D3 matches it exactly (including the
  PO-price reversion for over-receipt).

### 5. Retroactive COGS restatement is the premium tier, not the baseline

- **BC**: `Adjust Cost – Item Entries` forwards late cost changes into posted COGS via
  append-only adjustment value entries (dated to the invoice or next open period).
- **SAP**: only with **Material Ledger actual costing** (requires standard price control +
  period-end costing run computing a periodic unit price that revalues both ending inventory
  and the period's consumption).
- **NetSuite**: only by editing the item receipt cost (triggers a full costing recalculation
  from the receipt date forward).
- **Odoo / Epicor**: no restatement of original postings — the consumed share hits the current
  period (COGS account in Odoo, PPV in Epicor).
- **Rationale**: restatement needs dedicated batch machinery (application chains, period
  guards, G/L reconciliation). Expensing the consumed share in the current period (SAP without
  ML, Odoo, Epicor) is the accepted mid-market baseline. Validates keeping retroactive COGS
  out of the plan's scope.

### 6. "Purchase price variance" is standard-costing vocabulary

- **SAP** officially says "price differences" (PRD); PPV is consulting vernacular for
  standard-price materials.
- **BC** uses the Purchase Variance account **only** for Standard costing ("variance = actual −
  standard"); FIFO/Average have no variance account at all.
- **Epicor**: "PPV account used for Standard Cost parts"; **Odoo 16+** removed the price
  difference account for FIFO/AVCO entirely.
- **Rationale**: under actual costing there is no "correct" price to vary from — only a better
  estimate arriving later. Validates plan D7 (Standard items keep all-variance-to-PPV).

## Answers to Research Questions

1. **On-hand vs consumed split?** — Consensus (SAP, Odoo, Epicor-FIFO): on-hand → inventory
   write-up; consumed → expense (SAP PRD / Odoo COGS). BC goes further (retroactive COGS);
   NetSuite does less (all to variance). The plan's D2 sits on the consensus.
2. **Invoice-before-receipt?** — SAP: GR/IR carries the accrual at invoice value; later receipt
   valued at invoice price, zero variance (= plan D3). BC forbids it; Odoo mishandles it
   (known gap); NetSuite parks it in IRNB.
3. **Layers at receipt or invoice?** — Receipt, everywhere except NetSuite-without-Advanced-
   Receiving and pre-16 Odoo. Adjustments are separate linked records (BC adjustment value
   entries, Odoo correction SVLs with a parent-layer FK) — never in-place mutations (= plan
   D1/D4 and valuation-spec decision #11).
4. **Partial receipts/invoices?** — Quantity-based matching per PO line (SAP), value entries
   per partial invoicing against the same item ledger entry (BC), correction capped at received
   quantity (Odoo — same cap as the plan's `quantityToReverse`). Multiple receipts per invoice
   and vice-versa are table stakes; the plan's journal-group walk + per-layer allocation covers
   both.
5. **Retroactive COGS?** — Premium tier only (BC always-on; SAP only with Material Ledger;
   NetSuite only via receipt edit). Current-period expensing of the consumed share is the
   accepted baseline. Plan's out-of-scope call is sound; BC's append-only adjustment entries
   are the model to follow if Carbon builds it later.
6. **Terminology?** — "Price difference" (SAP) or nothing at all (BC/Odoo actual costing).
   PPV strictly means actual-vs-standard. Carbon keeping the `purchaseVarianceAccount` for the
   consumed share matches SAP's PRD usage; the journal line description could eventually read
   "Price Difference" for actual-cost items, but this is cosmetic.

## Competitor-Specific Details

### SAP S/4HANA
- OBYC keys: BSX (stock), WRX (GR/IR), PRD (price differences; modifiers PRA/PRF/PRU),
  KDM (FX differences at invoice clearing).
- Coverage measured as **current total stock of the material in the valuation area** at invoice
  posting — not per-receipt tracking. Consumption between receipt and invoice therefore shifts
  the split even if unrelated stock covers it (coarser than per-layer coverage).
- MR11 clears residual GR/IR **quantity** mismatches; price residues always resolve through
  stock/PRD at invoice time.

### Microsoft Dynamics 365 Business Central
- Two-ledger model: item ledger entries (quantity, `Remaining Quantity`) + value entries
  (`Cost Amount (Expected)` vs `Cost Amount (Actual)`, `Adjustment` flag) — the closest
  published analog to Carbon's itemLedger/costLedger pair.
- Expected-cost value entries always exist in the subledger; "Expected Cost Posting to G/L"
  only controls whether the interim accounts hit the G/L.
- `Adjust Cost – Item Entries`: detection at posting (item application entries), calculation in
  batch; adjustments are **append-only** value entries; also maintains the item card unit cost.
- Invoice-before-receipt impossible from a PO; a direct purchase invoice receives + invoices in
  one posting, so "invoiced but not received" inventory cannot exist.

### NetSuite
- Verbatim doctrine: "If you change the cost on the vendor bill, NetSuite doesn't update item
  costing… Any variance between the receipt and the bill shows up in the Accrued Purchases
  account."
- `Post Vendor Bill Variances` (manual batch) reclasses IRNB residuals into Bill Price /
  Quantity / Exchange Rate variance accounts configured **on the item record**; eligibility
  depends on "Match Bill to Receipt" (per-receipt) vs PO-line aggregate (PO must be closed).
- Simplest model surveyed, and the source of chronic IRNB-reconciliation pain (multiple
  consulting firms publish reconciliation guides) — a cautionary tale for leaving variances
  parked in the accrual account.

### Odoo
- 16.0 redesign (RFC #118687) is effectively the same fix as this plan: price-difference
  account removed for FIFO/AVCO; correction SVL linked to the receipt layer
  (`stock_valuation_layer_id`); `layer.remaining_value` bumped; delivered share expensed with
  `display_type: 'cogs'` journal lines.
- Known criticisms worth heeding: bill locking once a correction SVL exists, FX fluctuations
  generating spurious corrections, awkward reversal story (plan Task 8 handles reversal
  explicitly; FX is flagged for follow-up in Task 11).
- Odoo 19 moved valuation to invoice-level with period-end accrual entries — a regression per
  community reports (no GL at receipt); not a pattern to follow.

### Epicor Kinetic
- Costing-method split: FIFO parts auto-correct inventory (ADJ-CST); Average/Last parts post
  GL-only PPV (ADJ-PUR touches only accrual + variance, "Nothing to Inventory") — documented
  as requiring manual cost adjustments to keep inventory honest.
- Kinetic quirk: with multiple invoices per receipt, variance computes only when an invoice is
  marked **final**.

## Recommended Approach for Carbon

1. **Proceed with the plan as designed.** D1 (receipt-created layers) and D2 (coverage split
   with adjustment child rows) follow the SAP stock-coverage treatment with Odoo 16/17's
   per-layer data structure — the two systems that solved this most recently and most
   precisely. Per-layer coverage is strictly more accurate than SAP's whole-material check.
2. **Keep D3 (invoice-first → receipt at invoice cost, no variance).** It is exactly SAP's
   behavior, including PO-price reversion for receipt quantity beyond the invoiced quantity,
   and it fixes a gap Odoo still has.
3. **Keep the consumed-portion share in `purchaseVarianceAccount` (D7 semantics).** This
   matches SAP PRD and Epicor; Odoo's alternative (product COGS account) is defensible but
   loses the analyzable variance line. Optionally rename the journal line description to
   "Price Difference" for non-Standard items later — cosmetic, not blocking.
4. **Do not build retroactive COGS restatement now.** It is the BC/Material-Ledger premium
   tier; if built later, follow BC's append-only adjustment value entries dated to the invoice
   (or next open period) — the plan's `appliesToCostLedgerId` children are the right substrate
   for that future work.
5. **Heed Odoo's RFC criticisms in implementation**: make invoice void/reversal of adjustment
   rows first-class (plan Task 8), and treat multi-currency variance (exchange-rate movement
   between receipt and invoice) as a named follow-up — SAP separates FX differences (KDM) from
   price differences (PRD); Carbon currently folds FX into the line cost.
6. **Avoid the NetSuite failure mode**: never leave the delta parked in GRNI for a manual
   batch to clean up — the surveyed reconciliation pain confirms Carbon's choice to resolve
   variance at invoice-posting time.

## Sources

### SAP
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/7f47a6d9441c46ac86c96fd27f6015f0/bbd9b6ce0be14516ad7868da0982024a.html — Valuation with Moving Average Price
- https://help.sap.com/docs/SAP_ERP/56f7319a9048445eb86221af73cab72b/6a5eb6531de6b64ce10000000a174cb4.html — Price Control
- https://learning.sap.com/courses/invoice-verification-in-sap-s-4hana/entering-invoices-with-variances-1 — Entering Invoices with Variances (stock-coverage rule)
- https://userapps.support.sap.com/sap/support/knowledge/en/2674900 — KBA: Posting logic for invoices with price variances (login-gated; preview verified)
- https://userapps.support.sap.com/sap/support/knowledge/en/2674902 — KBA: Posting logic for GR before IR (login-gated; preview verified)
- https://userapps.support.sap.com/sap/support/knowledge/en/2603662 — KBA: Separate G/L accounts for price difference postings
- https://community.sap.com/t5/additional-blog-posts-by-sap/valuation-of-a-goods-receipt-for-a-purchase-order-gr-ir-amount/ba-p/12905602 — GR valuation at invoice price (invoice-first)
- https://blog.sap-press.com/what-is-the-difference-between-moving-average-price-and-standard-price-in-sap — MAP vs standard, $8/$2 worked example
- https://erpcorp.com/sap-controlling-blog/sap-controlling/gr-ir-goods-receipt-invoice-receipt-processing — GR/IR mechanics
- https://erpcorp.com/sap-controlling-blog/actual-costing-with-sap-material-ledger — Material Ledger actual costing
- https://www.pikon.com/en/blog/introduction-to-s4hana-material-ledger-and-actual-costing/ — ML periodic unit price

### Business Central
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-expected-cost-posting — Expected Cost Posting (interim accounts, 95→100 example)
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-cost-adjustment — Adjust Cost – Item Entries
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-inventory-posting — Item ledger vs value entries
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-variance — Variance = actual − standard (Standard only)
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-costing-methods — Costing methods
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-accounts-in-the-general-ledger — Account mapping table
- https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-record-purchases — Receive-before-invoice enforcement
- https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-to-combine-receipts — Get Receipt Lines (many receipts, one invoice)
- https://www.speakingbusinesscentral.com/post/business-central-inventory-gl-entries-purchases — GL walkthrough (actual cost)
- https://www.speakingbusinesscentral.com/post/business-central-inventory-gl-entries-purchases-standard-cost — GL walkthrough (standard cost)

### NetSuite
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2191818.html — Costing Methods (receipt is cost authority)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2371184.html — Vendor Bill Variances
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2373098.html — Vendor Bill Variance Journals (formulas)
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2197365.html — Inventory Costing Recalculations
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2195087.html — System COGS Adjustments
- https://blog.prolecto.com/2017/04/29/explaining-netsuites-inventory-received-not-billed-account/ — IRNB explained
- https://technologyblog.rsmus.com/technologies/netsuite/reconciling-inventory-received-not-billed-irnb/ — IRNB reconciliation pain

### Odoo
- https://github.com/odoo/odoo/issues/118687 — RFC: 16.0 stock accounting redesign (pdiff SVLs, criticisms)
- https://raw.githubusercontent.com/odoo/odoo/17.0/addons/purchase_stock/models/account_move_line.py — `_apply_price_difference` source
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html — Valuation cheat sheet (v19 invoice-level model)
- https://www.odoo.com/forum/help-1/where-is-the-price-difference-account-in-odoo-16-212839 — Price difference account removal
- https://www.odoo.com/forum/help-1/price-difference-purchase-and-stock-264427 — Invoice-before-receipt gap
- https://odootricks.tips/inventory-postings-valuation/ — Stock Interim (Received) postings

### Epicor
- https://www.epiusers.help/t/ap-invoices-affect-on-cost-of-qty-bearing-parts/63860 — ADJ-PUR is GL-only for average/last
- https://www.epiusers.help/t/purchase-price-variance-average-costing/87594 — PPV = standard-cost concept
- https://www.epiusers.help/t/purchase-price-variance-ap-qty-does-not-match-receipt-quantity/116142 — "final invoice" variance timing
- https://dotnetitblog.wordpress.com/tag/inventory-costing/ — FIFO auto cost adjustment vs average PPV
