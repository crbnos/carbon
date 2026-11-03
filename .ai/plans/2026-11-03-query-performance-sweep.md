# Query performance sweep — implementation plan

**Spec:** none. The input is the research file and the user's request: fix every item with a performance benefit, cheap items first.
**Research:** .ai/research/2026-11-03-query-performance-sweep.md
**Closest sibling:** N/A (no record type). The precedent is #1343 (`6fa6d314db`): `*_LIST_COLUMNS`, list indexes, `LATERAL` views, the `item` policy.
**Branch:** `perf/query-sweep`, worktree `/Users/sidwebworks/Documents/crbnos/carbon-query-perf`

## Progress

Phase A — cheap and low risk
- [x] Task 1: Start the local stack and make the benchmark harness generic
- [x] Task 2: Render `through()` policies in the index-friendly form
- [x] Task 3: Drop redundant indexes
- [x] Task 4: Add `companyId` indexes where none leads with it
- [x] Task 5: Index the foreign keys that app reads or parent deletes use
- [x] Task 6: Regenerate types and run the database gates
- [x] Task 7: Narrow the customers and suppliers list selects
- [x] Task 8: Narrow the other list selects that compute unused columns
- [x] Task 9: Add trigram indexes for searches on large tables

Phase B — larger changes
- [x] Task 10: Batch the CSV import writes
- [x] Task 11: Batch the Get Method writes
- [x] Task 12: Batch the shipment posting queries
- [x] Task 13: Batch the receipt posting queries
- [x] Task 14: Batch the invoice posting queries
- [x] Task 15: Batch the material issue queries
- [x] Task 16: Batch the document conversion queries
- [ ] Task 17: Batch the inventory count posting queries
- [x] Task 18: Fix the other loops in the ERP modules
- [ ] Task 19: Fix the loops in jobs, planning, ee and database
- [ ] Task 20: Compute the KPI tiles from base tables
- [ ] Task 21: Rewrite the `quotes` view per row
- [ ] Task 22: Rewrite the `salesInvoices` view per row
- [ ] Task 23: Fix the `purchaseInvoices` regressions from #2107
- [ ] Task 24: Final verification

## Dependencies

- Task 1 comes first: every later task measures with its harness.
- Tasks 2–5 are migrations. Run them in order: each one uses `pnpm db:migrate:new`, and two parallel runs can pick clashing timestamps.
- Task 6 needs Tasks 2–5.
- Tasks 7, 8 and 9 need Task 6. They are independent of each other.
- Tasks 10–19 are independent of each other. They need Task 6 only for a migrated database.
- Task 20 is independent.
- Task 21 needs Task 7's `QUOTES_LIST_COLUMNS` check to stay green.
- Task 22 needs Task 14, because both change invoice code and its tests.
- Task 23 is independent.
- Task 24 needs every other task.

## Rules for every task

1. Read `.ai/research/2026-11-03-query-performance-sweep.md` → "What we learned" and "Benchmark traps" before the first task.
2. Measure before and after each change with the Task 1 harness. Record both numbers in `.ai/runs/2026-11-03-query-performance-sweep.md`.
3. If a change shows no gain in the harness, revert it. Record the numbers and the reason in the run log. A change with no measured gain is not a performance benefit.
4. Never chain Supabase-client writes as a transaction. Use a Kysely transaction (`.claude/rules/database-patterns.md`).
5. Every batched write keeps its `companyId` filter (`.ai/lessons.md` → "Kysely writes in a server function bypass RLS").
6. Never add `CREATE POLICY` to a migration. Policies live in `packages/database/src/authz/` (`.claude/rules/authz-manifest.md`).
7. Typecheck one package at a time: `pnpm exec turbo run typecheck --filter=<pkg> --concurrency=1`.
8. Commit each task through `/check-and-commit`. Write no AI attribution in a commit message.

---

## Task 1: Start the local stack and make the benchmark harness generic

**Depends on:** none
**Files:**
- Modify: `.ai/runs/2026-11-03-purchase-invoices-view-bench.sql` — rename to `.ai/runs/2026-11-03-perf-bench.sql` and make the query shapes come from a file.
- Create: `.ai/runs/2026-11-03-query-performance-sweep.md` — the run log.
- Copy from (precedent): `.ai/runs/2026-11-03-purchase-invoices-view-bench.sql`

**Steps:**
1. In the worktree, run `mise exec node@24 -- crbn up --no-apps`.
2. Read the Postgres URL from the `crbn up` output. Use it as `$DB_URL` in every later task.
3. Run `mv .ai/runs/2026-11-03-purchase-invoices-view-bench.sql .ai/runs/2026-11-03-perf-bench.sql`. The file is untracked, so `git mv` fails.
4. Replace the `INSERT INTO bench_shapes VALUES (…)` statement with `\i :shapes`.
5. Create `.ai/runs/perf-shapes/purchase-invoices.sql` with the six `INSERT INTO bench_shapes` rows you removed.
6. Replace every hard-coded `"purchaseInvoices"` and `"purchaseInvoices_new"` with `:"oldview"` and `:"newview_name"`. This includes the `GRANT SELECT ON "purchaseInvoices_new"` line and the two timing queries.
7. Add a header comment that lists the variables: `user_email`, `newview`, `newview_name`, `oldview`, `shapes`, `copies`, `companies`, `own_every`.
8. Create the run log with a heading per task number.

**Verify:**
```bash
psql "$DB_URL" -v user_email=test@carbon.ms -v newview=/dev/null -v newview_name=purchaseInvoices -v oldview=purchaseInvoices \
  -v shapes=.ai/runs/perf-shapes/purchase-invoices.sql -v copies=600 -v companies=96 -v own_every=10 \
  -f .ai/runs/2026-11-03-perf-bench.sql | grep -c "page 50"
# Expected: 6 (3 "page 50" shapes, once per timing table)
```

If `test@carbon.ms` does not exist in the stack, STOP and report. Do not create a user.

**Out of scope:** any view, index or code change.

---

## Task 2: Render `through()` policies in the index-friendly form

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/authz/rules.ts` — add `throughIndexed()` beside `through()` (line 127)
- Modify: `packages/database/src/authz/manifest.ts` — the call sites that step 3 selects
- Create: a generated migration from `pnpm --filter @carbon/database authz migration index-friendly-through`
- Modify: `packages/database/supabase/tests/authz-pieces.test.sql` — add a check for the new form
- Copy from (precedent): `packages/database/supabase/migrations/20260807093015_item-rls-index-friendly.sql`

Why: `through()` renders `local IN (SELECT …)`. A `BitmapOr` needs an index path in every branch, so an `OR` with this branch forces a scan. #1343 fixed `item` by hand. The manifest later re-rendered it in the slow form. Production keeps the fast form only because no generated migration shipped an `item` block since. The local database already has the slow form.

🛑 This task changes RLS policies. Root `AGENTS.md` says: "Ask before modifying authentication, RBAC, or multi-tenancy logic." Do step 1 before any edit.

**Steps:**
1. Show the user the call sites from step 3 and the expected policy change. Wait for a clear yes.
2. Add `throughIndexed(local, linkTable, linkColumn, condition)` to `rules.ts`. It renders this SQL:
   ```sql
   <local> = ANY (COALESCE((SELECT array_agg(<linkTable>.<linkColumn>) FROM public.<linkTable> WHERE <condition>), '{}'))
   ```
   Keep `through()` as it is. The `IN (SELECT …)` form stays right where the link condition matches many rows.
3. Choose the call sites. For each of the 20 `through()` calls in `manifest.ts`:
   1. If the call is not inside an `or(...)`, keep `through()`. A lone `IN (SELECT …)` becomes a semi-join, which can use an index.
   2. Count the link rows the condition matches for the largest local company and persona.
   3. Run `EXPLAIN ANALYZE` on a list query of the table with each form.
   4. Use `throughIndexed()` only if it is faster and the array has at most 1,000 elements.
   5. Record each call site, the array size and both timings in the run log.
   The expected sites are the portal branches of `item`, `itemCost` and `customerPartToItem`. The `user` rule (`manifest.ts` line 1705) and the attribute rules match every user of a company, so expect to keep `through()` there.
4. Run `pnpm db:migrate` so `authz sync` writes the new policies to the local database.
5. Check the `item` policy:
   `psql "$DB_URL" -Atc "select qual from pg_policies where tablename='item' and cmd='SELECT'"`. It must contain `array_agg`.
6. Prove equivalence for every table whose policy changed. Copy the persona check from the header of `20260807093015_item-rls-index-friendly.sql`. Compare the md5 of the sorted visible id set for 4 personas: employee, supplier portal, customer portal, no access.
7. Add one assertion to `authz-pieces.test.sql` that `throughIndexed` admits a linked row and refuses an unlinked one.
8. Run `pnpm --filter @carbon/database authz migration index-friendly-through`.
9. Measure an `item`-heavy page before and after. Use `.ai/runs/perf-shapes/sales-orders.sql` with the `salesOrders` list query (`SALES_ORDERS_LIST_COLUMNS`, `ORDER BY "createdAt" DESC LIMIT 100`).

**Verify:**
```bash
pnpm --filter @carbon/database test -- src/authz
# Expected: all tests pass, including migration.test.ts
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/authz-pieces.test.sql
# Expected: exits 0
psql "$DB_URL" -Atc "select tablename from pg_policies where schemaname='public' and cmd='SELECT' and qual ~ 'array_agg' order by 1"
# Expected: exactly the tables the run log lists for throughIndexed()
```

If any persona's md5 differs between the old and new policy, STOP and report. Do not ship a policy that changes who sees what.

**Out of scope:** the two quirks recorded in `.ai/plans/2026-08-07-item-rls-index-friendly.md`; the helper functions.

---

## Task 3: Drop redundant indexes

**Depends on:** Task 2
**Files:**
- Create: a migration from `pnpm db:migrate:new drop-redundant-indexes`

An index is redundant when another btree index on the same table starts with the same columns in the same order. About 190 such indexes exist in production (research file, item list in the catalog query below). Each one costs write time and disk.

**Steps:**
1. Run this query against `$DB_URL`. It lists non-unique, non-primary btree indexes with no predicate and no expression, whose columns are a leading prefix of another index:
   ```sql
   WITH idx AS (
     SELECT i.indexrelid, i.indrelid, ic.relname AS idxname, i.indisunique, i.indisprimary,
       (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols,
       i.indpred, i.indexprs, am.amname
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam
   )
   SELECT DISTINCT a.idxname
   FROM idx a JOIN idx b ON a.indrelid = b.indrelid AND a.indexrelid <> b.indexrelid
   WHERE NOT a.indisunique AND NOT a.indisprimary
     AND a.indpred IS NULL AND b.indpred IS NULL AND a.indexprs IS NULL AND b.indexprs IS NULL
     AND a.amname = 'btree' AND b.amname = 'btree'
     AND array_length(a.cols, 1) <= array_length(b.cols, 1)
     AND a.cols = b.cols[1:array_length(a.cols, 1)]
     AND (array_length(a.cols, 1) < array_length(b.cols, 1) OR b.indisunique OR b.indisprimary OR a.idxname > b.idxname)
   ORDER BY 1;
   ```
2. Remove from the list any index that a constraint uses: `SELECT conindid::regclass FROM pg_constraint WHERE conindid <> 0`.
3. Keep an index whose covering index is more than 3 times its size (`pg_relation_size`). A count or an index-only scan on the leading columns reads the narrow index faster.
4. Write one `DROP INDEX IF EXISTS "public"."<name>";` per remaining index in the migration.
5. Add a header comment: the query, the count, and the rule.
6. Before you run the migration, time a per-company `count(*)` and the list query of the 10 largest affected tables.
7. Run `pnpm db:migrate`.
8. Time the same queries again. Restore an index whose drop makes a query slower. Record it in the run log.

**Verify:**
```bash
psql "$DB_URL" -Atc "<the step 1 query>" | wc -l
# Expected: equals the number of indexes the run log keeps in steps 3 and 8
```

**Out of scope:** unique indexes, primary keys, partial indexes, expression indexes.

---

## Task 4: Add `companyId` indexes where none leads with it

**Depends on:** Task 3
**Files:**
- Create: a migration from `pnpm db:migrate:new company-id-indexes`
- Copy from (precedent): `packages/database/supabase/migrations/20260806235710_perf-list-query-indexes.sql`

RLS filters every row by `companyId`. Without an index that starts with it, Postgres scans every tenant's rows (research, lesson 7).

**Steps:**
1. Run this query against `$DB_URL` to list the tables:
   ```sql
   SELECT c.relname FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
   JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'companyId' AND NOT a.attisdropped
   WHERE c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum)
   ORDER BY 1;
   ```
2. For a child table that a view groups by its parent id, index `("companyId", "<parentId>")`. These are:
   - `supplierQuoteLine` → `("companyId", "supplierQuoteId")`
   - `workCenterProcess` → `("companyId", "processId")` and `("companyId", "workCenterId")`
   - `nonConformanceItem` → `("companyId", "nonConformanceId")`
3. For every other table in the list, find a read that filters it by `companyId` and by no more selective key. Such a read is a list getter, a view that scans the table, or a `count`.
4. If no such read exists, skip the table. A 1:1 table read by its parent id (`salesOrderShipment`, `supplierTax`, `customerPayment` and similar) is a skip. Record each skip.
5. Otherwise index `("companyId")`.
6. Name each index `"<table>_companyId_idx"`, or `"<table>_companyId_<column>_idx"` for a composite one.
7. Use `CREATE INDEX IF NOT EXISTS`.
8. Run `pnpm db:migrate`.
9. Measure `issues`, `processes`, `supplierQuotes` and each step 5 read before and after. Use each list's real `ORDER BY` from its `*_PAGING` constant. Drop an index that shows no gain, and record it.

**Verify:**
```bash
psql "$DB_URL" -Atc "<the step 1 query>" | wc -l
# Expected: equals the number of tables the run log records as skipped
```

**Out of scope:** indexes on columns other than `companyId` and the three parent ids above.

---

## Task 5: Index the foreign keys that app reads or parent deletes use

**Depends on:** Task 4
**Files:**
- Create: a migration from `pnpm db:migrate:new foreign-key-indexes`

**Steps:**
1. Run this query to list foreign keys with no index that leads with their columns, on tables over 1,000 rows:
   ```sql
   WITH fk AS (
     SELECT c.conrelid, cl.relname AS tbl, rl.relname AS ref, c.confdeltype,
       (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols, c.conkey
     FROM pg_constraint c
     JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
     JOIN pg_class rl ON rl.oid = c.confrelid
     WHERE c.contype = 'f'
   )
   SELECT tbl, cols, ref, confdeltype FROM fk
   WHERE NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = fk.conrelid
       AND (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] @> fk.conkey
       AND (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] <@ fk.conkey)
     AND cols::text NOT IN ('{companyId}','{createdBy}','{updatedBy}')
   ORDER BY tbl;
   ```
2. For each row, search the code for a read that filters on the column: `git grep -n '"<column>"' -- apps/erp/app apps/mes/app packages/jobs/src packages/ee/src`.
3. Index the foreign key if either condition holds:
   - A read filters the child table on the column (`.eq("<column>"`, `.in("<column>"`, `.where("<column>"`, or a view join on it).
   - The app deletes rows of the parent table (`deleteFrom("<ref>")` or `.from("<ref>").delete()`).
4. Skip the foreign key otherwise. Record each skip and its reason in the run log.
5. Name each index `"<table>_<column>_idx"`. Use `CREATE INDEX IF NOT EXISTS`.
6. Run `pnpm db:migrate`.

Production shows these candidates (`supplierPart.supplierId`, `purchaseInvoiceLine.itemId`, `jobMaterial.storageUnitId`, `jobOperation.processId`, `methodOperation.workCenterId` and more). Step 3 decides each one.

**Verify:**
```bash
grep -c "CREATE INDEX IF NOT EXISTS" packages/database/supabase/migrations/*_foreign-key-indexes.sql
# Expected: equals the number of foreign keys the run log marks "indexed"
```

**Out of scope:** `companyId`, `createdBy`, `updatedBy` foreign keys.

---

## Task 6: Regenerate types and run the database gates

**Depends on:** Tasks 2–5
**Files:**
- Modify: `packages/database/src/types.ts` (generated)

**Steps:**
1. Run `pnpm run generate:types`.
2. Run `pnpm db:check:datasets`.
3. Run `pnpm db:check:backups`.

**Verify:**
```bash
pnpm db:check:datasets && pnpm db:check:backups
# Expected: both exit 0
```

**Out of scope:** hand edits to generated types.

---

## Task 7: Narrow the customers and suppliers list selects

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `getCustomers`, add `CUSTOMERS_LIST_COLUMNS`
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — `getSuppliers`, add `SUPPLIERS_LIST_COLUMNS`
- Modify: `packages/checks/src/conformance/list-select-covers-columns.ts` — `LIST_TABLES`
- Modify: `apps/erp/app/modules/sales/types.ts`, `apps/erp/app/modules/purchasing/types.ts` — split `Customer` / `Supplier` into the full row and a `*ListItem`
- Copy from (precedent): `SALES_ORDERS_LIST_COLUMNS` in `apps/erp/app/modules/sales/sales.service.ts`, `SalesOrderListItem` in `apps/erp/app/modules/sales/types.ts`

Both lists select `*`. The `customers` view computes `orderCount` and the `suppliers` view computes `orderCount` and `partCount` from grouped subqueries. Neither list shows them.

**Steps:**
1. Read `apps/erp/app/modules/sales/ui/Customers/CustomersTable.tsx`. List every `accessorKey`, every `row.original.<field>`, and every `meta.exportValue` field.
2. Add every column of `CUSTOMERS_PAGING` (sort columns and `id`) to that list.
3. Write `const CUSTOMERS_LIST_COLUMNS = "<columns>" as const;` and use it in `getCustomers`.
4. Add `CUSTOMERS_LIST_COLUMNS: \`${UI}/sales/ui/Customers/CustomersTable.tsx\`` to `LIST_TABLES`.
5. Repeat steps 1–4 for suppliers with `apps/erp/app/modules/purchasing/ui/Supplier/SuppliersTable.tsx` and `SUPPLIERS_PAGING`.
6. Fix the type errors by splitting the row types, as #1343 did.
7. Measure each list with a shapes file, with its real select and `ORDER BY`.

**Verify:**
```bash
pnpm --filter @carbon/checks test -- list-select-covers-columns
# Expected: pass
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

**Out of scope:** the detail getters `getCustomer` and `getSupplier`, which keep `*`.

---

## Task 8: Narrow the other list selects that compute unused columns

**Depends on:** Task 6
**Files:**
- Modify: the service file of each getter in the table below — add `<NAME>_LIST_COLUMNS`
- Modify: `packages/checks/src/conformance/list-select-covers-columns.ts` — `LIST_TABLES`
- Copy from (precedent): Task 7

These getters select `*` from a view with joins, subqueries or grouping. Narrow a getter only when the narrowed select lets Postgres drop a join or a subquery.

| Getter | Service file | Route | Table component |
|---|---|---|---|
| `getContracts` | `sales/sales.service.ts` | `x+/sales+/contracts.tsx` | `sales/ui/Contracts/ContractsTable.tsx` |
| `getLeases` | `purchasing/purchasing.service.ts` | `x+/purchasing+/leases.tsx` | `purchasing/ui/Leases/LeasesTable.tsx` |
| `getProcesses` | `resources/resources.service.ts` | `x+/resources+/processes.tsx` | `resources/ui/Processes/ProcessesTable.tsx` |
| `getIssues` | `quality/quality.service.ts` | `x+/quality+/issues.tsx` | read the route for the table |
| `getDocuments` | `documents/documents.service.ts` | find the caller with `git grep -n getDocuments` | read the route |
| `getPurchasingRFQs` | `purchasing/purchasing.service.ts` | `x+/purchasing+/rfqs.tsx` | `purchasing/ui/PurchasingRfq/PurchasingRFQsTable.tsx` |
| `getRentalAgreements` | `sales/sales.service.ts` | `x+/sales+/rental-agreements.tsx` | `sales/ui/Rentals/RentalAgreementsTable.tsx` |
| `getInventoryCountLines` | `inventory/inventory.service.ts` | `x+/inventory-count+/$id.tsx` | `inventory/ui/InventoryCount/InventoryCountLines.tsx` |
| `getPurchaseReturnOrders` | `purchasing/purchasing.service.ts` | `x+/purchasing+/supplier-returns.tsx` | `purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrdersTable.tsx` |
| `getQualityActions` | `quality/quality.service.ts` | `x+/quality+/actions.tsx` | read the route |
| `getSalesReturnOrders` | `sales/sales.service.ts` | `x+/sales+/rmas.tsx` | `sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx` |
| `getWorkCenters` | `resources/resources.service.ts` | `x+/resources+/work-centers.tsx` | `resources/ui/WorkCenters/WorkCentersTable.tsx` |
| `getFleetAssets` | `accounting/accounting.service.ts` | `x+/accounting+/fleet.tsx` | `accounting/ui/FixedAssets/FleetAssetsTable.tsx` |
| `getSupplierQuotes` | `purchasing/purchasing.service.ts` | `x+/purchasing+/quotes.tsx` | `purchasing/ui/SupplierQuote/SupplierQuotesTable.tsx` |
| `getTrainings` | `resources/resources.service.ts` | `x+/resources+/training.tsx` | `resources/ui/Training/TrainingsTable.tsx` |
| `getPickingLists` | `inventory/inventory.service.ts` | `x+/inventory+/picking-lists.tsx` | `inventory/ui/PickingLists/PickingListsTable.tsx` |
| `getChangeNotices` | `items/items.service.ts` | `x+/items+/change-notices+/_index.tsx` | `items/ui/ChangeNotice/ChangeNoticesTable.tsx` |
| `getContractors` | `resources/resources.service.ts` | `x+/resources+/contractors.tsx` | `resources/ui/Contractors/ContractorsTable.tsx` |
| `getEmployees` | `users/users.service.ts` | `x+/users+/employees.tsx` | `users/ui/Employees/EmployeesTable.tsx` |
| `getKanbans` | `inventory/inventory.service.ts` | find the caller | read the route |
| `getStockMovements` | `inventory/inventory.service.ts` | `x+/inventory+/stock-movements.tsx` | read the route |
| `getTimecardEntries` | `people/people.service.ts` | `x+/people+/timecard.tsx` | `people/ui/Timecards/TimecardsTable.tsx` |
| `getJournalEntries` | `accounting/accounting.service.ts` | `x+/accounting+/journals.tsx` | `accounting/ui/JournalEntries/JournalEntriesTable.tsx` |

Paths under "Service file" and "Table component" are relative to `apps/erp/app/modules/`. Routes are relative to `apps/erp/app/routes/`.

**Steps (for each getter):**
1. Read the view's latest definition: the newest migration that creates it (`git grep -l 'VIEW "<view>"' -- packages/database/supabase/migrations | sort | tail -1`).
2. List the view columns that come from a join, a subquery, a `LATERAL` or a `GROUP BY`.
3. Collect the columns the table, its row actions and its CSV export read, as in Task 7 step 1. Add the paging columns.
4. If every column from step 2 is in the step 3 list, skip the getter. Record "no join drops" in the run log.
5. Otherwise run `EXPLAIN` on the view with `*` and with the narrowed columns. Count the plan's join nodes in each.
6. If the count does not fall, skip the getter and record it.
7. Otherwise add the constant, use it in the getter, and register it in `LIST_TABLES`.
8. Fix the row types as in Task 7 step 6.

**Verify:**
```bash
pnpm --filter @carbon/checks test -- list-select-covers-columns
# Expected: pass
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

**Out of scope:** the small lookup lists (material dimensions, finishes, grades, types, shifts, suggestions, serial sequences, gauges, risks, quality documents, inspection documents, sales RFQs). Their views have one join and nothing to drop.

---

## Task 9: Add trigram indexes for searches on large tables

**Depends on:** Task 6
**Files:**
- Create: a migration from `pnpm db:migrate:new list-search-trigram-indexes`
- Copy from (precedent): `packages/database/supabase/migrations/20260419140000_search-trigram-substring.sql`

85 list searches use `ilike '%text%'`. A btree index cannot serve a leading `%`.

**Steps:**
1. Index these base-table columns with `USING GIN ("<column>" gin_trgm_ops)`. Each list search reads them through the named view:
   - `item("readableId")`, `item("name")`
   - `job("jobId")`
   - `customer("name")`, `supplier("name")`
   - `purchaseInvoice("invoiceId")`, `salesInvoice("invoiceId")`
   - `jobOperation("description")`, `methodOperation("description")`
   - `supplierPart("supplierPartId")`
   - `payment("paymentId")`, `memo("memoId")`
2. Name each index `"<table>_<column>_trgm_idx"`.
3. Run `pnpm db:migrate`.
4. Measure each search with a shapes file: the list's real query plus `ilike '%<3 letters>%'`, on 42,000 seeded rows.
5. Drop the index of any search that shows no gain. Record it.

**Verify:**
```bash
psql "$DB_URL" -Atc "select count(*) from pg_indexes where indexdef like '%gin_trgm_ops%' and indexname like '%_trgm_idx'"
# Expected: equals the number of indexes kept in step 5
```

**Out of scope:** the search index (`searchIndex_*`) and tables under 1,000 rows.

---

## Task 10: Batch the CSV import writes

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — `importCsvTable`, `importStockQuantities`, `writeGroup`

`importCsvTable` runs one `UPDATE` per CSV row (`for (const update of customerUpdates)`).

**Steps:**
1. Read every loop in the 3 functions. Their lines are in the research appendix.
2. Group the updates of one table by the set of columns they write.
3. Write each group with one `UPDATE … FROM (VALUES …)` statement per 500 rows inside the existing transaction. Copy the shape from `postInventoryCount` (`UPDATE "inventoryCountLine" AS icl … FROM (VALUES …)`) in `inventory.service.ts`.
4. Cast every `VALUES` column to its target column type: `v."x"::numeric`, `::date`, `::boolean`, `::jsonb`. A `VALUES` list infers `text`, so an uncast numeric or date column fails. Read the types from `information_schema.columns` for the table.
5. Keep `"companyId" = <companyId>` in each `WHERE`.
6. Replace per-row inserts with one multi-row `insertInto(...).values([...])` per 500 rows.
7. Time an import of 3,000 customers before and after. Record both.

**Verify:**
```bash
pnpm --filter erp test -- app/modules/shared
# Expected: pass
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

If a row's `UPDATE` depends on an earlier row's result (an id it creates), STOP and report that loop. Do not batch it.

**Out of scope:** the CSV parser and the column mapping.

---

## Task 11: Batch the Get Method writes

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `traverseMethod` (4 copies), `getMethod`, `logTree`
- Modify: `apps/erp/app/modules/items/items.service.ts` — `copyMakeMethodOperations`

`traverseMethod` inserts per operation and per material at each BOM level (16 loops).

**Steps:**
1. Read each loop listed for these functions in the research appendix.
2. For each level of the BOM, build the rows of every node first.
3. Give each row its id in code with `nanoid()` before the insert, as `production.service.ts` already does. Use that id to link child rows.
4. Insert each table's rows with one `insertInto(...).values([...])`. Do not map `RETURNING` rows by position: Postgres does not guarantee their order.
5. Keep the recursion per level. A child level needs its parent's ids.
6. Time Get Method on a 3-level BOM with 50 operations before and after.

**Verify:**
```bash
pnpm --filter erp test -- app/modules/production
# Expected: pass
SUPABASE_DB_URL="$DB_URL" pnpm --filter erp exec vitest run test/database
# Expected: pass
```

**Out of scope:** the supersession logic in the row builders (`.claude/rules/supersession-system.md`).

---

## Task 12: Batch the shipment posting queries

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `postShipment` (29 loops)

**Steps:**
1. Read each `postShipment` loop in the research appendix.
2. Classify each loop:
   - **Read per item:** collect the ids before the loop. Use one `.in()` or `where(..., "in", ids)` read. Index the result with `indexBy` or `groupBy` from `@carbon/utils`.
   - **Write per item, independent rows:** one multi-row `INSERT` or one `UPDATE … FROM (VALUES …)`.
   - **Write that depends on an earlier iteration:** leave it. Record the reason in the run log.
   - **Lock per item (`FOR UPDATE`):** one `FOR UPDATE` read of all ids, ordered by id.
3. Apply the change per class.
4. Time posting a shipment of 50 lines with 20 tracked units before and after.

**Verify:**
```bash
SUPABASE_DB_URL="$DB_URL" pnpm --filter erp exec vitest run test/database
# Expected: pass
pnpm --filter erp test -- app/modules/inventory
# Expected: pass
```

**Out of scope:** posting rules, ledger amounts, journal shapes.

---

## Task 13: Batch the receipt posting queries

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `postReceipt` (10 loops)

**Steps:**
1. Follow Task 12 steps 1–3 for the `postReceipt` loops.
2. Time posting a receipt of 50 lines before and after.

**Verify:**
```bash
SUPABASE_DB_URL="$DB_URL" pnpm --filter erp exec vitest run test/database
# Expected: pass
```

**Out of scope:** the purchasing conversion factors (`.claude/rules/purchasing-conversion-factors.md`).

---

## Task 14: Batch the invoice posting queries

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — `postPurchaseInvoice` (8 loops), `postSalesInvoice` (7 loops), `loadLeasePostingFacts` (2 loops)
- Modify: `apps/erp/app/modules/invoicing/invoicing.server.ts` — `mapPurchaseInvoiceLines`

**Steps:**
1. Follow Task 12 steps 1–3 for these loops.
2. Time posting a 50-line sales invoice and a 50-line purchase invoice before and after.

**Verify:**
```bash
pnpm --filter erp test -- app/modules/invoicing
# Expected: pass
SUPABASE_DB_URL="$DB_URL" pnpm --filter erp exec vitest run test/database
# Expected: pass
```

**Out of scope:** settlement and currency logic (`.claude/rules/numeric-precision.md`).

---

## Task 15: Batch the material issue queries

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `issueMaterial`, `issueJobOperationMaterials`, `consumeTrackedEntitiesIntoOperation`, `createMaterialWipEntries`, `returnTrackedAllocationRemainder`, `returnUntrackedMaterialRemainder`, `runReturnSweep`, `applyScrapReplacement`

**Steps:**
1. Follow Task 12 steps 1–3 for these loops.
2. Time completing an operation with 20 materials before and after.

**Verify:**
```bash
SUPABASE_DB_URL="$DB_URL" pnpm --filter erp exec vitest run test/database
# Expected: pass
pnpm --filter erp test -- app/modules/inventory
# Expected: pass
```

**Out of scope:** `picked-consumption.ts` budgets and allocation order.

---

## Task 16: Batch the document conversion queries

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — `createDocument` (11 loops), `convertDocument` (3 loops)
- Modify: `apps/erp/app/modules/production/production.service.ts` — `convertSalesOrderLinesToJobs`

**Steps:**
1. Follow Task 12 steps 1–3 for these loops.
2. Time converting a 30-line quote to a sales order before and after.

**Verify:**
```bash
pnpm --filter erp test -- app/modules/shared app/modules/production
# Expected: pass
```

**Out of scope:** document numbering.

---

## Task 17: Batch the inventory count posting queries

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `postInventoryCount`

The posting loop runs `bookAdjustment`, a `trackedEntity` lock, an entity update and a line update per line.

**Steps:**
1. Lock all tracked entities of the planned lines with one `FOR UPDATE` read, ordered by id, before the loop.
2. Read their ledger totals before the loop with one grouped read (`GROUP BY "trackedEntityId"`).
3. Keep `bookAdjustment` per line. It writes cost layers and journal lines in sequence.
4. Keep a running map per entity in memory: quantity and ledger total. After each line, add the line's delta to the entity's ledger total. Pass that running total to `resolveCountedEntity`, because it needs the total after this line's adjustment.
5. One entity can have 2 or more lines (a batch counted in 2 bins). Apply each line to the running map in turn, so the last value holds every line's delta.
6. After the loop, write one row per entity from the map with one `UPDATE … FROM (VALUES …)`. Never put the same entity in `VALUES` twice.
7. Write the `postedItemLedgerId` updates with one `UPDATE … FROM (VALUES …)`.
8. Add a database test: a batch counted in 2 bins posts, and the entity quantity equals its ledger total.
9. Time posting a count of 500 tracked lines before and after.

**Verify:**
```bash
SUPABASE_DB_URL="$DB_URL" pnpm --filter erp exec vitest run test/database/inventory-count-post-tracked.test.ts test/database/inventory-count-scan.test.ts
# Expected: pass
```

**Out of scope:** the posting decisions in `resolveCountedEntity` and `planInventoryCountPost`.

---

## Task 18: Fix the other loops in the ERP modules

**Depends on:** none
**Files:**
- Modify: each file in the research appendix under `apps/erp/app/` that Tasks 10–17 do not cover

**Steps:**
1. Take the appendix lines under `apps/erp/app/` for functions not named in Tasks 10–17.
2. For each loop, follow Task 12 steps 1–3.
3. Leave a loop that pages through results (one `.range()` or one batch per iteration). Record it as "batch loop".
4. Run the module's tests after each file.

**Verify:**
```bash
pnpm --filter erp test
# Expected: pass
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

**Out of scope:** loops in tests.

---

## Task 19: Fix the loops in jobs, planning, ee and database

**Depends on:** none
**Files:**
- Modify: each file in the research appendix under `packages/jobs/src/`, `packages/planning/src/`, `packages/ee/src/`, `packages/database/src/`

**Steps:**
1. Follow Task 18 steps 1–3 for these files.
2. Keep Inngest step boundaries: a batched write inside one `step.run` stays inside that step.

**Verify:**
```bash
pnpm --filter @carbon/jobs test && pnpm --filter @carbon/planning test && pnpm --filter @carbon/ee test && pnpm --filter @carbon/database test
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/jobs --concurrency=1
# Expected: 0 errors
```

**Out of scope:** Inngest concurrency settings.

---

## Task 20: Compute the KPI tiles from base tables

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/api+/sales.kpi.$key.ts`, `apps/erp/app/routes/api+/purchasing.kpi.$key.ts`, `apps/erp/app/routes/api+/quality.kpi.$key.ts`

The tiles read `salesOrders`, `purchaseOrders`, `purchaseInvoices` and `issues` over a whole date range. The per-row views compute every row (research, lesson 5).

**Steps:**
1. For each tile query, list the columns it reads and its filters.
2. If a column exists on the base table (`salesOrder`, `purchaseOrder`, `purchaseInvoice`, `nonConformance`), read the base table instead of the view.
3. If the tile needs a total (`orderTotal`), compute it with one grouped query over the line table, joined to the filtered headers.
4. Keep the same results. Compare the tile output for a seeded company before and after.
5. Time each tile with a shapes file before and after.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

If a tile's status filter uses a computed status (`Overdue`, `Partially Paid`), keep the view for that tile. Record it.

**Out of scope:** the tile UI.

---

## Task 21: Rewrite the `quotes` view per row

**Depends on:** Task 7
**Files:**
- Create: a migration from `pnpm db:migrate:new lateralize-quotes-view`
- Create: `.ai/runs/perf-shapes/quotes.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260807011742_lateralize-order-list-views.sql`

**Steps:**
1. Copy the latest `quotes` definition (`20260811123619_widen-sales-production-scale.sql`).
2. Replace the `quoteLine` `GROUP BY` subquery with a `LEFT JOIN LATERAL` correlated on `"quoteId" = q.id`.
3. Keep every column, name, order and type. Cast a rewritten column to its old type when the type changes (for example `SUM(...)::numeric`). Use `CREATE OR REPLACE VIEW`.
4. Run `pnpm db:migrate` and `pnpm run generate:types`.
5. Prove the output is identical: md5 of every column of every row, old view against new, as #1343 did.
6. Measure 6 shapes with `own_every=10` and `own_every=100`: the list page, a status filter, the count, a full-range read, and sorts by `lines` and by `dueDate`.
7. Keep the rewrite only if the list page is faster for the 10% company and the 1% company is no more than 2× slower. Otherwise revert and record.

**Verify:**
```bash
psql "$DB_URL" -v user_email=test@carbon.ms -v newview=<file> -v newview_name=quotes_new -v oldview=quotes \
  -v shapes=.ai/runs/perf-shapes/quotes.sql -v copies=6000 -v companies=96 -v own_every=10 -f .ai/runs/2026-11-03-perf-bench.sql
# Expected: "page 50" new_ms below old_ms
```

If `CREATE OR REPLACE VIEW` still fails, STOP and report. Do not `DROP` the view: list its dependents first (`.ai/lessons.md` → "`CREATE OR REPLACE VIEW` cannot reorder columns").

**Out of scope:** `quoteLines` and other quote views.

---

## Task 22: Rewrite the `salesInvoices` view per row

**Depends on:** Task 14
**Files:**
- Create: a migration from `pnpm db:migrate:new lateralize-sales-invoices-view`
- Create: `.ai/runs/perf-shapes/sales-invoices.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261102182626_purchase-invoices-purchase-orders.sql` (#2107)

**Steps:**
1. Copy the latest `salesInvoices` definition (`20261006221401_sales-invoice-discount-and-ship-to.sql`).
2. Replace the `settled` CTE and the `salesInvoiceLine` `GROUP BY` subquery with two `LEFT JOIN LATERAL` blocks, as #2107 did for `purchaseInvoices`.
3. Keep every column, name, order, type and computed value. Apply the Task 21 step 3 cast rule.
4. Run `pnpm db:migrate` and `pnpm run generate:types`.
5. Prove identical output with the md5 check from Task 21 step 5.
6. Measure the list page, Overdue filter, count, full read (as `payment-application.ts` reads it) and balance sort, with `own_every=10` and `own_every=100`.
7. Apply the Task 21 step 7 rule.

**Verify:**
```bash
pnpm --filter erp test -- app/modules/invoicing
# Expected: pass
pnpm --filter @carbon/ee test -- src/accounting/core
# Expected: pass
```

If `CREATE OR REPLACE VIEW` still fails, STOP and report, as in Task 21.

**Out of scope:** `purchaseInvoices`. Task 23 covers it.

---

## Task 23: Fix the `purchaseInvoices` regressions from #2107

**Depends on:** Task 1
**Files:**
- Use: `.ai/runs/perf-shapes/purchase-invoices.sql` (Task 1 creates it)
- Create: a migration from `pnpm db:migrate:new purchase-invoices-view-regressions`, only if step 4 finds a fix
- Copy from (precedent): `packages/database/supabase/migrations/20261102182626_purchase-invoices-purchase-orders.sql`

#2107 made the list page faster for large companies. The benchmark found 2 regressions: a small company's page (6.0 → 12.7 ms, 427 invoices) and the Overdue filter (52 → 90 ms, 4,207 invoices).

**Steps:**
1. Rebuild the pre-#2107 view as `"purchaseInvoices_old"` from `20260916143022_invoice-settlement-source-amount-fallback.sql`, inside the harness transaction.
2. Run the harness with `own_every=100` and `own_every=10`, old against current.
3. Read the `EXPLAIN ANALYZE` plan of each slow shape. Note where the per-row `LATERAL` blocks run for rows the page does not return.
4. Try one fix per shape and measure it:
   - Small company: an index that lets the planner stop early, or a `LIMIT`-friendly sort index.
   - Overdue: an index on `("companyId", "dateDue")`, so the filter reads open, past-due invoices first.
5. Keep a fix only if it removes the regression and the large-company page stays near 1.7 ms. Record each try.
6. If no fix works, record the numbers and the reason. Leave the view as it is.

**Verify:**
```bash
psql "$DB_URL" -v user_email=test@carbon.ms -v newview=<file> -v newview_name=purchaseInvoices -v oldview=purchaseInvoices_old \
  -v shapes=.ai/runs/perf-shapes/purchase-invoices.sql -v copies=6000 -v companies=96 -v own_every=100 -f .ai/runs/2026-11-03-perf-bench.sql
# Expected: the run log records the result of each shape
```

**Out of scope:** the purchase order column that #2107 added.

---

## Task 24: Final verification

**Depends on:** Tasks 1–23
**Files:**
- Modify: `.ai/runs/2026-11-03-query-performance-sweep.md` — final table of before and after numbers
- Modify: `.ai/research/2026-11-03-query-performance-sweep.md` — mark each finding done or skipped, with the reason

**Steps:**
1. Run `pnpm test`.
2. Typecheck `erp`, `mes`, `@carbon/jobs`, `@carbon/ee`, `@carbon/database`, one at a time.
3. Run `pnpm run lint`.
4. Run `pnpm db:check:datasets` and `pnpm db:check:backups`.
5. Run `/test` on these flows:
   - the lists: customers, suppliers, quotes, sales invoices, purchase invoices, issues, processes, work centers
   - a CSV export of customers
   - Get Method on a job
   - posting a shipment, a receipt and an inventory count
6. Update `apps/erp/app/modules/*/AGENTS.md` and `.claude/rules/authz-manifest.md` where a task changed a fact they state.

**Verify:**
```bash
pnpm test && pnpm run lint
# Expected: both exit 0
```

**Out of scope:** opening a PR. Ask the user first.
