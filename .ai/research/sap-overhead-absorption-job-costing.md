# SAP S/4HANA Overhead Absorption in Manufacturing Job Costing

## Summary

Surveyed how SAP S/4HANA handles overhead absorption for production orders, covering the full
lifecycle: from labor time confirmation (CO11N) to costing-sheet overhead application (CO43) through
period-end settlement (CO88). The key finding is that SAP uses two distinct mechanisms — activity-type
absorption (real-time, category-43 secondary cost elements) and costing-sheet overhead (period-end,
category-41 secondary cost elements) — and that skipping overhead absorption causes a presentation
distortion on the P&L (favorable variance on orders, unabsorbed balance on cost centers) even though
the net P&L impact is zero, because overhead costs were already expensed via primary cost elements.

---

## Competitors Surveyed

- **SAP S/4HANA** — the reference standard for enterprise manufacturing PP-CO integration; Universal
  Journal (ACDOCA) unifies FI and CO in a single ledger as of S/4HANA 1511+.

---

## Research Questions Answered

1. What journal entries does SAP create when labor time is confirmed on a production order?
2. How is overhead absorbed — via costing sheet vs. activity rates?
3. What accounts are hit at each step?
4. What is the COGS impact if overhead is not absorbed?

---

## The Two Absorption Mechanisms

SAP uses two parallel, non-exclusive mechanisms to absorb overhead into production orders:

| Dimension | Activity-Type Allocation | Costing-Sheet Overhead |
|-----------|--------------------------|------------------------|
| Cost element category | **43** (Internal Activity Allocation) | **41** (Overhead Rates) |
| Transaction | CO11N (operation confirmation) | CO43 (collective overhead calculation) |
| Timing | **Real-time** — posts on confirmation | **Period-end** — run manually or scheduled |
| Basis | Actual hours × activity rate (KP26 / KSII) | % of accumulated direct cost elements |
| What is credited | Work center's cost center | Overhead cost center (via credit key) |
| FI document (S/4HANA) | Yes (Universal Journal / ACDOCA) | CO-internal; FI impact only at settlement |

---

## Journal Entries by Transaction

### 1. Goods Issue to Production Order (MIGO, Movement Type 261)

Real-time FI document. The consumption G/L account is a primary cost element (category 1), so the
FI posting simultaneously updates CO on the production order.

| Side | Account | OBYC Key | Type |
|------|---------|----------|------|
| Debit | Raw Material Consumption | GBB / VBR | P&L expense (primary CE cat 1) |
| Credit | Raw Material Inventory | BSX | Balance sheet asset |

CO: Production order debited with the same amount via the primary cost element linkage.

### 2. Labor / Machine Time Confirmation (CO11N)

Posts when an operation is confirmed. In S/4HANA this creates an ACDOCA row visible in FI/CO; in
classic ECC it was CO-only (no FI document, because payroll already charged the P&L independently).

| Side | Object | Cost Element | Category |
|------|--------|--------------|----------|
| Debit | Production order | Secondary cost element (e.g., "Machine Hours") | **43** |
| Credit | Work center cost center | Same secondary cost element | **43** |

The same category-43 cost element appears on both sides; the posting is self-balancing. In ECC a
cross-profit-center reconciliation document (KALC) could create an FI document, but CO11N itself
did not. In S/4HANA, the Universal Journal eliminates this FI/CO gap — every confirmation writes
to ACDOCA.

**Activity rate source:** Planned rate from KP26 (cost center activity price planning). At period-end,
actual revaluation (transaction KSII) recalculates actual rates and re-prices all confirmations.

### 3. Overhead Costing Sheet Application (CO43 — period-end)

Run once per period (CO42 = single order, CO43 = collective). Reads actual accumulated costs on the
order that fall within the costing sheet's calculation base, then applies the overhead percentage rate.

| Side | Object | Cost Element | Category |
|------|--------|--------------|----------|
| Debit | Production order | Secondary cost element (e.g., "Factory Overhead") | **41** |
| Credit | Overhead cost center (via credit key) | Same secondary cost element | **41** |

This is CO-internal in ECC; in S/4HANA it writes to ACDOCA. No standalone FI document is created —
the FI balance-sheet impact comes only at settlement.

**Credit key configuration:** The costing sheet row contains a credit key that specifies (a) which
cost center is credited and (b) which category-41 secondary cost element is used. Configured via
IMG → Controlling → Product Cost Controlling → Basic Settings → Overhead → Define Credits.

### 4. Finished Goods Receipt from Production (MIGO, Movement Type 101)

Posts at the material's current standard price × quantity. No price difference at GR under standard
costing — variances accumulate silently on the production order.

| Side | Account | OBYC Key | Type |
|------|---------|----------|------|
| Debit | Finished Goods Inventory | BSX | Balance sheet asset |
| Credit | Cost of Goods Manufactured | GBB / AUF | P&L (inventory change) |

Note: No GR/IR clearing account (WRX). That account is purchase-order-only. The production order
is simultaneously credited in CO with the same standard-cost amount. The difference between total
debits (actual costs) and this credit (standard) is the production order's running variance balance.

### 5. Period-End: WIP Settlement (KO88 / CO88 — open order)

If the order is still open (status REL or PDLV), WIP is capitalized to the balance sheet:

| Side | Account | Type |
|------|---------|------|
| Debit | WIP / Unfinished Goods Inventory | Balance sheet asset |
| Credit | Change in WIP | P&L income (offsets expenses already posted) |

### 6. Period-End: Variance Settlement (KO88 / CO88 — closed order DLV/TECO)

When the order is fully delivered or technically complete, WIP is reversed and net variance posts:

| Side (unfavorable) | Account | OBYC Key | Type |
|-------------------|---------|----------|------|
| Debit | Production Variance / Price Difference | PRD / PRF | P&L expense |
| Credit | Production order (cleared to zero) | — | CO cleared |

Variance also settles to CO-PA with category breakdown (input price, input quantity, overhead, scrap,
lot size, remaining) — but CO-PA is CO-only with no additional FI document.

---

## Period-End Close Sequence (Classic Costing-Sheet Flow)

```
1. Goods issues (MT 261) — material components charged to order
2. Activity confirmations (CO11N) — labor/machine hours confirmed
3. Activity price revaluation (KSII) — reprices confirmations at actual rates
4. Actual overhead (CO43) ← costing sheet absorption happens here (on revalued base)
5. WIP calculation (KKAX / KKAO)
6. Variance calculation (KKS1 / KKS2)
7. Settlement (CO88 / KO88) — the ONLY step that posts WIP/variance to FI
```

CO43 is idempotent: re-running it in the same period reverses and recalculates from the base.

This sequence applies to the classic period-end costing-sheet flow. S/4HANA's
recommended event-based flow (scope item 3F0, "Event-Based Production Cost
Posting") posts overhead, WIP, and variances with each business event (goods
issue, confirmation) instead — no period-end run required. Carbon's per-event
posting corresponds to the event-based model.

---

## What Happens When Overhead Is NOT Absorbed (CO43 Skipped)

### Why This Matters

When CO43 is not run, the category-41 secondary cost element postings never happen. Production
orders never accumulate overhead costs. But finished goods were received at standard cost — which
WAS computed by the standard cost estimate (CK11N) to include overhead. This creates a mismatch.

### Financial Statement Impact

**Step 1:** Overhead cost center received actual costs via FI (payroll, utilities, depreciation).
Those primary cost elements are **already on the P&L** — the FI posting is the expense recognition.
The cost center is a CO statistical receiver only.

**Step 2:** Finished goods were received at standard cost (includes overhead component). The
production order was credited at standard. But the order was never debited with overhead (CO43
skipped). So:

```
Production order balance at settlement =
  Actual costs (material + labor, NO overhead) - Standard cost credited at GR
  = Favorable variance (order shows a credit balance)
```

**Step 3:** At CO88, this favorable variance settles to the PRD / overhead variance account:
```
FI: DR Production Order (cleared)
    CR Overhead Variance Account (favorable = credit to P&L)
```

**Net P&L effect: zero**, but presentation is severely distorted:

| P&L Line | Effect |
|----------|--------|
| Overhead cost center costs (payroll, utilities) | Already expensed as period costs |
| Production variance account (PRD) | Receives an **unexplained favorable credit** |
| COGS at the product level | Understated by exactly the overhead amount |
| Period overhead line | Overstated by the same amount |

The overhead costs were expensed correctly (on the cost center) but were never inventorialized —
they did not flow through WIP into finished goods and then into COGS via the product margin. Instead,
they appear as period overhead on the cost center while products show an artificial favorable variance.

### Auditor / Controller Terminology

- **Under-absorbed overhead**: The cost center absorbed less than its actual costs because the
  absorption mechanism (CO43) was not run. Unabsorbed balance remains on the cost center.
- **Volume variance**: In management accounting, the unallocated cost center balance decomposes into
  spending variance and volume/activity variance.
- **Period cost misclassification**: Auditors describe this as overhead being recognized as period
  costs rather than inventorialized per ASC 330 / IAS 2. Note: for abnormally low production,
  this may actually be the *correct* treatment under GAAP.
- **CO-FI reconciliation break** (ECC): Controllers flagged cost center balances with no FI
  settlement as reconciliation items. In S/4HANA / Universal Journal, the Profit Center Accounting
  view makes this visible: the profit center assigned to the overhead cost center will show an
  unexplained debit (over-expensed) while production-order profit centers show an unexplained credit.

---

## Key Account Types Summary

| Account | OBYC Key | Direction | Type |
|---------|----------|-----------|------|
| Raw material inventory | BSX | Cr at goods issue | Balance sheet asset |
| Raw material consumption | GBB / VBR | Dr at goods issue | P&L expense |
| Work center cost center (labor) | — | Cr at CO11N | CO (cat-43 CE) |
| Production order (labor debit) | — | Dr at CO11N | CO (cat-43 CE) |
| Overhead cost center | — | Cr at CO43 | CO (cat-41 CE) |
| Production order (overhead debit) | — | Dr at CO43 | CO (cat-41 CE) |
| Finished goods inventory | BSX | Dr at GR | Balance sheet asset |
| Cost of goods manufactured | GBB / AUF | Cr at GR | P&L (inventory change) |
| WIP / Unfinished Goods | OKG2 | Dr at WIP settlement | Balance sheet asset |
| Change in WIP | OKG2 | Cr at WIP settlement | P&L income |
| Production variance / Price Difference | PRD / PRF | Dr (unfav) or Cr (fav) at order settlement | P&L |

---

## Key Configuration Transactions

| TCode | Purpose |
|-------|---------|
| KL01 | Create activity type (category 43) |
| KP26 | Plan activity price (rate used in CO11N debit) |
| KSII | Actual activity price revaluation (period-end) |
| KZS2 | Costing sheet maintenance (base, rate, credit key rows) |
| CO42 | Individual order overhead calculation |
| CO43 | Collective overhead calculation (period-end batch) |
| KKAX / KKAO | WIP calculation (individual / collective) |
| KKS1 / KKS2 | Variance calculation (individual / collective) |
| KO88 / CO88 | Individual / collective settlement |
| OBYC | MM account determination (BSX, GBB, PRD, WRX) |
| OKG1 / OKG2 | Result analysis keys and WIP GL account assignments |
| OKO6 / OKO7 | Settlement profile and PA transfer structure |

---

## Recommended Approach for Carbon (Manufacturing Overhead in Job Costing)

Carbon currently implements `calculateCOGS` for FIFO and has a standard-costing scaffold with
variance accounts. The SAP model suggests the following design principles:

1. **Two absorption mechanisms, not one.** Labor (operation confirmations) absorbs at a known rate
   per unit of time (activity-rate model, analogous to category 43). Indirect overhead absorbs as a
   percentage of accumulated direct costs at period-end (costing-sheet model, analogous to category
   41). These are additive and independent.

2. **Standard cost governs inventory valuation.** Finished goods GR posts at standard cost (which
   includes both labor rates and overhead rates from the cost estimate). The production job
   accumulates actual costs. The variance between actual and standard settles at period-close, not
   at GR.

3. **Overhead not absorbed = period cost distortion, not an inventory understatement.** If
   absorption is skipped, inventory is still valued at standard (correct); what is wrong is the P&L
   presentation — overhead sits as a period expense on a cost center while production jobs show
   artificial favorable variances. The fix is running absorption, not adjusting inventory.

4. **Separate variance categories for reporting.** SAP's KKS1 decomposes variance into input price,
   input quantity, overhead, scrap, lot size, and remaining. For Carbon, at minimum: material
   variance, labor variance, and overhead variance should be tracked separately and settle to
   distinct GL accounts.

5. **WIP and variance are mutually exclusive per period.** An open job capitalizes WIP to the
   balance sheet each period (offsetting period expenses). A closed job reverses WIP and posts net
   variance. This prevents double-counting.

---

## Sources

- [SAP Help Portal — Costing Sheet (S/4HANA Cloud)](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c56f622a2edf491b9f1b596b55587009/a814c64cad9345c4ad232715e94cb16f.html)
- [SAP Help Portal — Run Overhead Calculation - Production Orders - Actual (CO43)](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c56f622a2edf491b9f1b596b55587009/2dffbf5362ebb44ce10000000a174cb4.html)
- [SAP Help Portal — Cost Element Categories](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c56f622a2edf491b9f1b596b55587009/8196ebe296f54f9990eca346df4e02b4.html)
- [SAP Help Portal — CO-FI Reconciliation](https://help.sap.com/docs/SUPPORT_CONTENT/ficontrolling/3361878583.html)
- [SAP Help Portal — Schedule Actual Overhead Allocation - Cost Centers](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c56f622a2edf491b9f1b596b55587009/4b20405587ed8418e10000000a423f68.html)
- [SAP Press Blog — Overhead Rate Application for Period End Closing](https://blog.sap-press.com/overhead-rate-application-for-period-end-closing-with-sap)
- [SAP Press Blog — Primary and Secondary Costs in SAP S/4HANA](https://blog.sap-press.com/primary-and-secondary-costs-in-sap-s4hana)
- [ERP Corp — SAP Costing Sheets Allocate Overhead](https://erpcorp.com/sap-controlling-blog/sap-costing-sheets-allocate-overhead)
- [ERP Corp — Activity Types in Review](https://erpcorp.com/sap-controlling-blog/activity-postings-1-activity-types-in-review)
- [SAP Community — Overhead Cost Allocation Options in Product Costing](https://blogs.sap.com/2017/08/22/overhead-cost-allocation-options-in-product-costing/)
- [SAP Community — Over/Under Absorption of Overheads](https://community.sap.com/t5/enterprise-resource-planning-q-a/over-under-absorption-of-overheads/qaq-p/3478668)
- [SAP Community — Unabsorbed Cost on Cost Center](https://archive.sap.com/discussions/thread/1973077)
- [SAP Community — Create Costing Sheet with Multiple OH Rates](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/create-costing-sheet-with-multiple-oh-rates/ba-p/13515603)
- [SAP Community Blog — Overhead Cost Planning Using Costing Sheet](https://blogs.sap.com/2014/09/01/overhead-cost-planning-using-costing-sheet/)
- [Sajiv Francis — Product Costing in SAP S/4HANA Part 1](https://docs.sajivfrancis.com/sap/product-costing/product-costing-in-sap-s-4hana-from-production-order-to-material-ledger/)
- [Sajiv Francis — Product Costing in SAP S/4HANA Part 2 (Material Ledger)](https://docs.sajivfrancis.com/sap/product-costing/s-4hana-product-costing-from-production-execution-to-material-ledger-ac-v1/)
- [Zapliance — Do You Have Unallocated Costs in SAP?](https://zapliance.com/en/blog/the-big-costs-test-do-you-have-unallocated-costs-in-sap/)
- [LinkedIn / Joseph Teli — 3 Methods to Absorb Overhead in Product Costing (SAP)](https://www.linkedin.com/pulse/3-methods-absorb-overhead-product-costing-sap-joseph-teli)
- [SAP Help UCC — Cost Centers and Activity Types](http://saphelp.ucc.ovgu.de/NW750/EN/5b/894653339b7425e10000000a44176d/content.htm)
