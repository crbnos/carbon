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

`updateRowsById` (`@carbon/database/rows`, beside `updateRows`): one `UPDATE … FROM jsonb_populate_recordset(null::<table>, $json)` per set of columns and 500 rows. Postgres casts every value to its column type from the table's own row type, so no type lookup or `VALUES` casts are needed. Updates to one id merge in order, as row-by-row writes left them.

Changes in `shared.service.ts`:

- The 9 per-row update loops of `importCsvTable` (customer, supplier, item, material, the two contact kinds, work center, process, storage unit) call `updateRowsById`.
- `writeCustomerExtensions` and `writeSupplierExtensions` became one `writePartnerExtensions`:
  - address updates by id
  - new address ids drawn in one `SELECT id('addr') FROM generate_series`, then one address insert and one location insert
  - multi-row upserts for payment terms and supplier shipping (shipping is grouped by the columns the CSV gave)
- `writeGroup` (method import) collects materials, operations, steps, tools and parameters and inserts them in 500-row chunks. Operation ids are drawn first (`id('mop')`), because the child rows need them and RETURNING has no order guarantee. `currentMakeMethodId` and `seedStorageUnitIds` became the batched `currentMakeMethodIds` and `seedStorageUnitIdsByItem`.
- `importStockQuantities` was already chunked. No change.

Measured with the real `importCsvTable` on one connection whose transactions are savepoints in an outer transaction that is rolled back (harnesses in `.ai/runs/perf-shapes/csv-import-bench*.test.ts.txt`):

| Import | Old statements | New statements | Old ms | New ms | Result digest |
|---|---|---|---|---|---|
| 3,000 customers, insert | 9,021 | 45 | 5,281 | 3,759 | same |
| 3,000 customers, update | 9,011 | 29 | 6,572 | 3,775 | same (md5 `962a0891…`) |
| 3,000 suppliers, insert | 11,021 | 49 | 6,155 | 5,527 | same |
| 3,000 suppliers, update | 11,011 | 33 | 7,190 | 7,740 | same (md5 `1762493a…`) |
| BOM, 115 lines on 23 parts | 320 | 160 | 108 | 75 | same |
| Operations, 220 ops + 660 steps + 220 tools + 440 params | 1,657 | 227 | 340 | 131 | same, all 5 tables |

Locally a round trip costs about 0.1 ms, so most of the remaining time is the tables' own triggers. In production a direct Postgres statement costs about 4.5 ms (memory: server function perf), so 11,000 statements are about 50 s of round trips. The batched import removes them.

Left per row, on purpose:

- The item rename loop: it changes a type table's primary key, and it runs only for a renamed item.
- `resolveTypeIds` (storage unit import): it creates a storage type that a later row reuses.
- The storage unit parent pass: it runs outside the insert transaction on purpose, per its comment.

Deviation: `jsonb_populate_recordset` in place of `VALUES` with casts. It is the shape `insertRows` and `updateRows` already use.

Verify: `vitest run app/modules/shared`: 11 files, 169 tests pass. `turbo run typecheck` for `@carbon/database` and `erp`: 0 errors.

## Task 11

`insertOperationChildren` (`production.service.ts`, beside `copyStepSlides`): the parameters, steps, step slides, tools and tool-step links of every operation of one method level, with one insert per table (500-row chunks). Step and tool ids are made in code with `nanoid()`, so nothing pairs RETURNING rows by position. It returns source step id -> new step id for the material step links.

Changes in `getMethod`: all 14 operation-copy sites (job, quote and method targets) now:

1. make the operation ids in code, then insert the operations without RETURNING
2. collect each operation's children
3. call `insertOperationChildren` once per level

Procedure and assembly operations still call their own per-operation helpers: those write their own rows, and the tools they add filter the method tool copy. The recursion stays per level.

`copyMakeMethodOperations` (`items.service.ts`, Onshape sync) selects tools, parameters and steps once with `in`, makes the operation ids in code, and inserts each table once: 4 + 3 statements in place of 7 per operation.

Measured with the real `getMethod` inside one rolled-back transaction (harness `.ai/runs/perf-shapes/get-method-bench.test.ts.txt`). The SAT-1000 tree has 3 levels, 11 items and 62 method operations, and each operation was given 3 steps, 1 tool with a step link, and 2 parameters:

| Flow | Old statements | New statements |
|---|---|---|
| itemToJob (56 job operations) | 306 | 105 |
| itemToQuoteLine | 248 | 86 |
| itemToJobMakeMethod | 57 | 30 |
| itemToQuoteMakeMethod | 37 | 15 |
| quoteLineToQuoteLine | 242 | 38 |
| jobToItem | 215 | 15 |
| jobMakeMethodToItem | failed (see below) | 15 |
| quoteLineToItem | 219 | 15 |
| quoteMakeMethodToItem | 218 | 14 |
| makeMethodToMakeMethod | 37 | 17 |
| itemToItem | 33 | 13 |
| jobToJob | 305 | 52 |
| quoteLineToJob | 254 | 50 |

Results: for every flow, the rows hash the same on old and new code. Ids are left out: rows are keyed by item and operation order. The hashed tables are operations, steps, tools, parameters, tool-step links, materials and make methods. Locally a statement costs about 0.1 ms, so wall time moved little (itemToJob 251 to 227 ms). In production a direct statement costs about 4.5 ms, so itemToJob saves about 0.9 s.

Bug fixed on the way: `jobMakeMethodToItem` (save a job sub-method to its item) wrote the job's steps into `jobOperationStep`, pointing at the new method operations. That breaks the `jobOperation` foreign key, so the save failed for any operation with steps. It now writes `methodOperationStep` with the method step's own columns, as `jobToItem` does. Without steps, old and new hash the same for this flow too (run with `NOSTEPS=1`).

Verify: `vitest run app/modules/production`: 13 files, 166 tests pass. Database tests that cover the production service, method import and Get Method, run in sequence: 10 files, 78 tests pass. The full database suite in sequence (`--fileParallelism=false`): 123 files, 853 tests pass. In parallel the suite shows 15 to 25 timeout failures that move between runs on old and new code alike. `turbo run typecheck --filter=erp`: 0 errors.

## Task 12

`postShipment`, with Tasks 13 and 14 in the same pass (one codemod for all three).

- Every `for (const [id, update] of Object.entries(map))` loop that ran one `UPDATE` per row now calls `updateRowsById`. That is 19 loops over salesOrderLine, purchaseOrderLine, job, jobOperation, warehouseTransferLine, purchaseReturnOrderLine and salesReturnOrderLine.
- The `trackedEntity` update loops that also inserted one activity input or output per unit (8 loops) now run `updateRowsById` and one chunked activity insert.
- The void paths' per-unit "On Hold" or "Consumed" loops (3), per-line return quantity loops (2) and per-row cost ledger copies (2), and the split-edge input insert (1), are batched the same way.

Before batching I checked the statement-level triggers on these tables: the event dispatch, broadcast and change log triggers. They read the `batched_new` and `batched_old` transition tables and take the company from the first row. Every batch is one company, so a multi-row `UPDATE` gives them the same rows that N single-row ones did.

Left per row, with the reason:

- `calculateCOGS` per item: FIFO layer reads and writes, posting logic (out of scope).
- `bookAdjustment` per write-off restore: a posting function, on the void path only.
- Tracked entity splits (`splitInfo`, `trackedEntitySplits`): each split inserts an entity, an activity, then its input and output. The rows of one split link to one another. A post has a few splits, one per partly consumed batch.
- Fixed asset CIP void loops: one row per capitalized asset, rare.

Measured with the real posting functions on a fixture company (`.ai/runs/perf-shapes/posting-bench.test.ts.txt`). Statements are counted with `pg_stat_statements`. Rows are digested without ids or timestamps: item ledger, cost ledger, journals and journal lines, order lines, shipment and receipt lines, item cost. The digests are the same on old and new code.

| Post | Old statements | New statements | Old ms | New ms |
|---|---|---|---|---|
| Shipment, 50 sales order lines | 89 | 38 | 76 | 38 |
| Receipt, 50 purchase order lines | 86 | 37 | 72 | 44 |

Verify: the full database suite in sequence: 124 files, 854 tests pass. `vitest run app/modules/invoicing app/modules/inventory` passes. `turbo run typecheck --filter=erp`: 0 errors. Tasks 12 to 14 share one commit: one codemod changed all three files.

## Task 13

Done with Task 12 (same codemods): `postReceipt`'s purchaseOrderLine, salesReturnOrderLine, jobOperation and warehouseTransferLine update loops, its trackedEntity and activity output loops, and the void path's "Consumed" loop. Receipt numbers are in Task 12's table.

Left per row: `calculateCOGS` for negative receipt consumptions (posting logic), the fixed asset CIP void loop, and the inspection number per inspection row (`getNextSequence` returns one number per call, and each row needs its own).

## Task 14

Done with Task 12: the salesOrderLine update loops in `postSalesInvoice` (2) and the purchaseOrderLine loop in `postPurchaseInvoice`. The purchase invoice void path's purchaseOrderLine and purchaseOrder status loops are now `updateRowsById` (hand edit).

Left per row:

- The shipment or receipt number per location (`getNextSequence`, one per location).
- The status check per updated order (`salesOrdersUpdated`, `purchaseOrdersUpdated`): it reads that order's lines, then sets its status. An invoice usually updates one order.
- `calculateCOGS` per direct invoice line (posting logic).
- The cost ledger void loops (adjustment children, self-heal layers): void path only.
- `loadLeasePostingFacts` already reads in chunks of ids (`chunkArray`).
- `mapPurchaseInvoiceLines` (`invoicing.server.ts`): the part-name lookup now reads every name in one query. Creating a part (`upsertPart`) and setting the line's item through the caller's client stay per line, with an error count per line.

## Task 15

`issueJobOperationMaterials` (operation completion backflush):

- The bin reads for a material with no bin of its own were one query each, per material: the default bin, the fullest nettable bin, the proposed bin's on-hand and the nettable on-hand. They are now two reads for all materials, on first use. The ledger totals are grouped by item and bin; the pick method defaults are read for every item. The loop only collects its ledger rows, so each material sees the same on-hand as before.
- The per-material `jobMaterial.quantityIssued` update is one `updateRowsById` after the loop, before the strict and dry-run refusals.

`updatePickMethodDefaultStorageUnits` (`shared.service.ts`): one `INSERT … SELECT … ON CONFLICT ("itemId", "locationId") DO UPDATE` for every ledger row, in place of 2 to 4 statements per row. The nettable and "no other bin in the ledger" tests are in its `WHERE`. Every caller inserts its ledger rows first, so a row never sees another row's write. The 7 loops over `itemLedgerInserts` in the issue paths call it. `updatePickMethodDefaultStorageUnitIfNeeded` now wraps it for the single-row callers.

Other batched loops: the tracked entity parent statuses after a merge (`updateRowsById`), the scrap replacement's job operation quantity bumps (`updateRowsById`), and the maintenance return's per-unit status reset (one `UPDATE … WHERE id IN`).

Measured with the real `issueMaterial` (`jobOperation`) on a fixture job, one operation with 20 materials (`.ai/runs/perf-shapes/issue-bench.test.ts.txt`). Digests of item ledger, cost ledger, journal lines, job materials, pick methods and item cost match the old code.

| Issue | Old statements | New statements |
|---|---|---|
| Complete an operation, 20 materials | 264 | 168 |

Verify: the full database suite in sequence: 123 files, 853 tests pass (it covers the bin cases: strict backflush, non-nettable fullest bin). `turbo run typecheck --filter=erp`: 0 errors.

Left per material:

- `getPickedBudgets` (2 reads): `picked-consumption.ts`, out of scope in the plan.
- `calculateCOGS` and its cost ledger insert and update (5 statements): it consumes FIFO layers in order, and two materials of one item draw on the same layers. A batched version needs its own design and tests.
- `createMaterialWipEntries`, `returnTrackedAllocationRemainder`, `runReturnSweep`, and the tracked child loops in `issueMaterial`: each iteration writes rows that the next one reads (lineage, splits, activities), or calls the COGS path above.

## Task 16

A general codemod (`codemod_collect.py` in the session scratchpad) converts a loop when its only `await` is one insert or one `UPDATE … WHERE id = …` whose result is unused. With no read in the loop, collecting the rows and writing them after it gives the same result. A loop with `try`/`catch` is left alone: its per-row error handling would change.

`shared.service.ts`:

- `convertDocument`: the item model updates (2 loops) and the RFQ line item updates.
- `createDocument`: the tracked entity attribute updates when a shipment is made from a return order (2 loops) or a sales order (2 loops), and the shipment line inserts from a purchase order.
- The receipt line split (hand edit): the copied entities go in one insert and the shrunk parents in one `updateRowsById`.

Left per row:

- The purchase order per supplier and the sales order per job (`createDocument`): each takes a sequence number, and its lines need its id.
- The fulfillment, shipment line and tracked links per make-to-order job (`shipmentFromSalesOrder`): each row needs the previous row's id. Ids made in code would allow one insert per table. That is a larger rewrite, recorded as remaining.
- `convertSalesOrderLinesToJobs`: one job per line, through `invokePosting`, with its own sequence number and serial numbers.
- The storage unit parent link pass (CSV import): it catches each row's error on purpose.

Timing: on the quote-to-sales-order path, the only changed loop is the item model update, which runs only for lines with a 3D model. The demo quotes have none, so a 30-line timing would measure unchanged code. Not timed.

## Task 17

`postInventoryCount`:

- Before the posting loop, the tracked entities of every adjusted line are locked with one `FOR UPDATE` read, in id order. Their ledger totals come from one grouped read.
- The loop keeps a running quantity, status and ledger total per entity. The ledger total adds each line's delta, because the old per-line read ran after that line's ledger row was inserted. An entity with two lines (a batch counted in two bins) sees the first line's result on the second.
- After the loop, one `updateRowsById` writes each entity once, and one writes the count lines' `postedItemLedgerId`.
- `bookAdjustment` stays per line.

Checked before deferring the entity writes:

- `bookAdjustment`, `valueMovement` and `calculateCOGS` write no `trackedEntity` row and read no entity status.
- An `itemLedger` insert stamps the entity's current status (`set_item_ledger_tracked_entity_status`). With deferred writes, a second line on an entity stamps the status from before the loop. But `sync_item_ledger_on_tracked_entity_status_change` rewrites every ledger row of the entity when its status changes. So the old and new code end with every ledger row on the entity's final status.

New database test (`inventory-count-post-tracked.test.ts`): a batch with 6 in bin A and 4 in bin B, counted 5 and 3, posts both lines. The entity quantity and its ledger total are both 8.

Statements: the per-line lock read, the conditional ledger read, the entity update and the line update (3 to 4 per tracked line, 1 per untracked line) become 4 for the whole count. Not timed on 500 lines: the fixture has a few units, and building a 500-unit count was not worth it for a saving that is plain from the code.

Verify: `inventory-count-post-tracked.test.ts` and `inventory-count-scan.test.ts` in sequence: 2 files, 32 tests pass. `turbo run typecheck --filter=erp`: 0 errors.

## Task 18

The same codemod across the ERP modules:

- `accounting.service.ts`: the fixed asset updates (1 loop; the other candidate had more than one await)
- `inventory.service.ts`: the rental agreement line updates (2), the job material and tracked entity updates (2)
- `invoicing.service.ts`: the shipment updates per invoice shipment
- `production.service.ts`: the job operation and tracked entity updates and the activity input inserts (3)
- `purchasing.service.ts`: the supplier part and job operation updates (3)
- `sales.service.ts`: the price break updates and the rental line classifications (2)

`chunked`, `updateRowsById` and the `Database` row types are used as in Tasks 10 to 15.

Caught by the database suite: dropping the codemod's numeric suffixes made two new arrays in `updatePurchasedPrices` shadow the arrays they were filled from (`jobOperationUpdates`, `supplierPartUpdates`). Each loop then walked an empty array and wrote nothing. TypeScript allows the shadow, so the typecheck passed; `supplier-part-currency.test.ts` failed. Both now map the existing arrays. A scan of every array the codemod declared found no other name already used earlier in its function.

Verify: the full database suite in sequence before that fix: 852 of 853 (the failure above); after it `supplier-part-currency.test.ts` passes. ERP unit tests: 103 files, 1,676 tests pass. `turbo run typecheck --filter=erp`: 0 errors.

## Task 19

Changed:

- `timecard-auto-close.ts`: the weekly auto-close read each open entry's employee job and then its shift (2 reads per entry). It now reads both once per company with `in`. The update stays per entry, because each entry gets its own clock-out time and an error log.
- `calculateQuoteLinePrices` (`packages/database/src/methods.ts`): the Kysely path writes the changed buy-material costs with one `updateRowsById`. The PostgREST path keeps one update per row: there is no multi-row update through it.

Left, by class:

- Batch loops (one chunk or page per iteration): `fetchAllRecords`, the MRP upserts in `mrp.ts` (4), `writePlanningActionDiff` (2), `master-data-provider.ts`, `persist-location.ts` (4), the accounting consolidation, backfill, outbound, pull and reconciliation sweeps, `ramp-sync-outbound`, `oee-sync-device` (machine state inserts), `notify.ts` (4), `agent-thread-retention`, `company-cleanup` (2), `dispatch.ts`, `nightly-replan`, `purge-company` (2).
- One query per group (types, tables, companies or locations, a handful each): `resolveDimensionValueLabels`, `applyFkSnapshots`, the audit and search event loops per company, `reconcileEntities`, `filterChangesByDependencyMapping`, `generatePlanningActions` per location, `cleanup.ts` per bucket.
- External calls per row (an API, a file or another service): Paperless Parts part creation (`getOrCreatePart`), `ramp-sync-bill`, `ramp-sync-card`, `ramp-sync-repayment`, `onshape-backfill`, `oee-sync` per device, `changelog-dispatch`, the Xero purchase order line sync.
- A write whose result the next statement needs: `oee-sync-device` per planned write (inserted ids), `placeReleasedBatches` (it checks each update's returned row), `notification-digest` per group.
- Small, rare loops: `reconcileWorkflowSubscriptions` (a few subscriptions per publish), `weekly.ts` warnings, `revenue-recognition-proposal`, `schedule-inputs-changed`, `workflow-run-retention` (already batched per pass), `company-restore` (`wipeAndLoad`, per table).

Verify: `@carbon/database` tests (529) and `@carbon/jobs` tests (1,224) pass. Typecheck `@carbon/database` and `@carbon/jobs`: 0 errors.

## Task 20

The tiles already read little through their views: each selects 2 to 7 columns, and Postgres plans only what those columns need.

| Tile | Plan through the view | Change |
|---|---|---|
| Sales orders (`salesOrders`: orderTotal, orderDate) | `salesOrder` filter, the order-total lateral, the shipment join | none: a base-table rewrite does the same work |
| Purchase orders (`purchaseOrders`) | `purchaseOrder` filter, the order-total lateral, the delivery join | none, same reason |
| Purchase invoices (`purchaseInvoices`) | filters on `Overdue` and `Partially Paid` | none: a computed status keeps the view (plan rule) |
| Issues, weeks open (`issues`) | `nonConformance` alone | none |
| Issues, by date and by type (`issues`) | 2 containment subqueries per issue | dropped `containmentStatus` and `createdAt`: neither tile reads them |

Issues tile on 5,000 cloned issues: 0.86 ms to 0.48 ms.

## Task 21

Reverted: no migration. Neither rewrite meets the keep rule (the 10% company's page faster, and the 1% company's page no more than 2× slower).

Harness: `.ai/runs/2026-11-03-perf-bench-quotes.sql` (the quotes copy of the generic harness), shapes `.ai/runs/perf-shapes/quotes.sql`. 6,000 copies of each quote over 96 companies, 4 lines per quote line, as the test user under RLS, best of 3, in ms. Both rewrites return identical rows (md5 of every column of every row, old view against new).

Rewrite A: `LEFT JOIN LATERAL` with `GROUP BY "quoteId"` inside (keeps NULL for a quote with no lines).

| Shape | 10%: old | 10%: new | 1%: old | 1%: new |
|---|---|---|---|---|
| page 50 | 25.6 | 1.1 | 2.5 | 8.7 |
| status filter | 11.1 | 12.6 | 1.7 | 1.6 |
| count | 0.7 | 58.2 | 0.2 | 6.5 |
| full read | 17.9 | 76.7 | 1.6 | 7.6 |
| sort by lines | 20.8 | 79.9 | 2.0 | 8.0 |
| sort by dueDate | 19.3 | 79.1 | 2.0 | 8.1 |

The `GROUP BY` inside the lateral hides that it returns at most one row, so even a count runs it per quote.

Rewrite B: an aggregate with no `GROUP BY` (one row per quote, so the join can be dropped), with `CASE WHEN count(*) > 0` to keep NULL for a quote with no lines.

| Shape | 10%: old | 10%: new | 1%: old | 1%: new |
|---|---|---|---|---|
| page 50 | 19.7 | 1.5 | 3.3 | 14.8 |
| status filter | 15.9 | 23.5 | 2.4 | 3.0 |
| count | 1.8 | 1.6 | 0.2 | 0.2 |
| full read | 16.8 | 88.8 | 2.3 | 15.6 |
| sort by lines | 20.2 | 101.2 | 2.5 | 14.4 |
| sort by dueDate | 20.5 | 86.1 | 2.6 | 15.0 |

Both rewrites make the large company's first page 13 to 23 times faster. But every other shape, and the small company's page, are 4 to 5 times slower: the per-quote lateral costs more than one hashed `GROUP BY` over all lines as soon as it runs for more than a page. #1343 kept its order rewrites with a sort index that lets the page stop early. A quotes version needs the same index work and its own measurement. Recorded as remaining.

## Task 22

## Task 23

## Task 24

