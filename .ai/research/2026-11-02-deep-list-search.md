# Research: list search that also matches line values

Date: 2026-11-02. Status: research only. No code changed.

Goal: the search box on a document list also matches values on the document's
lines. Examples: the item number, the item name, the customer part number, the
supplier part number, the line description, the tracking number, the job.
Inventory → Receiving already does this for purchase order lines.

"Not verified" marks each claim that this research did not prove from a file
or a command.

## 1. Prior art: how Receiving searches

| Step | What happens | Evidence |
|---|---|---|
| 1 | The view `purchaseOrderLinesToReceive` has one row per purchase order line. | `packages/database/supabase/migrations/20261026134712_purchase-order-lines-to-receive.sql:7-67` |
| 2 | The view builds `searchText` with `concat_ws('|', …)`. Each value is `regexp_replace(lower(x), '[^[:alnum:]]+', '', 'g')`. | same file `:37-49` |
| 3 | The values are: PO number, supplier name, supplier reference, tracking number, job readable id, item readable id, item name, line description, line supplier part number, `supplierPart` part number. | same file `:39-48` |
| 4 | The `|` separator stops a match that spans two values. | same file `:5-6` |
| 5 | The supplier part number comes from a `LEFT JOIN LATERAL` on `supplierPart` with `LIMIT 1`. | same file `:56-64` |
| 6 | `receivingSearchTerms` splits the input on white space, lower-cases each word, and removes each character that is not a letter or a digit. | `apps/erp/app/modules/inventory/inventory.utils.ts:61`, `:69-77` |
| 7 | The service adds one `.ilike("searchText", "%term%")` per word. PostgREST joins chained filters with AND, so every word must match. | `apps/erp/app/modules/inventory/inventory.service.ts:982-984` |
| 8 | The terms hold only letters and digits, so `%` and `_` cannot occur. The service does not call `escapeLike`. | `inventory.utils.ts:61`, `:75` |
| 9 | `receivingSearchMatches` highlights the matches in the shown text with the same normalization. | `inventory.utils.ts:84-109` |
| 10 | The route reads all lines at once (`SINGLE_LOAD_LIMIT`). It does not page by cursor. | `apps/erp/app/routes/x+/inventory+/receiving.tsx:49-56` |

Other search helpers:

| Helper | Behavior | Evidence |
|---|---|---|
| `searchFilter(columns, term)` | One `.or()` string: each column `ilike %term%`. It escapes `%`, `_`, `\` and quotes the value. The whole input is ONE term. | `packages/utils/src/supabase.ts:28-45` |
| `setSearchFilter(query, search, columns)` | Splits the input into tokens. Each token must match one of the columns. Chained `.or()` calls are ANDed. No punctuation normalization. | `apps/erp/app/utils/query.ts:287-315` |

Note: the JS rule (`\p{L}\p{N}`) and the SQL rule (`[[:alnum:]]`) can differ
for non-ASCII letters. The result depends on the database locale. Not verified.

## 2. The 14 list pages: route and query

All 14 lists load through `loadListPage` with a list registry entry. So all 14
use cursor paging, the background CSV export and the bulk actions. All of them
run the same service function (`.claude/rules/table-infinite-scroll.md:92-97`,
`:218-245`).

| List | Route file (`handle.realtime`) | Registry entry | Service function | Source (`.from`) | Select |
|---|---|---|---|---|---|
| Purchase Orders | `routes/x+/purchasing+/orders.tsx:16` `["purchaseOrder"]` | `utils/list-registry/purchasing.server.ts:32` | `getPurchaseOrders` `modules/purchasing/purchasing.service.ts:596` | view `purchaseOrders` (`:606`) | `PURCHASE_ORDERS_LIST_COLUMNS` |
| Supplier Quotes | `purchasing+/quotes.tsx:16` `["supplierQuote"]` | `purchasing.server.ts:40` | `getSupplierQuotes` `purchasing.service.ts:1163` | view `supplierQuotes` (`:1171`) | `*` |
| Purchasing RFQs | `purchasing+/rfqs.tsx:16` `["purchasingRfq"]` | `purchasing.server.ts:47` | `getPurchasingRFQs` `purchasing.service.ts:3224` | view `purchasingRfqs` (`:3232`) | `*` |
| Purchase Invoices | `invoicing+/purchasing.tsx:16` `["purchaseInvoice"]` | `invoicing.server.ts:48` | `getPurchaseInvoices` `modules/invoicing/invoicing.service.ts:572` | view `purchaseInvoices` (`:581`) | `PURCHASE_INVOICES_LIST_COLUMNS` |
| Purchase Return Orders | `purchasing+/supplier-returns.tsx:16` `["purchaseReturnOrder"]` | `purchasing.server.ts:54` | `getPurchaseReturnOrders` `purchasing.service.ts:3968` | view `purchaseReturnOrders` (`:3978`) | `*` |
| Sales Orders | `sales+/orders.tsx:16` `["salesOrder"]` | `sales.server.ts:41` | `getSalesOrders` `modules/sales/sales.service.ts:1936` | view `salesOrders` (`:1946`) | `SALES_ORDERS_LIST_COLUMNS` |
| Sales Quotes | `sales+/quotes.tsx:16` `["quote"]` | `sales.server.ts:49` | `getQuotes` `sales.service.ts:1492` | view `quotes` (`:1500`) | `QUOTES_LIST_COLUMNS` |
| Sales RFQs | `sales+/rfqs.tsx:16` `["salesRfq"]` | `sales.server.ts:56` | `getSalesRFQs` `sales.service.ts:2152` | view `salesRfqs` (`:2160`) | `*` |
| Sales Invoices | `invoicing+/sales.tsx:16` `["salesInvoice"]` | `invoicing.server.ts:40` | `getSalesInvoices` `invoicing.service.ts:660` | view `salesInvoices` (`:669`) | `SALES_INVOICES_LIST_COLUMNS` |
| Sales Return Orders | `sales+/rmas.tsx:16` `["salesReturnOrder"]` | `sales.server.ts:63` | `getSalesReturnOrders` `sales.service.ts:6874` | view `salesReturnOrders` (`:6884`) | `*` |
| Receipts | `inventory+/receipts.tsx:16` `["receipt"]` | `inventory.server.ts:48` | `getReceipts` `modules/inventory/inventory.service.ts:936` | TABLE `receipt` (`:944`) | `*` |
| Shipments | `inventory+/shipments.tsx:16` `["shipment"]` | `inventory.server.ts:55` | `getShipments` `inventory.service.ts:1786` | TABLE `shipment` (`:1794`) | `*` |
| Jobs | `production+/jobs.tsx:18` `["job"]` | `production.server.ts:94` | `getJobs` `modules/production/production.service.ts:1487` | view `jobs` (`:1493`) | `*` |
| Warehouse Transfers | `inventory+/warehouse-transfers.tsx:16` `["warehouseTransfer"]` | `inventory.server.ts:90` | `getWarehouseTransfers` `inventory.service.ts:2230` | TABLE `warehouseTransfer` (`:2238`) | `*` + 2 location embeds |

Route paths are under `apps/erp/app/routes/x+/`. Registry paths are under
`apps/erp/app/utils/list-registry/`. Service paths are under
`apps/erp/app/modules/`.

## 3. Search today and the values to add

| List | Search columns today | Line table (types) | Useful line values | Header values to add |
|---|---|---|---|---|
| Purchase Orders | `purchaseOrderId`, `supplierReference` via `searchFilter` (`purchasing.service.ts:615`) | `purchaseOrderLine` (`packages/database/src/types.ts:48445`) | item readable id, item name, `description`, `supplierPartId` (line), `supplierPart.supplierPartId` by (`supplierId`, `itemId`) | supplier name, `purchaseOrderDelivery.trackingNumber`, `jobReadableId`. This is the Receiving set. |
| Supplier Quotes | `supplierQuoteId`, `supplierReference` (`purchasing.service.ts:1177`) | `supplierQuoteLine` (`types.ts:66987`) | item readable id, item name, `description`, `supplierPartId`, `supplierPartRevision` | supplier name |
| Purchasing RFQs | `rfqId` only, raw `ilike` without `escapeLike` (`purchasing.service.ts:3237`) | `purchasingRfqLine` (`types.ts:50452`) | item readable id, item name, `description`. The line has no supplier part column. | supplier names through `purchasingRfqSupplier` (one RFQ, many suppliers) |
| Purchase Invoices | `invoiceId` only, raw `ilike` (`invoicing.service.ts:588`) | `purchaseInvoiceLine` (`types.ts:47197`) | item readable id, item name, `description`, PO readable id through `purchaseOrderId`, `supplierPart` by (`supplierId`, `itemId`) | `supplierReference` (not searched today), supplier name |
| Purchase Return Orders | `purchaseReturnOrderId`, `supplierReference` (`purchasing.service.ts:3984`) | `purchaseReturnOrderLine` (`types.ts:49718`) | item readable id, item name. The line has no `description` column. | supplier name, PO readable id through `purchaseOrderId` |
| Sales Orders | `salesOrderId`, `customerReference` (`sales.service.ts:1955`) | `salesOrderLine` (`types.ts:59544`) | item readable id, item name, `description`, customer part number through `customerPartToItem` by (`customerId`, `itemId`), job id through `job.salesOrderLineId` | customer name, `salesOrderShipment.trackingNumber` |
| Sales Quotes | `quoteId`, `customerReference` (`sales.service.ts:1508`) | `quoteLine` (`types.ts:51928`) | item readable id, item name, `description`, `customerPartId`, `customerPartRevision` | customer name |
| Sales RFQs | `rfqId`, `customerReference` (`sales.service.ts:2165`) | `salesRfqLine` (`types.ts:61725`) | `customerPartId`, `customerPartRevision`, `description`, item readable id, item name | customer name |
| Sales Invoices | `invoiceId` only, raw `ilike` (`invoicing.service.ts:676`) | `salesInvoiceLine` (`types.ts:58489`) | item readable id, item name, `description`, SO readable id through `salesOrderId`, customer part number through `customerPartToItem` | `customerReference` (not searched today), customer name |
| Sales Return Orders | `salesReturnOrderId`, `customerReference` (`sales.service.ts:6890`) | `salesReturnOrderLine` (`types.ts:60909`) | item readable id, item name. The line has no `description` column. | customer name, SO readable id through `salesOrderId` |
| Receipts | `receiptId`, `sourceDocumentReadableId` (`inventory.service.ts:953`) | `receiptLine` (`types.ts:54811`) | item readable id, item name, `supplierPart` by (`receipt.supplierId`, `itemId`) | `externalDocumentId` ("External Reference", `modules/inventory/ui/Receipts/ReceiptForm/ReceiptForm.tsx:105-106`), supplier name. `receipt` has no tracking number column (`types.ts:54356`). |
| Shipments | `shipmentId`, `sourceDocumentReadableId` (`inventory.service.ts:1803`) | `shipmentLine` (`types.ts:63113`) | item readable id, item name, customer part number through `customerPartToItem` by (`shipment.customerId`, `itemId`) | `trackingNumber` and `externalDocumentId` (both on `shipment`, `types.ts:62634`, not searched today), customer name |
| Jobs | `jobId` only, raw `ilike` (`production.service.ts:1501`) | No line table is needed. The job's item is on the header. | — | The `jobs` view already has `itemReadableIdWithRevision`, `description` (the item name), `salesOrderReadableId`, `quoteReadableId` (`20261006220401_fleet-bridge.sql:219-236`). It has `customerId` but no customer name. |
| Warehouse Transfers | `transferId`, `reference` (`inventory.service.ts:2248`) | `warehouseTransferLine` (`types.ts:71804`) | item readable id, item name, `notes` | from and to location names |

Notes:

- 4 lists search with a raw `ilike("%" + search + "%")` and no `escapeLike`:
  Purchasing RFQs, Purchase Invoices, Sales Invoices, Jobs (cited above).
- The `searchFilter` lists treat the whole input as one phrase
  (`packages/utils/src/supabase.ts:28-31`). So "BRK 514" does not find BRK-514.
- The column lists come from the generated types. The types can lag behind
  the migrations. Not verified against the live schema.

## 4. How RLS gates the line tables

`company(module)` with no `read` override lets any employee of the company read
(`packages/database/src/authz/rules.ts:275-281`, `:288-308`). Each header list
view is `SECURITY_INVOKER`, so the caller's RLS applies to every joined table
(`.claude/rules/database-migration-patterns.md:89-105`).

| Table | Read rule (`packages/database/src/authz/manifest.ts`) | List permission (registry) | Risk for a search view |
|---|---|---|---|
| `purchaseOrderLine` | `purchasing_view` (`:1173`) | purchasing (`purchasing.server.ts:34`) | None. Header `purchaseOrder` also allows inventory and invoicing (`:1164-1166`). |
| `supplierQuoteLine` | `purchasing_view` (`:1525`) | purchasing | None |
| `purchasingRfqLine` | `purchasing_view` (`:1192`) | purchasing | None |
| `purchaseInvoiceLine` | `invoicing_view` (`:1157`) | invoicing (`invoicing.server.ts:50`) | `supplier` needs `purchasing_view` (`:1481`). An invoicing-only user cannot read the supplier name. |
| `purchaseReturnOrderLine` | any employee (`:1184`) | purchasing | None |
| `salesOrderLine` | `sales_view` (`:1391`) | sales (`sales.server.ts:43`) | None |
| `quoteLine` | `sales_view` (`:1221`) | sales | None |
| `salesRfqLine` | `sales_view` (`:1445`) | sales | None |
| `salesInvoiceLine` | `invoicing_view` (`:1381`) | invoicing (`invoicing.server.ts:42`) | `customer` needs `sales_view` (`:291-295`). |
| `salesReturnOrderLine` | any employee (`:1437`) | sales | None |
| `receiptLine` | `inventory_view` (`:1293`) | inventory (`inventory.server.ts:50`) | `supplier` needs `purchasing_view`. `supplierPart` needs `parts_view` or `purchasing_view` (`:1503-1505`). |
| `shipmentLine` | `inventory_view` or `sales_view` (`:1457-1460`) | inventory (`inventory.server.ts:57`) | `customer` needs `sales_view`. `customerPartToItem` needs `sales_view` or `parts_view` (`:356-363`). |
| `warehouseTransferLine` | `inventory_view` (`:1713`) | inventory | None |
| `item` | any employee of the company (`:702-704`) | — | None |
| `job` | any employee (`:806`) | production | None |

Rule for a search view: use `LEFT JOIN` for `supplier`, `customer`,
`supplierPart` and `customerPartToItem`. Under RLS, a hidden joined row gives
NULL with a `LEFT JOIN`. An `INNER JOIN` drops the whole document from the
list. (SQL join rule; not tested here.) Receiving uses `INNER JOIN "supplier"`
(`20261026134712_…:52`). That is safe there only because the route requires
purchasing view (`receiving.tsx:39-43`).

## 5. Answers to the 5 questions

### Q1. "Every word must match" on a header list

Receiving: see section 1, steps 6-8. A header list cannot use `.in("id",
subquery)`: PostgREST has no subquery filter (the premise of the request; not
verified here). These options exist:

| Option | How | Precedent in the repo | Main cost |
|---|---|---|---|
| A. `searchText` column on the header list view | Add a per-document `searchText` to the view: header values plus `string_agg` over the lines, normalized as in Receiving. The service adds one `.ilike("searchText", …)` per word. | Line aggregates per document already exist in the list views (Q4). | No index. Each search computes the text for each document of the company. |
| B. Separate search view, embedded with `!inner` | View `<doc>Search (id, companyId, searchText)`. Select `<doc>Search!inner()` and filter `.ilike("<doc>Search.searchText", …)`. | `!inner` + filter on the embed: `modules/shared/shared.service.ts:496-502` (`customer!inner`), `production.service.ts:7357-7375`, `:7417` (`workCenter!inner`). Both embed a TABLE from a parent row. | PostgREST must find a relationship between two views. Not verified. |
| C. `.or()` over embedded line columns | `purchaseOrderLine!inner(...)` plus `or=(purchaseOrderId.ilike…, purchaseOrderLine.description.ilike…)` per word. | `.or()` with an embedded column: `sales.service.ts:3343`, `production.service.ts:2634`, `:2784`. All are to-one embeds. | The item name is 2 hops away. The to-many semantics of `or` across an embed are not verified. |
| D. RPC (set-returning function) | A function returns the list rows. `.rpc()` returns a filter builder, so `setGenericQueryFilters` still adds the cursor. | `getJobOperationStepRecords` `production.service.ts:2284-2306`; `getGroups` `modules/users/users.service.ts:447-462`. | One function per list that copies the view's columns. More generated types to keep. |
| E. Two queries | Search the lines, collect document ids, then `.in("id", ids)`. | None found for a list. | The id list has no limit. Long URLs. A word on the header and a word on a line do not combine. |
| F. Stored column + trigram index | A `searchText` column on the header table, kept by triggers, with a `gin_trgm_ops` index. `pg_trgm` exists (`20260419140000_search-trigram-substring.sql:14`, `:26`). | The global search index uses trigram GIN indexes (same file `:26-31`). | Triggers on lines, `item`, `supplierPart`, `customerPartToItem`, `supplier`/`customer` and delivery rows. Risk of stale text. A stored column on `purchaseOrder` shows line values to inventory and invoicing readers (`manifest.ts:1164-1166`). They cannot read the lines today (`:1173`). |

`!inner` in list services: 79 matches in `apps/erp/app` (`grep -rn '!inner'`).
The matches I read embed a parent row (to-one). I found no list service that
filters a header list by its line rows with a to-many `!inner`.
`PurchaseReturnOrderProperties.tsx:120-124` records that a to-many
`purchaseOrderLine!inner(itemId)` filter once emptied a picker by mistake.

### Q2. Does a list already search line values?

| Place | What it searches | Evidence |
|---|---|---|
| Inventory → Receiving | PO line values (section 1) | `inventory.service.ts:982-984` |
| Item lists (parts, materials, consumables, tools, fixtures) | `supplierIds`: the item's supplier part numbers, `string_agg` over `supplierPart` | view `20260824181041_item-views-supplier-ids.sql:114`; search `items.service.ts:932-938` |

No document header list of the 14 searches line values (section 3). The global
search index (`searchIndex` tables) was not checked for line values.

### Q3. Where the part numbers live

| Value | Table and column | Key | Evidence |
|---|---|---|---|
| Customer part number (master) | `customerPartToItem.customerPartId`, `customerPartRevision` | unique (`customerId`, `itemId`) | `20240811231527_convert-rfq.sql:26-38` |
| Customer part number on a quote line | `quoteLine.customerPartId`, `customerPartRevision` | per line | `types.ts:51928` |
| Customer part number on a sales RFQ line | `salesRfqLine.customerPartId`, `customerPartRevision` | per line | `types.ts:61725` |
| Customer part number on a sales order line | No column on `salesOrderLine`. The view `salesOrderLines` joins `customerPartToItem`. | (`customerId`, `itemId`) | `20261006220201_revenue-recognition-core.sql:175`, `:190-191`, `:203` |
| Customer part number on a sales invoice line | No column. The view `salesInvoiceLines` reads it with a subquery, `LIMIT 1`. | (`customerId`, `itemId`) | `20261006221401_sales-invoice-discount-and-ship-to.sql:43-46` |
| Supplier part number (master) | `supplierPart.supplierPartId` | unique (`itemId`, `supplierId`, `companyId`) as `buyMethod_part_supplier_unique` | `20230330024716_parts.sql:449`. I found no later drop of it by grep. |
| Supplier part number on a PO line | `purchaseOrderLine.supplierPartId` (free text). Receiving falls back to `supplierPart` when it is empty. | per line | `types.ts:48445`; `20261026134712_…:29` |
| Supplier part number on a supplier quote line | `supplierQuoteLine.supplierPartId`, `supplierPartRevision` | per line | `types.ts:66987` |

### Q4. A per-document aggregate view

No view builds an aggregated search text per document. These views aggregate
lines per document for other uses:

| View | Aggregate | Evidence |
|---|---|---|
| `purchaseOrders` | `LEFT JOIN LATERAL` over `purchaseOrderLine`: thumbnail, `orderTotal`, quantities | `20260811123616_widen-purchasing-scale.sql:253-276` |
| `salesOrders` | `LEFT JOIN LATERAL` with `array_agg(json_build_object(...))` over `salesOrderLine` | `20260813222930_re-land-sales-order-total-fix.sql:85-106` |
| `salesInvoices` | subquery join with a `lines` JSON aggregate | `20261006221401_sales-invoice-discount-and-ship-to.sql:152-188` |
| `quotes` | subquery join with `COUNT` over `quoteLine` | `20260811123619_widen-sales-production-scale.sql:337-352` |
| `purchaseReturnOrders`, `salesReturnOrders` | `LEFT JOIN LATERAL` with `COUNT` over the lines | `20260908142501_returns-module.sql:781-789`, `:384-392` |
| Item views | `string_agg(supplierPartId, ',') AS "supplierIds"`, searched by the item lists | `20260824181041_item-views-supplier-ids.sql:114` |

All line tables have an index on the header foreign key. Example:
`purchaseOrderLine_purchaseOrderId_idx` (`20230510035345_purchasing.sql:363`),
`warehouseTransferLine_transferId_idx` (`20250726000000_warehouse-transfers.sql:98`).

### Q5. The newest definition of each list view

I ran `grep -l -i -E 'VIEW "?<name>"?'` over the migrations and took the
newest file. The grep cannot see a view that a migration builds inside dynamic
SQL. Not verified for that case.

| Source | Newest definition |
|---|---|
| `purchaseOrders` | `20260811123616_widen-purchasing-scale.sql:195` |
| `supplierQuotes` | `20260811123616_widen-purchasing-scale.sql:467` |
| `purchasingRfqs` | `20260622195346_purchasing-rfq-internal-notes-json.sql:20` |
| `purchaseInvoices` | `20260916143022_invoice-settlement-source-amount-fallback.sql:144` |
| `purchaseReturnOrders` | `20260908142501_returns-module.sql:773` |
| `salesOrders` | `20260813222930_re-land-sales-order-total-fix.sql:25` |
| `quotes` | `20260811123619_widen-sales-production-scale.sql:327` |
| `salesRfqs` | `20250715083911_sales-order-lines.sql:8` |
| `salesInvoices` | `20261006221401_sales-invoice-discount-and-ship-to.sql:63` |
| `salesReturnOrders` | `20260908142501_returns-module.sql:376` |
| `jobs` | `20261006220401_fleet-bridge.sql:207` (uses `j.*`) |
| `receipt`, `shipment`, `warehouseTransfer` | Tables, no view. A view `receipts` exists (`20260417000300_storage-unit-recreate-dependents.sql:1689`), but `getReceipts` reads the table. |

## 6. Realtime

Each list follows its header table only (section 2). Every line table
broadcasts (`packages/database/src/event-system/attachments.ts`: for example
`purchaseOrderLine` `:315`, `salesOrderLine` `:378`, `receiptLine` `:358`).
If a list must refresh when a line changes, add the line table to
`handle.realtime`. Live search results do not need it: a new search runs the
query again.

## 7. Recommendation

Use option A, in these steps:

1. Add a `searchText` column at the end of each header list view. Copy the view from the newest migration in Q5.
2. Build `searchText` as in Receiving: `concat_ws('|', …)` of normalized header values plus a `string_agg` over the lines.
3. Use `LEFT JOIN` for `supplier`, `customer`, `supplierPart` and `customerPartToItem` (section 4).
4. For Receipts, Shipments and Warehouse Transfers, point the list at a view. Today they read tables.
5. Move `receivingSearchTerms` out of the inventory module into a shared util.
6. In each service, replace the `searchFilter` call with one `.ilike("searchText", …)` per word.
7. Give the 9 lists that select `*` an explicit column list, so `searchText` does not go to the browser.
8. Run `EXPLAIN ANALYZE` on the largest seeded company before and after.

Why A: the list stays one PostgREST query. Cursor paging, the count, the CSV
export and the bulk actions keep working, because they all run the same service
function. RLS on the lines applies through `SECURITY_INVOKER`, and the text is
never stale.

Main trade-off: A has no index. Each search builds the text for each document
of the company, so the cost grows with documents × lines. Option F is fast
(trigram index) but needs triggers on 5 or more tables per document type. It
also shows line values to users who cannot read the lines today. Start with A.
Move the biggest lists (Purchase Orders, Sales Orders) to F only if
`EXPLAIN ANALYZE` shows a slow search.

Open points (not verified):

- Postgres may skip the `searchText` aggregate when a query neither selects nor
  filters it. Detail getters read the same views with `*`, for example
  `getPurchaseOrder` (`purchasing.service.ts:580-589`). If Postgres computes the
  text there, use a separate list view instead.
- A new view column must go at the end with `CREATE OR REPLACE VIEW`. The
  `jobs` view uses `j.*`, so it needs `DROP` + `CREATE`.

## Sources

- `packages/database/supabase/migrations/20261026134712_purchase-order-lines-to-receive.sql`
- `apps/erp/app/modules/inventory/inventory.utils.ts`, `inventory.service.ts`
- `apps/erp/app/routes/x+/inventory+/receiving.tsx`
- `packages/utils/src/supabase.ts`, `apps/erp/app/utils/query.ts`
- `apps/erp/app/utils/list-registry/*.server.ts`
- `packages/database/src/authz/manifest.ts`, `rules.ts`
- `packages/database/src/types.ts`, `packages/database/src/event-system/attachments.ts`
- `.claude/rules/table-infinite-scroll.md`, `table-csv-export.md`, `realtime-system.md`, `database-migration-patterns.md`, `conventions-database.md`
