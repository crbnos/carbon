# Inventory Valuation Variances Research: PPV on Purchases vs Actuals on Production

## Summary

Carbon books a "Purchase Price Variance" when a supplier invoice price differs from
the received (PO) cost — inventory stays at receipt cost, the delta is expensed —
but costs shop-floor production at pure actuals (actual labor time × work-center
rate, actual material) with no labor/overhead variance. This looks asymmetric. The
research shows it is **not** an inconsistency: what Carbon calls "PPV" is, in strict
accounting terms, an **Invoice Price Variance (IPV) / goods-received-not-invoiced
(GR/IR) reconciliation** — an estimate-to-actual true-up on the *same purchase*, not
a classical standard-cost PPV (which compares purchase price to a *maintained
standard cost*). Under that reading **both sides of Carbon are actual-costing
systems**: both converge to actual cost, neither maintains a performance standard,
so neither produces a true variance. The purchase-side "variance" account is only a
timing mechanism to absorb the delta without retroactively revaluing inventory that
may already be consumed — the same role a revaluation adjustment plays under actual
costing. This is a recognized, defensible design that matches how job-shop-oriented
ERPs (Epicor Average, NetSuite Average default) behave.

## Competitors Surveyed

- **SAP S/4HANA** — reference for enterprise standard vs moving-average (price
  control S vs V), GR/IR, production-order settlement variance categories.
- **Oracle (EBS / Fusion Cost Management)** — explicit PPV vs IPV terminology; WIP
  standard-cost variances; actual/average cost behavior.
- **NetSuite** — Average is the default; PPV only under Standard; Accrued Purchases
  ("Inventory Received Not Billed") + Post Vendor Bill Variances for Average/FIFO.
- **Dynamics 365 Business Central** — cleanest split: Standard → variance account;
  FIFO/LIFO/Average → revalue inventory via Adjust Cost – Item Entries.
- **Epicor Kinetic** — job-shop reference: Standard part → MFG-VAR at close; Average
  part = "actual from a job standpoint", few/no variances.
- **Fishbowl** — SMB job-shop actual costing (labor hours × actual wage into order).

## Key Consensus Patterns

### 1. A variance requires a maintained standard to vary from
- **All vendors + theory**: A cost variance = actual − standard/budget. Under pure
  actual/average/FIFO costing there is no standard operand, so classical price/
  rate/efficiency/usage variances do not exist — the delta simply becomes part of
  actual cost (or, at most, a revaluation adjustment).
- **Rationale**: PPV, material usage, labor rate, labor efficiency, and overhead
  variances are all defined as deviations from a predetermined standard. Remove the
  standard and none can be computed. This is the crux for Carbon.

### 2. Variance accounting is a property of the STANDARD costing method
- **NetSuite / BC / Epicor**: PPV and production (material/labor/overhead)
  variances arise **only** under Standard costing. Under Average/FIFO/actual,
  output is valued at actual consumed cost with **no** manufacturing variance.
- **Rationale**: Standard costing freezes inventory value and isolates every
  deviation into variance GL accounts for management-by-exception; actual costing
  puts real cost into inventory, so there is nothing to isolate.

### 3. Two distinct "purchase price" differences, recognized at two moments
- **Standard-cost PPV**: invoice/PO price vs the item's **maintained standard
  cost**, recognized at goods receipt. Requires a standard. (SAP price control S,
  Oracle standard cost, NetSuite Standard.)
- **Invoice Price Variance (IPV) / GR-IR**: **PO/receipt price vs invoice price** on
  the same purchase, recognized at invoice matching. Requires **no** standard — it
  reconciles what we accrued at receipt against what we were actually billed. This
  is what Carbon actually does.

### 4. Under actual/average costing, the invoice delta is normally handled two ways
- **Revalue inventory (BC-style, "correct" path)**: Adjust Cost – Item Entries
  forwards the true invoiced cost into inventory value and applied COGS. Accurate
  but expensive (retroactive re-costing).
- **Hold inventory at receipt cost + expense delta to a difference account
  (NetSuite Average default, the recognized simplification)**: inventory is not
  retroactively revalued; the delta lands in a variance/holding account. Simpler
  and cheaper; inventory carrying value is knowingly slightly off. **Carbon uses
  this path.** SAP moving-average splits the delta proportionally by remaining
  stock coverage (revalue the on-hand portion, expense the consumed portion);
  Carbon expenses 100% regardless of stock on hand — a further simplification.

### 5. Job shops legitimately use actuals for production
- **Epicor / Fishbowl / Visual South / OpenStax**: For custom, low-volume,
  make-to-order work, accumulating actual material + actual labor + actual burden
  per job and receipting the finished good at accumulated actual cost is the
  textbook-normal approach. Standards, where kept, are used for the **estimate /
  quote / schedule**, not for valuation. Labor is actual hours × a fixed resource/
  work-center rate — the job varies hours, not the per-hour rate.

## Answers to Research Questions

1. **When do ERPs use actual vs standard costing?** Standard for high-volume
   repetitive/process manufacturing where variance control matters and standards
   can be maintained; actual/average for job-order/low-volume/custom shops where
   true per-job cost matters and maintaining standards is burdensome. Method is set
   **per item**, so purchased and manufactured items can differ.

2. **Where does PPV come from?** Standard costing. A true PPV presupposes a
   maintained standard purchase cost. Without one, the only purchase difference is
   the IPV/GR-IR estimate-to-actual reconciliation.

3. **How do the vendors treat production variances?** Only under Standard costing,
   and they decompose them (SAP: input price, input quantity/efficiency, resource-
   usage, scrap, lot-size, overhead; Oracle/BC: material, capacity/labor, overhead,
   subcontract). Under actual/average, none — actual cost is capitalized into the
   finished good (Epicor Average, BC non-standard, NetSuite Average).

4. **Is PPV-on-purchases + actuals-on-production consistent?** Yes, **provided the
   purchase-side account is an IPV/GR-IR reconciliation, not a standard-cost PPV**.
   Under that reading both sides are actual-costing systems converging to actual;
   the difference account merely avoids retroactively revaluing consumed inventory.
   It would only be a genuine *mixed* system (heavier, needing maintained standard
   material costs + period-end PPV reallocation) if the purchase account were a real
   standard-cost PPV while production ran on actuals — which is not what Carbon does.

## Recommended Interpretation for Carbon

1. **The design is coherent and industry-recognized** — it is Epicor-Average /
   NetSuite-Average job-shop actual costing on both sides. No philosophical fix
   needed.
2. **The label overclaims.** Account 5210 "Purchase Price Variance" is really an
   Invoice Price Variance / GR-IR reconciliation. Consider renaming or documenting
   to prevent exactly the "why is this asymmetric?" confusion.
3. **Known simplification to document:** the full invoice delta is expensed to the
   variance account rather than revaluing on-hand inventory (SAP/BC would split by
   stock still on hand). Immaterial when turnover is fast and price deltas small;
   worth flagging for slow-moving, high-value stock.
4. **Production side is correct.** No labor variance is right for Average/FIFO
   items. Carbon's single `materialVariance` catch-all at job close already absorbs
   the WIP residual — for a *Standard*-costed manufactured item that residual **is**
   the aggregate manufacturing variance (actual WIP vs standard receipt), just not
   decomposed into labor-rate / labor-efficiency / overhead. Decomposition is the
   extension point if variance analysis is ever wanted.

## Carbon Code Grounding (verified in this repo)

- Receipt at PO cost → DR Inventory/WIP, CR GR/IR (Goods Received Not Invoiced):
  `packages/database/supabase/functions/post-receipt/index.ts:910-1003`
- Invoice delta → PPV (`purchaseVarianceAccount`, 5210), inventory held at receipt
  cost: `packages/database/supabase/functions/post-purchase-invoice/index.ts:930-1049`
- Labor at actual hours × work-center rate → DR WIP, CR labor absorption:
  `packages/database/supabase/functions/post-production-event/index.ts:110-265`
- Job-close WIP residual → `materialVarianceAccount` (5220):
  `packages/database/supabase/functions/close-job/index.ts:64-140`
- Item costing methods (Standard / Average / FIFO / LIFO) honored in COGS:
  `apps/erp/app/modules/items/items.models.ts:42-47`,
  `packages/database/supabase/functions/shared/calculate-cogs.ts:37-121`

## Sources

- SAP standard vs moving average / PPV to variance accounts — https://erpcorp.com/sap-controlling-blog/choosing-standard-or-moving-average-price
- SAP Help — Valuation with Moving Average Price (stock-coverage split) — https://help.sap.com/docs/SAP_S4HANA_CLOUD/7f47a6d9441c46ac86c96fd27f6015f0/bbd9b6ce0be14516ad7868da0982024a.html
- SAP invoice verification — entering invoices with variances — https://learning.sap.com/courses/invoice-verification-in-sap-s-4hana/entering-invoices-with-variances-1
- SAP production order variance categories — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/understanding-production-order-variance-part-2-the-sap-perspective/ba-p/12937397
- Oracle Cost Management — standard cost variances (PPV vs IPV) — https://docs.oracle.com/cd/A60725_05/html/comnls/us/cst/stdvari.htm
- NetSuite — Standard Costing and Transactions (PPV, Accrued Purchases) — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2206397.html
- NetSuite — Vendor Bill Variances (Accrued Purchases, Match Bill to Receipt) — https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2371184.html
- Dynamics 365 BC — Design Details: Variance — https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-variance
- Dynamics 365 BC — Design Details: Cost Adjustment — https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-cost-adjustment
- Dynamics 365 BC — Design Details: Production Order Posting — https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-production-order-posting
- Epicor manufactured-part receipt Standard vs Average, MFG-VAR, WIP — https://dotnetitblog.wordpress.com/2013/10/15/inventory-costing-methods-which-way-forward/
- Visual South — Standard Cost vs Actual Cost in a work-order-driven company — https://www.visualsouth.com/blog/standard-cost-actual-cost
- AccountingCoach — What is a cost variance — https://www.accountingcoach.com/blog/what-is-a-cost-variance
- AccountingTools — Purchase price variance (requires a standard) — https://www.accountingtools.com/articles/purchase-price-variance
- OpenStax — Job Order vs Process Costing — https://openstax.org/books/principles-managerial-accounting/pages/5-1-compare-and-contrast-job-order-costing-and-process-costing
- Stampli — GR/IR reconciliation — https://www.stampli.com/resources/grir-reconciliation/
