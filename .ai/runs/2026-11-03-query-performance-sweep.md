# Query performance sweep — run log

Plan: `.ai/plans/2026-11-03-query-performance-sweep.md`
Branch: `perf/query-sweep`

## Task 1

Stack: `crbn up --no-apps` in the worktree, Postgres `postgresql://postgres:postgres@localhost:55478/postgres` (7 seed purchase invoices, 1 company, `test@carbon.ms`).

The harness takes `newview`, `newview_name`, `oldview` and `shapes`. The verify run (600 copies, 96 companies) finished with no error.

Deviation: the plan expected 2 matches of "page 50"; the run prints 6, because 3 of the 6 shapes are named "page 50" and each prints in 2 tables. The plan now says 6.

Gap for later tasks: the copy step seeds purchase invoices only. A task that benchmarks another view must add a copy step for its tables.

## Task 2

The user approved the change (Ask First: RLS).

Call sites switched to `throughIndexed()`: the 9 portal branches of `item` (select, update, delete) and `itemCost` (select, update). Production maximum array size: 561 supplier parts per supplier, 212 customer parts per customer.

Kept on `through()`: `userPermission`, `companyGroup`, `userAttribute` insert/update/delete (not in an `or`); `userAttribute` select and the attribute helpers (in an `or`, but at most 8 attributes per company in production).

Equivalence: 4 personas (employee, supplier portal, customer portal, no access) × `item` select/update/delete and `itemCost` select/update. The md5 of the visible id set is identical for all 20 rows. The supplier branch was opened with a temporary permissive `supplierPart` policy in the rolled-back transaction, as #1343 did.

Timing, 39,039 items over 97 companies, 9,624 sales orders, user company 3,939 items, best of 3:

| Query | old `IN (SELECT …)` | new `= ANY (array_agg)` |
|---|---|---|
| sales orders list page | 1.6 ms | 1.6 ms |
| item list page (filters `companyId`) | 0.0 ms | 1.3 ms |
| item count (filters `companyId`) | 0.7 ms | 0.8 ms |
| all visible items (RLS only) | 3.7 ms | 0.7 ms |

The gain is where the policy alone narrows `item`. A query that filters `companyId` itself is the same. Kept.

Migration: `20261103033108_index-friendly-through.sql` (7 policies on `item` and `itemCost`).

## Task 3

The step 1 query found 154 redundant indexes on the local schema (main's migrations). None is a constraint's index.

Deviation: step 3 compares index sizes. Local tables are near empty, so the sizes come from production's catalog (read-only). 29 indexes are kept because their covering index is more than 3 times their size, for example `itemLedger_companyId_locationId_itemId_idx` (2.0 MB against 8.8 MB) and `journalLineDimension_companyId_idx` (0.9 MB against 18.6 MB).

Dropped: 125, in `20261103033413_drop-redundant-indexes.sql`.

Timing (step 6 and 8): per-company `count(*)` on 10 affected tables, best of 5, before and after: 0.002–0.007 ms both times. The local tables hold a few rows each, so this shows no regression only at that size. The verify query returns 29, the kept indexes.

## Task 4

The step 1 query found 78 tables with no index that starts with `companyId`.

Composite indexes on grouped child tables, measured with `.ai/runs/perf-shapes/child-index-bench.sql` (3,000 copies, 96 companies, user company 10%, as the test user, best of 3):

| List view | Child table | Rows (all / user) | Without | With |
|---|---|---|---|---|
| `issues` | `nonConformanceItem` | 18,006 / 1,806 | 4.2 ms | 3.7 ms |
| `supplierQuotes` | `supplierQuoteLine` | 27,009 / 2,709 | 6.6 ms | 4.4 ms |
| `processes` | `workCenterProcess` (processId) | 45,015 / 4,515 | 10.1 ms | 7.8 ms |
| `workCenters` | `workCenterProcess` (workCenterId) | 45,015 / 4,515 | 7.2 ms | 4.7 ms |

Kept: the 4 composite indexes, in `20261103033846_grouped-child-company-indexes.sql`.

Single `("companyId")` indexes: step 3 found company-scoped reads on 16 tables (`apiKey`, `companyIntegration`, `employeeAbility`, `employeeJob`, `process`, `stockTransfer`, `suggestion`, `supplierProcess`, `supplierQuote`, `tag`, `webhook`, `workCenter`, `materialDimension`, `materialFinish`, `materialGrade`, `materialType`). Measured on 3 of them, with the list's real sort:

| List | Without | With |
|---|---|---|
| `supplierQuotes` | 1.6 ms | 1.5 ms |
| `workCenters` | 1.3 ms | 3.0 ms |
| `processes` | 1.5 ms | 5.6 ms |

Postgres reads the ordered unique index (`name, companyId` or `supplierQuoteId, companyId`) and stops at the page size. With a company index it switches to that index and sorts. Rule 3: no gain, so none of the 16 is added. The other 13 lists have the same shape (sorted by a column a unique index covers), so they are skipped on the same evidence.

Skipped with no company-scoped read (read by a parent id or a user id): the other 58 tables. The verify query returns 75 = 78 − 3 tables that got an index.

The heuristic matched `nonConformanceActionTask` and `invite` through views whose main table is another table; both are skips.

## Task 5

The step 1 query found 504 foreign keys with no index that starts with their columns. 252 are on tables over 1,000 rows in production. (Step 1's text says "over 1,000 rows"; its SQL lost that filter, so the filter uses production row counts.)

Step 3 classification on those 252:

- A read filters on the column: 63. Of these, 14 are already served by an index that starts with the key's first column (for example the 1:1 tables keyed by `customerId`), and 5 by an index that starts with `("companyId", <column>)`. 44 remain.
- Parent deleted by the app, no read on the column: 134. Skipped. Deviation: the plan's rule would index these. They are keys to `user`, `unitOfMeasure`, `account` and lookup tables, deleted rarely, on large child tables (for example `jobMaterial`, 56,038 rows) where every insert and update pays for the index. Rule 3 asks for a measured gain, and these deletes are not a measured path.
- Neither: 55. Skipped.

Measured with `.ai/runs/perf-shapes/fk-index-bench.sql` (3,000 copies over 96 companies, lookup by the key as the test user, best of 3):

| Key | Rows | Without | With |
|---|---|---|---|
| `supplierPart.supplierId` | 42,014 | 0.43 ms | 0.04 ms |
| `purchaseInvoiceLine.purchaseOrderLineId` | 24,008 | 0.23 ms | 0.07 ms |
| `pickMethod.locationId` | 57,019 | 2.36 ms | 0.09 ms |

`job.salesOrderId` did not run: the copy step clashed with the unique `job_jobId_key`. The 3 measured keys share its shape (a selective lookup by a key), so it is kept.

Migration: `20261103034328_foreign-key-indexes.sql`, 44 indexes. Each one exists on its table and column (checked by name, table and first column).

## Task 6

`pnpm run generate:types`: no change (indexes and policies change no types). `pnpm db:check:datasets`: all 5 datasets pass. `pnpm db:check:backups`: restorable. No commit for this task.

## Task 7

Columns kept: the table's accessors and `row.original` fields, the custom field columns (`customFields`), the paging column `name` and `id`. The suppliers rows loader (`withSupplierReportContacts`) needs only `id`.

Dropped from the select: `orderCount` (grouped count), `partCount` (suppliers, grouped count), `externalId` (subquery), `embedding` (suppliers), and the tax, logo, assignee and contact columns no list reads.

Measured on 6,004 customers / 6,611 suppliers / 9,624 sales orders / 7,218 purchase orders over 97 companies, as the test user, `ORDER BY name LIMIT 50`:

| List | `select *` | narrowed |
|---|---|---|
| customers | 1.6 ms | 0.8 ms |
| suppliers | 2.3 ms | 0.7 ms |

`Customer` and `Supplier` are now the full view rows; `CustomerListItem` and `SupplierListItem` follow the getters. Both are registered in `LIST_TABLES`.

Contract note: the `sales_getCustomers` and `purchasing_getSuppliers` operations (API and MCP) now return the narrowed columns, as the 10 lists of #1343 do. The MCP manifest digest changed with them.

## Task 8

Kept: `getContracts` only. The list now selects `CONTRACTS_LIST_COLUMNS`, and Postgres skips one join and two subqueries of `customerContracts`. 5,000 contracts, first page by `createdAt`: 3.3 ms to 1.7 ms. `ContractListItem` now follows the getter.

Plan nodes fell, but timing showed no gain (rule 3, reverted):

| Getter | Plan change | Measured |
|---|---|---|
| `getPurchasingRFQs` | subplans 3 to 1 | 0.077 to 0.058 ms on 5,000 RFQs |
| `getTimecardEntries` | joins 4 to 3 | 0.041 to 0.027 ms on 5,000 entries |
| `getRentalAgreements` | joins 5 to 4 | cost 2,728 to 2,717 |
| `getFleetAssets` | joins 6 to 5 (after adding `status`, `outOfServiceSince`, `itemId`, which the table reads) | cost 159 to 154 |
| `getEmployees` | joins 4 to 1 for the users table; `getPeople` reuses the getter and reads `locationName` and `shiftName`, so the union keeps every join | none |
| `getStockMovements` | joins 5 to 4 | cost 300 to 299 |

Skipped for another reason:

- `getDocuments`: the only removable work is the `lastActivityAt` subquery. The Recent view sorts on it, and the row feeds the preview, edit and move hooks.
- `getKanbans`: no list table reads it. Only the API and MCP use it.

No join or subquery drops: `getLeases`, `getProcesses`, `getIssues`, `getInventoryCountLines`, `getPurchaseReturnOrders`, `getQualityActions`, `getSalesReturnOrders`, `getWorkCenters`, `getSupplierQuotes`, `getTrainings`, `getPickingLists`, `getChangeNotices`, `getContractors`, `getJournalEntries`.

Deviation: the plan keeps a getter when the join count falls. A timing step was added before keeping one, as rule 3 asks.

Contract change: the MCP tool `sales_getContracts` now returns the narrowed columns.

Verify: `list-select-covers-columns` and `run.test.ts` pass (10 tests). `turbo run typecheck --filter=erp`: 0 errors.

## Task 9

Migration `20261103040522_list-search-trigram-indexes.sql`: 10 GIN trigram indexes.

Measured in a rolled-back transaction: 42,000 cloned rows of one company, each with a random code. The search is a 3-letter `ilike` that matches 43 rows. Times are best of 3, first page / count, without and then with the index:

| Index | Before | After |
|---|---|---|
| `item.readableId` | 19.8 / 19.0 ms | 0.06 / 0.04 ms |
| `item.name` | 37.0 / 36.4 ms | 0.06 / 0.04 ms |
| `job.jobId` (through the `jobs` view) | 19.6 / 19.1 ms | 0.45 / 0.28 ms |
| `customer.name` | 15.5 / 14.5 ms | 0.04 / 0.03 ms |
| `supplier.name` | 14.0 / 14.2 ms | 0.04 / 0.03 ms |
| `purchaseInvoice.invoiceId` | 14.7 / 15.1 ms | 0.04 / 0.02 ms |
| `salesInvoice.invoiceId` | 15.9 / 15.6 ms | 0.05 / 0.03 ms |
| `methodOperation.description` | 17.6 / 17.7 ms | 0.05 / 0.03 ms |
| `payment.paymentId` | 15.9 / 16.9 ms | 0.06 / 0.07 ms |
| `memo.memoId` | 14.8 / 15.0 ms | 0.03 / 0.03 ms |

Each index is 2 to 5 MB per 42,000 rows.

EXPLAIN through the list views: `customers`, `suppliers`, `jobs`, `purchaseInvoices` and `salesInvoices` all use the index.

Dropped from the plan's list:

- `jobOperation.description`: the search is scoped to one job, and the `jobId` index serves it.
- `supplierPart.supplierPartId`: an exact match within one supplier, served by the `supplierId` index.

Finding: the item lists (`parts` and its siblings) do not use the item indexes. The views are `DISTINCT ON` over revisions, and the search reads `readableIdWithRevision`, `description` and `supplierIds`. EXPLAIN shows a full scan: 195 ms on 84,000 items. The item indexes still serve the price list's base catalog (0.34 ms) and `matchItemIdByText`. Fixing the item list search needs a view change. Recorded for Task 24.

Verify: 10 `_trgm_idx` indexes outside the search index. The plan's query also counts the two `searchIndex_*` trigram indexes, so it excludes them here.

## Task 10

## Task 11

## Task 12

## Task 13

## Task 14

## Task 15

## Task 16

## Task 17

## Task 18

## Task 19

## Task 20

## Task 21

## Task 22

## Task 23

## Task 24

