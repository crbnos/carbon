# Query performance sweep

Date: 2026-11-03. Code: `origin/main` at `83f7b3e670` (after #2107).
Measurements: local database, synthetic copies of seed data, rolled back.
Production sizes: the "Carbon" project (US), read-only queries.
Benchmark script: `.ai/runs/2026-11-03-purchase-invoices-view-bench.sql`.

This file changes no code. Each item is a candidate. Measure an item before
you change it (see "How to measure").

## What we learned

These lessons come from #1343 (order views), #1813 (documents), #2107
(purchase invoices) and the benchmarks for this sweep.

| # | Lesson | Evidence |
|---|--------|----------|
| 1 | A view that groups child rows in a subquery (`LEFT JOIN (SELECT … GROUP BY parentId)`) totals the whole company before the list keeps one page. Postgres cannot pass the page's ids into a grouped subquery. | #1343 header; #2107 |
| 2 | `LEFT JOIN LATERAL` computes the totals per row. The win is per-page work, not tenant isolation. RLS already limits the old form to the user's own company. | #1343 corrections; this sweep |
| 3 | The per-row form is fast only when Postgres can read the rows in the list's sort order and stop at the page size. Without an index that gives the order, it computes every row, then sorts. | #1343: 41,648 ms with no sort index |
| 4 | Joined tables must be reachable by an index under RLS. An RLS policy of the form `A OR x IN (SELECT …)` blocks a `BitmapOr`, so the table can only be scanned. | #1343 `item` policy |
| 5 | Reads over every row (KPI tiles, exports, payment application, accounting syncs) get about 1.5–2× slower with the per-row form. | #2107 bench: KPI 48 → 88 ms |
| 6 | A small company can get slower with the per-row form. | #2107 bench: 427 invoices, page 6.0 → 12.7 ms |
| 7 | Postgres plans `"companyId" = ANY(<function result>)` as about 10 companies. In a table with few companies it then scans every row and discards other tenants' rows. With about 97 companies it uses the `companyId` index. | this sweep: 2 companies 9.4 ms full scan; 97 companies 2.0 ms index |
| 8 | A list that selects `*` makes Postgres compute every view column. A narrow select lets Postgres drop joins that the list does not use. | #1343 `*_LIST_COLUMNS` |
| 9 | An RLS helper called per row costs a function call per row. Wrap it in `(SELECT helper(…))` so it runs once per query. | #1813 documents policy |

### Benchmark traps

Each trap below gave a wrong result during this sweep or #1343.

1. Pass the company id as a plain value, as the app does. A subquery hides the
   company from the planner statistics. One run showed 125 ms; the real
   plan took 1.7 ms.
2. Use the list's real `ORDER BY` and `LIMIT`.
3. Run `ANALYZE` on the seeded tables first.
4. Run as `authenticated` with JWT claims, inside one transaction.
5. Seed many companies, with large and small user companies.
6. Measure the reads over every row too, not only the list page.

## Findings, in order

Production sizes are small today. The largest single company holds 1,824
rows in any grouped child table. No item is urgent. The order below is by
value for the cost of the change.

### 1. Lists that select every view column

44 paged list getters call `.select("*", { count: listCount(args) })` on a
view. Postgres then computes columns that the screen does not show.

The fix is the #1343 pattern: a `*_LIST_COLUMNS` constant per list, checked
by `list-select-columns.test.ts` against the table's `accessorKey`s.

| View | Getter | What the list computes for nothing |
|------|--------|------------------------------------|
| `customers` | `getCustomers` (`sales.service.ts`) | `orderCount`, a grouped count of `salesOrder` |
| `suppliers` | `getSuppliers` (`purchasing.service.ts`) | `orderCount`, `partCount`, grouped counts of `purchaseOrder` and `supplierPart` |

The other views by definition cost (joins, subqueries, grouping): `customerContracts`,
`leases`, `processes`, `issues`, `storageUnits_recursive`, `documents`,
`purchasingRfqs`, `rentalAgreements`, `inventoryCountLines`,
`purchaseReturnOrders`, `qualityActions`, `salesReturnOrders`, `workCenters`,
`fleetAssets`, `supplierQuotes`, `trainings`. Check what each screen and its
CSV export read before you narrow the select.

### 2. Grouped child tables with no company index

The views below group a child table. The child table has no index that
starts with `companyId`. So the grouped subquery reads every company's rows
and RLS discards the other tenants (lesson 7).

| Table | Rows (all tenants) | Grouped by views |
|-------|-------------------|------------------|
| `supplierQuoteLine` | 2,278 | `supplierQuotes` |
| `workCenterProcess` | 2,175 | `processes`, `workCenters` |
| `nonConformanceItem` | 1,811 | `issues`, `qualityActions` (the quality dashboard counts `issues` 3 times) |

The fix is one index per table: `("companyId")`, or a composite index that
starts with `companyId` and the parent id.

### 3. The `itemCost` read policy

`itemCost` (about 21,000 rows) has this SELECT policy:

```sql
("companyId" IN (… parts_view, sales_view …))
OR ("itemId" IN (SELECT "itemId" FROM "supplierPart" WHERE "supplierId" = ANY (…)))
```

This is the shape that #1343 removed from `item` (lesson 4). The same
rewrite applies: an uncorrelated `array_agg` and `= ANY (…)`. Verify the
visible rows per persona (employee, supplier portal, customer portal, no
access), as #1343 did.

About 25 other policies looked like per-row helper calls in a first pass.
They are not. Their helper calls sit in an uncorrelated subquery
(`"companyId" IN (SELECT DISTINCT unnest(…))`), which Postgres runs once.

### 4. Queries inside loops

A static scan found 300 loops with a database call in the loop body. Spot
checks confirmed per-item queries, not batch writes. The full list is in the
appendix.

| Function | Loops | Effect |
|----------|-------|--------|
| `importCsvTable` (`shared.service.ts`) | 12 | One `UPDATE` per CSV row. A file of 3,000 rows runs 3,000 statements. |
| `traverseMethod` (`production.service.ts`) | 16 | Get Method inserts per operation and per material at each BOM level. |
| `postShipment` (`inventory.service.ts`) | 29 | Per line and per tracked unit, including batch splits. |
| `postReceipt` (`inventory.service.ts`) | 10 | Per line. |
| `postPurchaseInvoice`, `postSalesInvoice` (`invoicing.service.ts`) | 8, 7 | Per line. |
| `issueMaterial` (`inventory.service.ts`) | 6 | Per material. |
| `createDocument` (`shared.service.ts`) | 11 | Per supplier and per line when a document is converted. |
| `postInventoryCount` (`inventory.service.ts`) | — | Per line: `bookAdjustment` and a `trackedEntity` lock. |

By area: inventory 59, jobs 51, shared 41, production 38, accounting 18,
invoicing 18, sales 16, planning 15, purchasing 12, settings 10, ee 9.

The fix pattern: collect the ids, then use one `.in()` read, one multi-row
`INSERT`, or one `UPDATE … FROM (VALUES …)` (`.claude/rules/database-patterns.md`).

### 5. Views to rewrite per row

Measure first. Each rewrite trades faster pages for slower reads over every
row (lessons 5 and 6).

| View | Groups | Default sort and index | Reads over every row |
|------|--------|------------------------|----------------------|
| `salesInvoices` | `salesInvoiceLine`; settlements in a CTE | `invoiceId DESC`; `salesInvoice("invoiceId")` | `payment-application.ts`, `postPaymentTransaction`, `getSettlementRelatedItems`, `getSalesOrderInvoicesByIds` |
| `quotes` | `quoteLine` (`lines`, `completedLines`, thumbnail) | `quoteId DESC`; `quote("quoteId", "companyId")` | none found |

### 6. Text search on lists

85 list searches use `ilike '%text%'`. The only trigram indexes are on the
search index (`title`, `description`). A search therefore filters each row of
the company. A `pg_trgm` GIN index on the common search columns fixes this
when companies grow.

## Not worth changing now

| Item | Reason |
|------|--------|
| The 6 item views (`parts`, `materials`, `tools`, `consumables`, `services`, `preserves`) | #1343 measured the rewrite as flat (123 → 121 ms). Their cost is the `DISTINCT ON` and the revisions aggregate. |
| `issues` as a per-row view | The quality KPI and dashboard read every issue. |
| `supplierQuotes`, `processes`, `workCenters`, `changeOrders`, `customFieldTables`, `qualityActions` as per-row views | Child tables under 1,100 rows per company. Fix item 2 first. |
| `inventoryCountGroups` | The view is the grouping. There is no page to compute first. |
| Planning grids (`get_*_planning_grid`) | They total by design and are scoped per location and item. |
| `get_inventory_quantities` | Callers pass `item_id`. |
| MES app | It selects narrow columns and reads no heavy views. |
| Browser stores (`customers`, `items`, `people`, `suppliers`) | They load whole tables, but #1843 re-fetches only when the checksum changes. |
| Dashboard exact counts | They count base tables with indexes, except the `issues` counts (item 2). |

## How to measure

1. Run the benchmark script against a local database with seed data:

   ```bash
   psql "$DB_URL" -v user_email=test@carbon.ms -v newview=new_view.sql \
     -v copies=6000 -v companies=96 -v own_every=10 \
     -f .ai/runs/2026-11-03-purchase-invoices-view-bench.sql
   ```

2. Run it again with `own_every=100` for a small company.
3. Compare the six query shapes, with and without the index.
4. Adapt the copy step and the shapes for another view.

## Appendix: loops with a database call

Static scan of `apps/erp/app`, `apps/mes/app`, `packages/jobs/src`,
`packages/ee/src`, `packages/database/src` and `packages/planning/src`. Each
line is `file:line  function  (database calls in the loop body)`. A batch loop
that writes one page at a time can appear here. Check each loop before you
change it.

```text
apps/erp/app/modules/accounting/accounting.service.ts:3366  closeAccountingPeriod  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:9527  getJournalSyncCompleteness  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:9547  getJournalSyncCompleteness  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:9835  getAccountingSyncTieOutCell  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:9857  getAccountingSyncTieOutCell  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:10870  postDepreciationRun  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:10900  postDepreciationRun  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:10945  postDepreciationRun  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:11322  postRevenueRecognitionRun  (4 calls)
apps/erp/app/modules/accounting/accounting.service.ts:11585  reverseRunJournals  (3 calls)
apps/erp/app/modules/accounting/accounting.service.ts:17135  writeLegacyMovementCosts  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:19806  insertProvisionalJournals  (2 calls)
apps/erp/app/modules/accounting/accounting.service.ts:19832  insertProvisionalJournals  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:19968  keepOutOfProviderSync  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:20692  postRecostJournals  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:20910  activateAccounting  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:21046  markIgnoredInvoicesPaid  (1 calls)
apps/erp/app/modules/accounting/accounting.service.ts:21054  markIgnoredInvoicesPaid  (1 calls)
apps/erp/app/modules/inventory/inventory.server.ts:1148  assignReceiptReturnEntity  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:2420  getStockMovementEffectiveQuantity  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:3306  setInventoryCountUnnumberedQuantity  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:7227  runLineageBfs  (6 calls)
apps/erp/app/modules/inventory/inventory.service.ts:11959  postReceipt  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:12021  postReceipt  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:12477  postReceipt  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:12495  postReceipt  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:13652  postReceipt  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:13663  postReceipt  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:13846  postReceipt  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:14332  postReceipt  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:14458  postReceipt  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:14696  postReceipt  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:16493  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:16584  postShipment  (6 calls)
apps/erp/app/modules/inventory/inventory.service.ts:16725  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:16761  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:16776  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:17029  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:17081  postShipment  (6 calls)
apps/erp/app/modules/inventory/inventory.service.ts:17199  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:17230  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:17348  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:17596  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:17691  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18091  postShipment  (5 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18179  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18254  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18313  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18339  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18787  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18875  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:18916  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19184  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19239  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19271  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19393  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19515  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19653  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19871  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:19989  postShipment  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:20053  postShipment  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:22609  returnTrackedAllocationRemainder  (9 calls)
apps/erp/app/modules/inventory/inventory.service.ts:22877  returnUntrackedMaterialRemainder  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:22990  runReturnSweep  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:23014  runReturnSweep  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:23222  applyScrapReplacement  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:23281  applyScrapReplacement  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:23481  issueJobOperationMaterials  (3 calls)
apps/erp/app/modules/inventory/inventory.service.ts:23737  issueJobOperationMaterials  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:23989  createMaterialWipEntries  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:24788  consumeTrackedEntitiesIntoOperation  (6 calls)
apps/erp/app/modules/inventory/inventory.service.ts:27179  issueMaterial  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:27371  issueMaterial  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:27520  issueMaterial  (1 calls)
apps/erp/app/modules/inventory/inventory.service.ts:28150  issueMaterial  (6 calls)
apps/erp/app/modules/inventory/inventory.service.ts:28463  issueMaterial  (2 calls)
apps/erp/app/modules/inventory/inventory.service.ts:28667  issueMaterial  (1 calls)
apps/erp/app/modules/invoicing/invoicing.server.ts:1333  mapPurchaseInvoiceLines  (2 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:8777  postSalesInvoice  (2 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:8823  postSalesInvoice  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:8843  postSalesInvoice  (3 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:8902  postSalesInvoice  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:9705  postSalesInvoice  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:9726  postSalesInvoice  (3 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:9959  postSalesInvoice  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:13462  loadLeasePostingFacts  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:13477  loadLeasePostingFacts  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:14992  postPurchaseInvoice  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:15004  postPurchaseInvoice  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:15015  postPurchaseInvoice  (2 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:15094  postPurchaseInvoice  (2 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:15129  postPurchaseInvoice  (3 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:16153  postPurchaseInvoice  (2 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:16198  postPurchaseInvoice  (1 calls)
apps/erp/app/modules/invoicing/invoicing.service.ts:16218  postPurchaseInvoice  (2 calls)
apps/erp/app/modules/items/items.server.ts:370  updateItems  (1 calls)
apps/erp/app/modules/items/items.service.ts:3765  matchItemIdByText  (2 calls)
apps/erp/app/modules/items/items.service.ts:3825  matchItemIdByText  (1 calls)
apps/erp/app/modules/items/items.service.ts:3852  resolveItemIdFromExtractedText  (2 calls)
apps/erp/app/modules/items/items.service.ts:4226  findSupersessionCycle  (1 calls)
apps/erp/app/modules/items/items.service.ts:10527  copyMakeMethodOperations  (7 calls)
apps/erp/app/modules/production/production.server.ts:284  releaseCheckedJobs  (1 calls)
apps/erp/app/modules/production/production.server.ts:470  releaseJobs  (1 calls)
apps/erp/app/modules/production/production.server.ts:1567  deleteJobs  (1 calls)
apps/erp/app/modules/production/production.service.ts:356  convertSalesOrderLinesToJobs  (5 calls)
apps/erp/app/modules/production/production.service.ts:6674  setPeopleDay  (2 calls)
apps/erp/app/modules/production/production.service.ts:6711  setPeopleDay  (1 calls)
apps/erp/app/modules/production/production.service.ts:7130  movePeopleWeek  (2 calls)
apps/erp/app/modules/production/production.service.ts:9418  reassignAssemblyStepComponents  (2 calls)
apps/erp/app/modules/production/production.service.ts:9504  reassignAssemblyStepComponents  (1 calls)
apps/erp/app/modules/production/production.service.ts:10932  syncAssemblyInstructionToOperation  (1 calls)
apps/erp/app/modules/production/production.service.ts:10977  syncAssemblyInstructionToOperation  (2 calls)
apps/erp/app/modules/production/production.service.ts:11143  syncAssemblyInstructionToOperation  (2 calls)
apps/erp/app/modules/production/production.service.ts:14342  getMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:15117  traverseMethod  (2 calls)
apps/erp/app/modules/production/production.service.ts:16036  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:16971  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:17335  logTree  (1 calls)
apps/erp/app/modules/production/production.service.ts:17547  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:17756  traverseMethod  (1 calls)
apps/erp/app/modules/production/production.service.ts:17997  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:18327  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:18950  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:19332  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:19537  traverseMethod  (2 calls)
apps/erp/app/modules/production/production.service.ts:19873  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:20209  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:20742  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:21143  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:21465  traverseMethod  (1 calls)
apps/erp/app/modules/production/production.service.ts:21681  traverseMethod  (3 calls)
apps/erp/app/modules/production/production.service.ts:22419  treeItemIds  (5 calls)
apps/erp/app/modules/production/production.service.ts:22709  insertDeferredJobMaterials  (1 calls)
apps/erp/app/modules/production/production.service.ts:22712  insertDeferredJobMaterials  (1 calls)
apps/erp/app/modules/production/production.service.ts:23484  recalculatePriorities  (1 calls)
apps/erp/app/modules/production/production.service.ts:23612  rescheduleJob  (1 calls)
apps/erp/app/modules/production/production.service.ts:24626  cloneReworkOperations  (1 calls)
apps/erp/app/modules/production/production.service.ts:25532  completeBatch  (1 calls)
apps/erp/app/modules/production/production.service.ts:25874  batchOperation  (1 calls)
apps/erp/app/modules/purchasing/purchasing.server.ts:3225  orderPlannedPurchases  (1 calls)
apps/erp/app/modules/purchasing/purchasing.server.ts:3244  orderPlannedPurchases  (1 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:2293  updatePurchaseOrderLineRestatingCompletion  (2 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:2646  applyPurchasingPlanningActions  (2 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:2755  applyPurchasingPlanningActions  (1 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:4387  confirmPurchaseReturnOrder  (5 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:7276  finalizeSupplierQuote  (1 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:8022  updatePurchasedPrices  (1 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:8037  updatePurchasedPrices  (1 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:8065  updatePurchasedPrices  (1 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:8076  updatePurchasedPrices  (1 calls)
apps/erp/app/modules/purchasing/purchasing.service.ts:10800  draftLeaseInvoices  (6 calls)
apps/erp/app/modules/quality/quality.service.ts:4416  closeIssue  (4 calls)
apps/erp/app/modules/resources/resources.service.ts:3208  postMaintenanceEvent  (2 calls)
apps/erp/app/modules/resources/resources.service.ts:3248  postMaintenanceEvent  (2 calls)
apps/erp/app/modules/sales/sales.service.ts:3240  upsertCustomerItemPriceOverride  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:5221  recalculateQuoteLinePrices  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:7271  confirmSalesReturnOrder  (5 calls)
apps/erp/app/modules/sales/sales.service.ts:7683  getShippedTrackedEntitiesForCustomer  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:8032  createReplacementSalesOrder  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:10217  loadReferences  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:10247  loadReferences  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:10274  loadReferences  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:10366  importQuoteGroups  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:10803  duplicatePriceOverrides  (4 calls)
apps/erp/app/modules/sales/sales.service.ts:11823  releaseContractSalesOrderLines  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:14741  returnRentalUnit  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:15859  activate  (1 calls)
apps/erp/app/modules/sales/sales.service.ts:16003  commenceSalesTypeLines  (3 calls)
apps/erp/app/modules/sales/sales.service.ts:17706  resolveInvoiceIds  (2 calls)
apps/erp/app/modules/sales/sales.service.ts:19848  renewDueTerms  (4 calls)
apps/erp/app/modules/settings/backups.service.ts:123  listCompanyBackupFolders  (1 calls)
apps/erp/app/modules/settings/settings.service.ts:5614  pushOnshapePart  (1 calls)
apps/erp/app/modules/settings/settings.service.ts:6543  pushOnshapeAssembly  (2 calls)
apps/erp/app/modules/settings/settings.service.ts:6597  pushOnshapeAssembly  (2 calls)
apps/erp/app/modules/settings/settings.service.ts:6753  pushOnshapeAssembly  (1 calls)
apps/erp/app/modules/settings/settings.service.ts:6788  pushOnshapeAssembly  (1 calls)
apps/erp/app/modules/settings/settings.service.ts:7021  linkChildParts  (1 calls)
apps/erp/app/modules/settings/settings.service.ts:8045  pushOnshapeRelease  (1 calls)
apps/erp/app/modules/settings/settings.service.ts:8060  pushOnshapeRelease  (1 calls)
apps/erp/app/modules/settings/settings.service.ts:8075  pushOnshapeRelease  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:3638  importMethods  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:4393  writeGroup  (4 calls)
apps/erp/app/modules/shared/shared.service.ts:4651  writeGroup  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:4693  writeGroup  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:4727  writeGroup  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:4974  loadOperationChildren  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:5379  importStockQuantities  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:5439  importStockQuantities  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:5483  importStockQuantities  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:5516  importStockQuantities  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:6476  writeSupplierPartLinks  (2 calls)
apps/erp/app/modules/shared/shared.service.ts:6545  writeItemPurchasingLeadTimes  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:6573  writeItemUnitCosts  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:6606  writeItemPlanningOrderMultiples  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:6952  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:7161  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:7841  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:7850  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:7868  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:8010  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:8132  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:8247  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:8356  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:8483  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:8682  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:8706  importCsvTable  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:9806  convertDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:10193  convertDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:10373  convertDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:11738  createDocument  (4 calls)
apps/erp/app/modules/shared/shared.service.ts:12822  createDocument  (2 calls)
apps/erp/app/modules/shared/shared.service.ts:13512  createDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:13532  createDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:13536  createDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:13700  createDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:13926  createDocument  (5 calls)
apps/erp/app/modules/shared/shared.service.ts:13939  createDocument  (4 calls)
apps/erp/app/modules/shared/shared.service.ts:14018  createDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:14239  createDocument  (4 calls)
apps/erp/app/modules/shared/shared.service.ts:14314  createDocument  (1 calls)
apps/erp/app/modules/shared/shared.service.ts:16645  loadOpenCostLayers  (1 calls)
apps/erp/app/modules/users/users.service.ts:3087  selectUsersForBulkAction  (1 calls)
apps/erp/app/modules/users/users.service.ts:3106  selectUsersForBulkAction  (1 calls)
packages/database/src/methods.ts:733  calculateQuoteLinePrices  (1 calls)
packages/database/src/utils.ts:119  fetchAllRecords  (1 calls)
packages/ee/src/accounting/core/dimension-mapping.ts:572  resolveDimensionValueLabels  (1 calls)
packages/ee/src/accounting/providers/xero/entities/purchase-order.ts:555  ?  (1 calls)
packages/ee/src/paperless-parts/lib/lib.ts:2670  insertOrderLines  (3 calls)
packages/ee/src/paperless-parts/lib/lib.ts:2715  insertOrderLines  (2 calls)
packages/ee/src/paperless-parts/lib/lib.ts:2974  getOperationRates  (3 calls)
packages/ee/src/paperless-parts/lib/lib.ts:2999  getOperationRates  (3 calls)
packages/ee/src/paperless-parts/lib/lib.ts:3123  traverseComponent  (1 calls)
packages/ee/src/workflows/sync.ts:106  reconcileWorkflowSubscriptions  (1 calls)
packages/ee/src/workflows/sync.ts:124  reconcileWorkflowSubscriptions  (1 calls)
packages/jobs/src/inngest/functions/events/audit.ts:84  ?  (1 calls)
packages/jobs/src/inngest/functions/events/audit.ts:116  ?  (1 calls)
packages/jobs/src/inngest/functions/events/audit.ts:178  ?  (1 calls)
packages/jobs/src/inngest/functions/events/audit.ts:506  applyFkSnapshots  (3 calls)
packages/jobs/src/inngest/functions/events/search.ts:53  ?  (2 calls)
packages/jobs/src/inngest/functions/integrations/accounting-consolidation.ts:135  getJournalPostingDates  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-journal-backfill.ts:113  ?  (2 calls)
packages/jobs/src/inngest/functions/integrations/accounting-outbound-sweep.ts:128  pageIds  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-pull-sweep.ts:146  filterChangesByDependencyMapping  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-pull-sweep.ts:150  filterChangesByDependencyMapping  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts:156  getCarbonJournalData  (2 calls)
packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts:300  getBackingDocumentDelivery  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts:324  getBackingDocumentDelivery  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts:413  computeTieOutForCompany  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts:449  computeTieOutForCompany  (1 calls)
packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts:476  computeTieOutForCompany  (1 calls)
packages/jobs/src/inngest/functions/integrations/oee-sync-device.ts:97  syncOeeDevice  (1 calls)
packages/jobs/src/inngest/functions/integrations/oee-sync-device.ts:376  syncOeeDevice  (6 calls)
packages/jobs/src/inngest/functions/integrations/oee-sync.ts:74  ?  (1 calls)
packages/jobs/src/inngest/functions/integrations/onshape-backfill.ts:250  matchOnshapeBackfillPage  (1 calls)
packages/jobs/src/inngest/functions/integrations/ramp-sync-bill.ts:241  attachBillDocuments  (1 calls)
packages/jobs/src/inngest/functions/integrations/ramp-sync-card.ts:61  attachReceipts  (1 calls)
packages/jobs/src/inngest/functions/integrations/ramp-sync-outbound.ts:71  pageOutboundIds  (1 calls)
packages/jobs/src/inngest/functions/integrations/ramp-sync-repayment.ts:112  syncRampRepayments  (2 calls)
packages/jobs/src/inngest/functions/integrations/reconcile-executor.ts:245  reconcileEntities  (4 calls)
packages/jobs/src/inngest/functions/integrations/timecard-auto-close.ts:38  ?  (4 calls)
packages/jobs/src/inngest/functions/integrations/timecard-auto-close.ts:60  ?  (3 calls)
packages/jobs/src/inngest/functions/notifications/notify.ts:496  getCompanyIntegrations  (2 calls)
packages/jobs/src/inngest/functions/notifications/notify.ts:534  getCompanyIntegrations  (2 calls)
packages/jobs/src/inngest/functions/notifications/notify.ts:595  getCompanyIntegrations  (1 calls)
packages/jobs/src/inngest/functions/notifications/notify.ts:633  getCompanyIntegrations  (1 calls)
packages/jobs/src/inngest/functions/scheduled/agent-thread-retention.ts:29  purgeStaleAgentThreads  (2 calls)
packages/jobs/src/inngest/functions/scheduled/cleanup.ts:526  findDurableCopies  (1 calls)
packages/jobs/src/inngest/functions/scheduled/company-cleanup.ts:53  getGroupOwners  (1 calls)
packages/jobs/src/inngest/functions/scheduled/company-cleanup.ts:66  getGroupOwners  (1 calls)
packages/jobs/src/inngest/functions/scheduled/dispatch.ts:434  advanceByFrequency  (1 calls)
packages/jobs/src/inngest/functions/scheduled/nightly-replan.ts:83  ?  (1 calls)
packages/jobs/src/inngest/functions/scheduled/notification-digest.ts:160  bucketKey  (5 calls)
packages/jobs/src/inngest/functions/scheduled/notification-digest.ts:306  bucketKey  (1 calls)
packages/jobs/src/inngest/functions/scheduled/purge-company.ts:203  drainFolder  (1 calls)
packages/jobs/src/inngest/functions/scheduled/purge-company.ts:221  drainFolder  (1 calls)
packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts:84  companiesToPropose  (1 calls)
packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts:307  loadShiftScope  (1 calls)
packages/jobs/src/inngest/functions/scheduled/weekly.ts:134  warnInactiveCompanies  (1 calls)
packages/jobs/src/inngest/functions/scheduled/weekly.ts:277  warnInactiveCompanies  (1 calls)
packages/jobs/src/inngest/functions/scheduled/weekly.ts:382  owns  (1 calls)
packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts:216  died  (1 calls)
packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts:244  died  (2 calls)
packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts:282  died  (1 calls)
packages/jobs/src/inngest/functions/tasks/changelog-dispatch.ts:187  planFromLiveFeed  (1 calls)
packages/jobs/src/inngest/functions/tasks/company-restore.ts:126  wipeAndLoad  (1 calls)
packages/planning/src/mrp/mrp.ts:1187  runMrp  (1 calls)
packages/planning/src/mrp/mrp.ts:1205  runMrp  (1 calls)
packages/planning/src/mrp/mrp.ts:1215  runMrp  (1 calls)
packages/planning/src/mrp/mrp.ts:1233  runMrp  (1 calls)
packages/planning/src/mrp/planning-actions.ts:1095  writePlanningActionDiff  (1 calls)
packages/planning/src/mrp/planning-actions.ts:1134  writePlanningActionDiff  (1 calls)
packages/planning/src/mrp/planning-actions.ts:1482  generatePlanningActions  (2 calls)
packages/planning/src/mrp/planning-actions.ts:1719  generatePlanningActions  (1 calls)
packages/planning/src/mrp/planning-actions.ts:1720  generatePlanningActions  (1 calls)
packages/planning/src/scheduling/batch-scheduler.ts:636  placeReleasedBatches  (2 calls)
packages/planning/src/scheduling/master-data-provider.ts:893  toJob  (1 calls)
packages/planning/src/scheduling/persist-location.ts:136  persistLocationWrites  (1 calls)
packages/planning/src/scheduling/persist-location.ts:149  persistLocationWrites  (1 calls)
packages/planning/src/scheduling/persist-location.ts:187  persistLocationWrites  (1 calls)
packages/planning/src/scheduling/persist-location.ts:217  persistLocationWrites  (1 calls)
```
