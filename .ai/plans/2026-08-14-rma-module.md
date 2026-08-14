# Returns module (customer RMAs + supplier returns) — implementation plan

**Spec:** `.ai/specs/2026-08-07-rma-module.md` (merged via PR #1354; approved design — every open question resolved inline)
**Research:** `.ai/research/2026-08-07-rma-module.md`
**Branch:** `returns-module` (off fresh `main`)

## Drift findings — spec assumptions vs current main (resolved here, not silently)

The spec was verified against main (2026-08-14). Everything pre-plumbed that the spec relies on is real: `receiptSourceDocument` + `shipmentSourceDocument` both already contain `'Sales Return Order'` and `'Purchase Return Order'`; `itemLedgerDocumentType` contains `'Sales Return Receipt'` + `'Purchase Return Shipment'`; `disposition` has `'Return to Supplier'` but not `'Return to Customer'`; `memo` has no return-order columns; `accountDefault` has no `salesReturnsAccount`; nothing of the module exists yet. The following spec assumptions drifted; each task below already carries the resolution:

1. **`nonConformanceAssociationType` is a TypeScript const array** (`quality.models.ts:71`), NOT a DB enum. The spec's `ALTER TYPE "nonConformanceAssociationType" ADD VALUE` is impossible. Resolution: add `"salesReturnOrderLines"` / `"purchaseReturnOrderLines"` to the TS array; DB work is only the two junction tables.
2. **NC junction tables do not use the spec's composite-PK sketch.** The existing 10 use a bare `id` PK (`id('nc…')`), denormalized parent readable-id columns, and all-four-policies-on-`quality_*` RLS. The spec's stated intent is "mirrors the existing 10", so the new junctions follow the real sibling shape.
3. **`post-memo` derives `reasonAccount` itself** (`post-memo/index.ts` ~L233-249: hardcoded `salesDiscountAccount`/`supplierPaymentDiscountAccount`, written back to the memo at post). The spec's "zero posting changes" is false. Resolution: one additive branch in the driver's reason-account resolution keyed on the new `memo.salesReturnOrderId`/`purchaseReturnOrderId` columns. `build-memo-journal.ts` is account-agnostic and stays untouched.
4. **`id('pro')` collides with `procedure`.** `purchaseReturnOrder` uses `id('pret')`, its line `id('pretl')`. (`sro`/`srol` are free.)
5. **`sequence` inserts must include `suffix`** and the PK is `("table","companyId")` — the spec's column list omitted `suffix`.
6. **Ledger identity:** shipments post `itemLedger.entryType 'Negative Adjmt.'` — NOT `'Sale'` as the spec's rationale assumed; `'Sale'`/`'Purchase'` live on `costLedger.itemLedgerType`. Resolution: return receipt posts `itemLedger` `entryType 'Positive Adjmt.'` + `documentType 'Sales Return Receipt'` with `costLedger.itemLedgerType 'Sale'`; supplier-return shipment posts `'Negative Adjmt.'` + `'Purchase Return Shipment'` with `costLedger.itemLedgerType 'Purchase'`. The `documentType` carries the return identity, exactly as `'Sales Shipment'`/`'Purchase Receipt'` do today.
7. **No `NUMERIC(p,s)` anywhere** — the spec sketch's `NUMERIC(10,5)` violates the house ban on NUMERIC precision. All new numeric columns are bare `NUMERIC`.
8. **Readable id is assigned at insert**, not at confirm — the spec's own DDL makes `salesReturnOrderId` NOT NULL, and every sibling (`insertSalesOrder`, `insertPurchaseOrder`, memo `new.tsx`) calls `get_next_sequence` at create. Confirm's job is the status flip + PDF.
9. **config.toml is not the edge-function gate** for these functions (deploy is a directory-wide sync). No config.toml work exists in this plan — no new functions are created, only branches added to `create`, `post-receipt`, `post-shipment`, `post-memo`.
10. **Line-table FKs are single-column** (`salesOrderLine`/`shipmentLine`/`salesInvoiceLine`/`purchaseOrderLine`/`receiptLine`/`purchaseInvoiceLine` all have PK `("id")`). New FKs reference `("id")` only.
11. **The PO "short-close" precedent is `receivedComplete`** + `shortClosePurchaseOrderLine` (Kysely, `purchasing.service.ts:1832`) + route `$orderId.$lineId.receiving.tsx`. The return lines keep the spec's own `closedComplete` column; the *mechanics* (Kysely txn, intent field, status recompute) copy that precedent.
12. **Working tree contamination:** `packages/database/src/{types,swagger-docs-schema}.ts` + `functions/lib/types.ts` are locally modified with another branch's schema (cutList tables, a reverted `showCurrencyTrailingZeros` rename). They must be reset before branching and never committed from this state (Task 1).
13. **`journalEntrySourceType`** has no return values. Add `'Sales Return Receipt'` / `'Purchase Return Shipment'` via the `ADD VALUE IF NOT EXISTS` pattern (`20260726013204` precedent) so return journals aren't mislabeled as `'Purchase Receipt'`/`'Sales Shipment'`.
14. **Original-outbound-cost resolution has a working precedent:** nothing persists `layersConsumed`, but Unscrap resolves historical cost by querying the consumption rows (`costLedger WHERE documentId = <ledger doc> …`) and averaging (`post-inventory-adjustment/resolve-unscrap-cost.ts`), then posts at `fixedUnitCost`. The RMA cost reversal reuses that exact shape per `(shipment, item)` — consumption rows are per-item per-shipment, not per-line.
15. **`resolvePrice` is app-side only** (sales.service.ts) — replacement orders are therefore built app-side (`insertSalesOrder`/`insertPurchaseOrder` + line inserts with rollback-by-delete, the `insertSalesOrder` precedent), not as `convert` edge-function cases.

Also carried from the spec verbatim: **the customer-RMA-from-NCR direction is OUT of scope** (deferred to a follow-on spec). No task below creates a customer RMA from a quality Issue.

## Progress

- [x] Task 1: Preflight — reset contaminated generated files, create branch
- [x] Task 2: Migration: sales-side schema (`sales-return-orders`)
- [x] Task 3: Migration: purchase-side schema (`purchase-return-orders`)
- [x] Task 4: Apply migrations + regenerate DB types
- [x] Task 5: New-company seeds (returnReason, sequences, salesReturnsAccount)
- [x] Task 6: `sales.models.ts` — validators + const arrays
- [x] Task 7: `sales.service.ts` — CRUD, list, return reasons
- [x] Task 8: `sales.service.ts` — lifecycle, transactional caps, returnable-lines + shipped-entities queries
- [x] Task 9: `create` edge fn — `receiptFromSalesReturnOrder`
- [x] Task 10: `post-receipt` — Sales Return Order post + void branch (+ cost helper + deno test)
- [x] Task 11: Return receipt tracked-entity assignment (route branch + ReceiptLines UI)
- [x] Task 12: Receipts UI activation for "Sales Return Order"
- [x] Task 13: Paths, nav, Return Reasons CRUD quartet
- [x] Task 14: RMA list route + `SalesReturnOrdersTable`
- [x] Task 15: RMA detail shell + new/update routes
- [x] Task 16: RMA line routes + line form
- [x] Task 17: RMA PDF (template type + blocks + file route)
- [x] Task 18: RMA status actions (confirm/cancel/complete/line short-close)
- [x] Task 19: Credit generation (post-memo branch, service, route, dialog)
- [x] Task 20: Replacement sales order
- [x] Task 21: Issue association type `salesReturnOrderLines`
- [x] Task 22: RMA dispositions (Use As Is, set-disposition, escalate to Issue)
- [x] Task 23: Return-to-customer shipment (create + post-shipment + UI activation)
- [x] Task 24: `purchasing.models.ts` + `purchasing.service.ts` — supplier returns
- [x] Task 25: `create` + `post-shipment` — Purchase Return Order branches (+ void)
- [x] Task 26: Purchasing paths, nav, list route + table
- [x] Task 27: Supplier return PDF
- [x] Task 28: Supplier return detail tree + lines + status actions + shipments UI activation
- [x] Task 29: Supplier credit + replacement purchase order
- [x] Task 30: Issue association `purchaseReturnOrderLines` + quality bridge (Create Supplier Return, closeIssue guard + write-off reduction)
- [x] Task 31: Docs sync (module AGENTS.md) + i18n translate
- [ ] Task 32: Validation gates (lint, scoped typechecks, tests)
- [ ] Task 33: Browser verification via /test

## Dependencies

- Tasks 2→3→4 are strictly sequential (4 applies both and regenerates types). Task 5 needs 4.
- Sales chain: 6→7→8; 9/10 need 4 (types) and 8 (service reads); 11 needs 10's design + 4; 12 needs 9; 13 needs 6-7; 14-16 need 13; 17 needs 6-7 (data reads) and is required by 18 (confirm imports the pdf loader); 18 needs 8+17; 19 needs 8; 20 needs 8; 21 needs 4; 22 needs 21+18; 23 needs 18 (dispositions set) + 10's post-shipment familiarity.
- Purchase chain: 24 needs 4; 25 needs 24; 26-28 need 24 (28 also needs 25+27); 29 needs 24+19 (post-memo branch is written once in 19, covering both directions); 30 needs 24+25+21's touchpoint map.
- Parallelizable by /execute: {6,24} after 4; {9,10} vs {13,14} after their parents; {17} vs {14-16}; the purchase chain 24-29 is independent of sales UI tasks 13-23 except where noted; 30 is last-but-two. 31-33 are strictly last, in order.

---

## Task 1: Preflight — reset contaminated generated files, create branch

**Depends on:** none
**Files:**
- Modify (reset only): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. Confirm `git status --porcelain` shows exactly the three files above modified (they carry another branch's schema — cutList tables, a reverted `showCurrencyTrailingZeros` rename — regenerated from a local DB that had unmerged migrations applied). If OTHER files are also modified, STOP and report — do not discard unknown work.
2. `git checkout -- packages/database/src/types.ts packages/database/src/swagger-docs-schema.ts packages/database/supabase/functions/lib/types.ts`
3. `git checkout main && git pull` (fast-forward only; if the pull brings new migrations, note the newest migration filename — Task 2's timestamp must sort after it).
4. `git checkout -b returns-module`

**Verify:**
```bash
git status --porcelain && git branch --show-current
# Expected: empty status output, branch "returns-module"
```

**Out of scope:** Rebuilding the local DB. If the local DB still carries the foreign cutList schema, that only matters at Task 4 — handle it there, not here.

---

## Task 2: Migration: sales-side schema (`sales-return-orders`)

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_sales-return-orders.sql` (via `pnpm db:migrate:new sales-return-orders` — never hand-pick the timestamp; HHMMSS must not be `000000`; must sort after `20260813222930_re-land-sales-order-total-fix.sql`)
- Copy from (precedent): `packages/database/supabase/migrations/20260630093809_ar-ap-payments.sql` (account seed loop, sequence inserts, additive-column discipline), `20260609143732_document-template.sql` (table + RLS template), `20250327140050_ncr.sql` (NC junction shape)

**Steps:**
1. `pnpm db:migrate:new sales-return-orders`, then write the SQL below into the created file. All statements idempotent (`IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS`) — the deploy runner does not wrap migrations in a transaction.
2. Enums:
```sql
CREATE TYPE "salesReturnOrderStatus" AS ENUM (
  'Draft', 'Confirmed', 'Partially Received', 'Received', 'Completed', 'Cancelled'
);
ALTER TYPE "disposition" ADD VALUE IF NOT EXISTS 'Return to Customer';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Sales Return Receipt';
```
(No `ALTER` of `receiptSourceDocument`/`itemLedgerDocumentType` — the values already exist. Do NOT reference the new enum values anywhere else in this migration.)
3. `returnReason` (shared by both directions; the `noQuoteReason` pattern but with modern RLS):
```sql
CREATE TABLE IF NOT EXISTS "returnReason" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "name" TEXT NOT NULL,
    "inventoryValueZero" BOOLEAN NOT NULL DEFAULT FALSE,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "returnReason" ADD CONSTRAINT "returnReason_companyId_name_key" UNIQUE ("companyId", "name");
CREATE INDEX IF NOT EXISTS "returnReason_companyId_idx" ON "returnReason" ("companyId");
CREATE INDEX IF NOT EXISTS "returnReason_createdBy_idx" ON "returnReason" ("createdBy");
```
4. `salesReturnOrder` header:
```sql
CREATE TABLE IF NOT EXISTS "salesReturnOrder" (
    "id" TEXT NOT NULL DEFAULT id('sro'),
    "salesReturnOrderId" TEXT NOT NULL,
    "status" "salesReturnOrderStatus" NOT NULL DEFAULT 'Draft',
    "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
    "customerLocationId" TEXT REFERENCES "customerLocation"("id"),
    "customerContactId" TEXT REFERENCES "customerContact"("id"),
    "customerReference" TEXT,
    "locationId" TEXT REFERENCES "location"("id"),
    "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
    "replacementSalesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
    "orderDate" DATE NOT NULL,
    "expirationDate" DATE,
    "internalNotes" JSON,
    "externalNotes" JSON,
    "assignee" TEXT REFERENCES "user"("id"),
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "salesReturnOrder" ADD CONSTRAINT "salesReturnOrder_salesReturnOrderId_companyId_key" UNIQUE ("salesReturnOrderId", "companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_companyId_idx" ON "salesReturnOrder" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_customerId_idx" ON "salesReturnOrder" ("customerId");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_status_idx" ON "salesReturnOrder" ("status");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_createdBy_idx" ON "salesReturnOrder" ("createdBy");
```
5. `salesReturnOrderLine`:
```sql
CREATE TABLE IF NOT EXISTS "salesReturnOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('srol'),
    "salesReturnOrderId" TEXT NOT NULL REFERENCES "salesReturnOrder"("id") ON DELETE CASCADE,
    "lineNumber" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT NOT NULL REFERENCES "item"("id"),
    "quantity" NUMERIC NOT NULL,
    "quantityReceived" NUMERIC NOT NULL DEFAULT 0,
    "unitOfMeasureCode" TEXT,
    "unitPrice" NUMERIC NOT NULL DEFAULT 0,
    "restockFeePercent" NUMERIC NOT NULL DEFAULT 0,
    "returnReasonId" TEXT REFERENCES "returnReason"("id"),
    "salesOrderLineId" TEXT REFERENCES "salesOrderLine"("id") ON DELETE SET NULL,
    "shipmentLineId" TEXT REFERENCES "shipmentLine"("id") ON DELETE SET NULL,
    "salesInvoiceLineId" TEXT REFERENCES "salesInvoiceLine"("id") ON DELETE SET NULL,
    "disposition" "disposition" NOT NULL DEFAULT 'Pending',
    "closedComplete" BOOLEAN NOT NULL DEFAULT FALSE,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_companyId_idx" ON "salesReturnOrderLine" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_salesReturnOrderId_idx" ON "salesReturnOrderLine" ("salesReturnOrderId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_itemId_idx" ON "salesReturnOrderLine" ("itemId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_salesOrderLineId_idx" ON "salesReturnOrderLine" ("salesOrderLineId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_shipmentLineId_idx" ON "salesReturnOrderLine" ("shipmentLineId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_salesInvoiceLineId_idx" ON "salesReturnOrderLine" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_returnReasonId_idx" ON "salesReturnOrderLine" ("returnReasonId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_createdBy_idx" ON "salesReturnOrderLine" ("createdBy");
```
6. `salesReturnOrderLineTrackedEntity` (expected serials/batches; no `updatedBy` needed on the sibling `nonConformanceItemTrackedEntity` precedent, but include it per the house audit mandate):
```sql
CREATE TABLE IF NOT EXISTS "salesReturnOrderLineTrackedEntity" (
    "salesReturnOrderLineId" TEXT NOT NULL,
    "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id") ON DELETE CASCADE,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("salesReturnOrderLineId", "trackedEntityId", "companyId"),
    FOREIGN KEY ("salesReturnOrderLineId", "companyId") REFERENCES "salesReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "salesReturnOrderLineTrackedEntity_companyId_idx" ON "salesReturnOrderLineTrackedEntity" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLineTrackedEntity_trackedEntityId_idx" ON "salesReturnOrderLineTrackedEntity" ("trackedEntityId");
```
7. `salesReturnOrderCreditLine`:
```sql
CREATE TABLE IF NOT EXISTS "salesReturnOrderCreditLine" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "memoId" TEXT NOT NULL REFERENCES "memo"("id") ON DELETE CASCADE,
    "salesReturnOrderLineId" TEXT NOT NULL REFERENCES "salesReturnOrderLine"("id") ON DELETE CASCADE,
    "quantity" NUMERIC NOT NULL,
    "unitPrice" NUMERIC NOT NULL,
    "restockFee" NUMERIC NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId")
);
CREATE INDEX IF NOT EXISTS "salesReturnOrderCreditLine_companyId_idx" ON "salesReturnOrderCreditLine" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderCreditLine_memoId_idx" ON "salesReturnOrderCreditLine" ("memoId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderCreditLine_salesReturnOrderLineId_idx" ON "salesReturnOrderCreditLine" ("salesReturnOrderLineId");
```
8. NC junction — the real sibling shape (drift #2), with denormalized parent ids like `nonConformanceReceiptLine`:
```sql
CREATE TABLE IF NOT EXISTS "nonConformanceSalesReturnOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('ncsro'),
    "nonConformanceId" TEXT NOT NULL REFERENCES "nonConformance"("id") ON DELETE CASCADE,
    "salesReturnOrderLineId" TEXT NOT NULL REFERENCES "salesReturnOrderLine"("id") ON DELETE CASCADE,
    "salesReturnOrderId" TEXT NOT NULL,
    "salesReturnOrderReadableId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT REFERENCES "user"("id"),
    PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_nonConformanceId_idx" ON "nonConformanceSalesReturnOrderLine" ("nonConformanceId");
CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_salesReturnOrderLineId_idx" ON "nonConformanceSalesReturnOrderLine" ("salesReturnOrderLineId");
CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_companyId_idx" ON "nonConformanceSalesReturnOrderLine" ("companyId");
```
9. Additive columns:
```sql
ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "salesReturnOrderId" TEXT REFERENCES "salesReturnOrder"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "memo_salesReturnOrderId_idx" ON "memo" ("salesReturnOrderId");
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "salesReturnsAccount" TEXT REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
`salesReturnsAccount` stays NULLABLE (spec decision: runtime fallback to `salesAccount`) — do NOT add the `SET NOT NULL` phase from the ar-ap precedent.
10. Seed the `Sales Returns` contra-revenue account for existing companies — the `20260630093809` L45-73 pattern exactly: `DO $$` loop over `companyGroup`, resolve parent via `WHERE "companyGroupId" = cg.id AND "isGroup" = TRUE AND name = 'Income'`, insert `number '4900', name 'Sales Returns', isGroup false, class/incomeBalance/accountType matching the seeded `salesAccount` row (copy the enum casts from the precedent), `createdBy 'system'`, guarded `WHERE NOT EXISTS (… number = '4900' …)`. Treat a NULL parent as an error (RAISE) — never insert orphaned (lesson). Then backfill `accountDefault.salesReturnsAccount` per company via the `company → companyGroup → account number '4900'` join (precedent L97-122), with NO fallback needed since the column stays nullable. **Before writing, grep `packages/database/supabase/functions/lib/seed.data.ts` for `4900` and the exact Income group header name (`name` of the group that parents `salesAccount` `"4010"`); if `4900` is taken or the group name differs, pick the nearest free 49xx number / correct name — if no Income-class group exists at all, STOP and report.**
11. Seed `returnReason` for existing companies (idempotent; `ON CONFLICT` on the named unique constraint):
```sql
INSERT INTO "returnReason" ("name", "inventoryValueZero", "companyId", "createdBy")
SELECT v.name, false, c."id", 'system'
FROM "company" c
CROSS JOIN (VALUES ('Defective'), ('Wrong Item Shipped'), ('Damaged in Transit'), ('No Longer Needed'), ('Warranty'), ('Other')) AS v(name)
ON CONFLICT ("companyId", "name") DO NOTHING;
```
12. Sequence rows (drift #5 — include `suffix`; `next 0, size 6, step 1` per the salesOrder seed shape):
```sql
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'salesReturnOrder', 'Sales Return Order', 'RMA', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;
```
13. `salesReturnOrders` view — copy the `salesOrders` two-separate-lateral shape (`20260813222930` — the aggregate lateral must be separate from any fan-out join so no `sum(DISTINCT)` is ever needed):
```sql
DROP VIEW IF EXISTS "salesReturnOrders";
CREATE VIEW "salesReturnOrders" WITH (security_invoker = true) AS
SELECT
  sro.*,
  lines."linesCount",
  lines."quantityAuthorized",
  lines."quantityReceived",
  COALESCE(credits."quantityCredited", 0) AS "quantityCredited"
FROM "salesReturnOrder" sro
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS "linesCount",
         COALESCE(SUM(l."quantity"), 0) AS "quantityAuthorized",
         COALESCE(SUM(l."quantityReceived"), 0) AS "quantityReceived"
  FROM "salesReturnOrderLine" l
  WHERE l."salesReturnOrderId" = sro."id"
) lines ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cl."quantity"), 0) AS "quantityCredited"
  FROM "salesReturnOrderCreditLine" cl
  INNER JOIN "memo" m ON m."id" = cl."memoId"
  INNER JOIN "salesReturnOrderLine" l ON l."id" = cl."salesReturnOrderLineId"
  WHERE l."salesReturnOrderId" = sro."id" AND m."status" = 'Posted'
) credits ON TRUE;
```
(No customer-name join — the table resolves customer names client-side via `useCustomers()`, the `SalesOrdersTable` precedent. This is a deliberate minor deviation from the spec's "header + customer name" wording.)
14. RLS — the four standardized policies per table, schema-qualified, `::text[]` casts. `SELECT` via `get_companies_with_employee_role()`; writes via `get_companies_with_employee_permission('sales_<action>')` for `returnReason`, `salesReturnOrder`, `salesReturnOrderLine`, `salesReturnOrderLineTrackedEntity`; **`invoicing_<action>` writes** for `salesReturnOrderCreditLine`; **all four on `quality_view/create/update/delete`** for `nonConformanceSalesReturnOrderLine` (the NC-junction sibling pattern — SELECT uses the permission helper there, not the role helper). No portal arm.

**Verify:**
```bash
pnpm db:migrate
# Expected: the new migration applies cleanly (no SQL errors); output lists <timestamp>_sales-return-orders.sql as applied
```
If the local DB is unreachable or carries foreign schema that conflicts, STOP and report (never rebuild the DB — user does that).

**Out of scope:** purchase-side tables (Task 3); any TS/model change; NOT NULL on `salesReturnsAccount`; touching `receiptSourceDocument`, `shipmentSourceDocument`, or `itemLedgerDocumentType` (values already exist).

---

## Task 3: Migration: purchase-side schema (`purchase-return-orders`)

**Depends on:** Task 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_purchase-return-orders.sql` (via `pnpm db:migrate:new purchase-return-orders`)
- Copy from (precedent): the Task 2 file (mirror), `20260421130000_nc-item-tracked-entity.sql` (quantity-bearing junction)

**Steps:**
1. `pnpm db:migrate:new purchase-return-orders`; write the direction-flipped mirror. Deltas from the sales twin (everything else mirrors Task 2 exactly, including RLS with `purchasing_<action>` in place of `sales_<action>`):
```sql
CREATE TYPE "purchaseReturnOrderStatus" AS ENUM (
  'Draft', 'Confirmed', 'Partially Shipped', 'Shipped', 'Completed', 'Cancelled'
);
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Purchase Return Shipment';
```
2. `purchaseReturnOrder` — as `salesReturnOrder` with: `"id" TEXT NOT NULL DEFAULT id('pret')` (drift #4 — `'pro'` is `procedure`'s), readable `"purchaseReturnOrderId"`, `"supplierId" TEXT NOT NULL REFERENCES "supplier"("id")`, `"supplierLocationId" TEXT REFERENCES "supplierLocation"("id")`, `"supplierContactId" TEXT REFERENCES "supplierContact"("id")`, `"supplierReference" TEXT` (the supplier's own RMA number), `"purchaseOrderId"` / `"replacementPurchaseOrderId" TEXT REFERENCES "purchaseOrder"("id") ON DELETE SET NULL`, `"status" "purchaseReturnOrderStatus"`. No customer columns. Unique `("purchaseReturnOrderId","companyId")`; indexes on `companyId`, `supplierId`, `status`, `createdBy`.
3. `purchaseReturnOrderLine` — as `salesReturnOrderLine` with: `id('pretl')`, `"quantityShipped" NUMERIC NOT NULL DEFAULT 0` (instead of `quantityReceived`), links `"purchaseOrderLineId" TEXT REFERENCES "purchaseOrderLine"("id") ON DELETE SET NULL`, `"receiptLineId" TEXT REFERENCES "receiptLine"("id") ON DELETE SET NULL`, `"purchaseInvoiceLineId" TEXT REFERENCES "purchaseInvoiceLine"("id") ON DELETE SET NULL`, **no `disposition` column**, keep `returnReasonId`/`restockFeePercent`/`closedComplete`. Quantities and `unitPrice` are ALWAYS in the item's inventory UOM (conversion happens once at authoring — Task 24).
4. `purchaseReturnOrderLineTrackedEntity` — mirror of the sales twin (composite PK line+entity+company, composite FK to the line).
5. `purchaseReturnOrderCreditLine` — mirror; `invoicing_<action>` RLS writes.
6. `nonConformancePurchaseReturnOrderLine` — sibling NC-junction shape (`id('ncpro')`, denormalized `purchaseReturnOrderId` + `purchaseReturnOrderReadableId`, quality_* RLS) **plus** `"quantity" NUMERIC NOT NULL DEFAULT 0` — the per-quantity ownership the spec's bridge requires (each row records the issue quantity it covers).
7. `ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "purchaseReturnOrderId" TEXT REFERENCES "purchaseReturnOrder"("id") ON DELETE SET NULL;` + index.
8. Sequence rows: `('purchaseReturnOrder', 'Purchase Return Order', 'RTS', NULL, 0, 6, 1, c."id")` — same INSERT shape as Task 2 step 12.
9. `purchaseReturnOrders` view — mirror of `salesReturnOrders` (lateral 1: `linesCount`/`quantityAuthorized`/`quantityShipped`; lateral 2: `quantityCredited` from `purchaseReturnOrderCreditLine` × Posted memos).

**Verify:**
```bash
pnpm db:migrate
# Expected: <timestamp>_purchase-return-orders.sql applies cleanly
```

**Out of scope:** any sales-side change; disposition machinery (supplier returns have no disposition stage by design).

---

## Task 4: Apply migrations + regenerate DB types

**Depends on:** Tasks 2, 3
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. Both migrations were applied by the Task 2/3 verifies; if `pnpm db:migrate` reported "no pending migrations", that's fine. Run `pnpm db:types` to force type regeneration.
2. Inspect the diff of `packages/database/src/types.ts`: it must contain `salesReturnOrder`, `purchaseReturnOrder`, `returnReason`, `salesReturnOrders`/`purchaseReturnOrders` views, the two new enums — and must NOT contain `cutList`, `jobOperationBatch`, or a `hideCurrencyTrailingZeros` rename (contamination check, drift #12). If contamination appears, the local DB carries foreign migrations — STOP and report (the fix is the user's `crbn` rebuild or `supabase migration repair`, per the local-DB-divergence memory; do not attempt it).

**Verify:**
```bash
git diff --stat packages/database/src/types.ts && grep -c "salesReturnOrder" packages/database/src/types.ts && grep -c "cutList" packages/database/src/types.ts
# Expected: non-trivial diff; salesReturnOrder count > 0; cutList count = 0 (grep exits 1)
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** hand-editing any generated file.

---

## Task 5: New-company seeds (returnReason, sequences, salesReturnsAccount)

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — add `returnReasons` template array, two `sequences` entries, one `accounts` entry, one `accountDefaults` key
- Modify: `packages/database/supabase/functions/seed-company/index.ts` — insert `returnReason` rows (new step near the sequences insert, ~L308)
- Modify: `packages/database/src/seed-dev/bootstrap.ts` — insert `returnReason` rows (near the sequences insert, ~L258)
- Copy from (precedent): the `sequences` array entries at `seed.data.ts:223-479` (`salesOrder` entry shape), the `accounts` array (~L612) + `accountDefaults` map (~L763)

**Steps:**
1. `seed.data.ts`: add to `sequences`: `{ table: "salesReturnOrder", name: "Sales Return Order", prefix: "RMA", suffix: null, next: 0, size: 6, step: 1 }` and `{ table: "purchaseReturnOrder", name: "Purchase Return Order", prefix: "RTS", suffix: null, next: 0, size: 6, step: 1 }` (match the existing entries' exact field shape). Add to `accounts`: a `sales-returns` leaf `{ key: "sales-returns", number: "4900", name: "Sales Returns", isGroup: false, parentKey: <the key of the group that parents the "4010" salesAccount entry — read it from the file>, … same accountType/incomeBalance/class as the salesAccount entry }`. Add to `accountDefaults`: `salesReturnsAccount: "4900"`. Export `const returnReasons = ["Defective", "Wrong Item Shipped", "Damaged in Transit", "No Longer Needed", "Warranty", "Other"]`.
2. `seed-company/index.ts`: after the sequences insert, insert `returnReasons.map((name) => ({ name, inventoryValueZero: false, companyId, createdBy: userId }))` into `returnReason`. Note `accountDefaults` propagation is automatic once the key exists (the insert is built from the map's keys); the subsidiary-joining-existing-group path resolves by number — confirm `"4900"` resolves there too (it looks up existing ids by number, and the Task 2 migration seeded 4900 for existing groups).
3. `seed-dev/bootstrap.ts`: same `returnReason` insert; `accountDefault` insert extends automatically (dynamic over map keys).
4. Use the same number (`4900`) as the Task 2 migration — if Task 2's preflight grep forced a different number, use that everywhere.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0 (seed.data.ts + bootstrap.ts compile)
grep -n "salesReturnOrder" packages/database/supabase/functions/lib/seed.data.ts
# Expected: sequence entry present
```

**Out of scope:** re-running seeds against the local DB (the migration backfilled existing companies); `noQuoteReason` (stays unseeded).

---

## Task 6: `sales.models.ts` — validators + const arrays

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts`
- Copy from (precedent): `salesOrderValidator` (`sales.models.ts:726`), `salesOrderStatusType` (`:673`), `noQuoteReasonValidator` (`:162`), the disposition commented-subset technique (`apps/erp/app/modules/quality/quality.models.ts:20-31`)

**Steps:**
1. Add const arrays:
   - `salesReturnOrderStatusType = ["Draft", "Confirmed", "Partially Received", "Received", "Completed", "Cancelled"] as const`
   - `salesReturnDispositionType = ["Pending", "Use As Is", "Return to Customer", "Scrap", "Rework"] as const` — a picker subset of the DB `disposition` enum, commented-subset style with the unused eight values present-but-commented (mirror the quality.models technique).
   - `isSalesReturnOrderLocked = (status) => ["Completed", "Cancelled"].includes(status)`.
2. `returnReasonValidator = z.object({ id: zfd.text(z.string().optional()), name: z.string().trim().min(1, { message: "Name is required" }), inventoryValueZero: zfd.checkbox() })`.
3. `salesReturnOrderValidator` — mirror `salesOrderValidator` fields where applicable: `id?`, `salesReturnOrderId?` (server-generated), `customerId: z.string().min(1)`, `customerLocationId?`, `customerContactId?`, `customerReference?`, `locationId?`, `salesOrderId?`, `currencyCode: zfd.text(z.string().optional())`, `exchangeRate: zfd.numeric(z.number().optional())`, `orderDate: z.string().min(1)`, `expirationDate: zfd.text(z.string().optional())`, `assignee?`.
4. `salesReturnOrderLineValidator`: `id?`, `salesReturnOrderId: z.string().min(1)`, `itemId: z.string().min(1)`, `quantity: zfd.numeric(z.number().gt(0))`, `unitOfMeasureCode?`, `unitPrice: zfd.numeric(z.number().min(0))`, `restockFeePercent: zfd.numeric(z.number().min(0).max(1)).optional()`, `returnReasonId?`, `salesOrderLineId?`, `shipmentLineId?`, `salesInvoiceLineId?`, `trackedEntityIds: zfd.repeatableOfType(z.string()).optional()`.
5. `salesReturnOrderCreditValidator`: `lines: repeatable of { salesReturnOrderLineId, quantity (numeric ≥ 0) }` — shaped for the credit dialog's per-line quantities (use `zfd.repeatableOfType` on a JSON-encoded field or paired repeatable fields — match how an existing multi-row form in the codebase encodes arrays, e.g. `selectedLines` in `purchasing.models.ts:318`).
6. `salesReturnOrderDispositionValidator`: `{ lineId: z.string().min(1), disposition: z.enum(salesReturnDispositionType) }`.
7. Export everything from the module barrel `apps/erp/app/modules/sales/index.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** purchasing models (Task 24); UI components.

---

## Task 7: `sales.service.ts` — CRUD, list, return reasons

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts`
- Copy from (precedent): `getSalesOrders` (`:1650`), `getSalesOrder` (`:1596`), `insertSalesOrder` (`:5180`, the `get_next_sequence` call at `:5211`), `upsertNoQuoteReason` (`:3159`), `getNoQuoteReasons` (`:1005`), `deleteSalesOrder` (`:448`)

**Steps:**
1. List: `getSalesReturnOrders(client, companyId, args: GenericQueryFilters & { search: string | null; status: string | null; customerId: string | null })` — reads the `salesReturnOrders` view, `.select("*", { count: LIST_COUNT })`, `.eq("companyId", companyId)`, search via `.or("salesReturnOrderId.ilike…,customerReference.ilike…")`, `setGenericQueryFilters(query, args, [{ column: "createdAt", ascending: false }])`. (Plain `select("*")` — do NOT add a `*_LIST_COLUMNS` constant; that pattern belongs to the ten big legacy views only.)
2. `getSalesReturnOrder(client, id)` (view, `.single()`), `getSalesReturnOrderLines(client, salesReturnOrderId, companyId)` (base table, joined `returnReason(name)` + `item(readableIdWithRevision, name)` — embed by target-table name, never `alias:fkColumn(...)`, composite-FK lesson), `getSalesReturnOrderLine(client, lineId)`, `getSalesReturnOrderLineTrackedEntities(client, lineIds: string[])` (one `.in()` call).
3. `insertSalesReturnOrder(client, input)` — mirror `insertSalesOrder`: when `salesReturnOrderId` absent, `client.rpc("get_next_sequence", { sequence_name: "salesReturnOrder", company_id: input.companyId })`; resolve `currencyCode ?? customer.currencyCode ?? company.baseCurrencyCode` and `exchangeRate` via `getCurrencyByCode(client, companyGroupId, currencyCode)` (`accounting.service.ts:1722` — note the arg is `companyGroupId`); insert, return `{ id, salesReturnOrderId }`.
4. `updateSalesReturnOrder(client, input)` (sanitize + `updatedAt`/`updatedBy`), `upsertSalesReturnOrderLine(client, line)` (branch on `createdBy` in arg, the `upsertCustomer` style; on insert compute `lineNumber` = max+1 for the order), `deleteSalesReturnOrder(client, id)`, `deleteSalesReturnOrderLine(client, lineId)`.
5. `setSalesReturnOrderLineTrackedEntities(client, lineId, companyId, entityIds, userId)` — delete-then-insert the junction rows for the line (single delete + single bulk insert).
6. Return reasons: `getReturnReasons(client, companyId, args)` / `getReturnReasonsList(client, companyId)` / `getReturnReason(client, id)` / `upsertReturnReason` / `deleteReturnReason` — clone the five `noQuoteReason` functions, plus the `inventoryValueZero` field.
7. Related-panel reads: `getSalesReturnOrderReceipts(client, salesReturnOrderId, companyId)` (`receipt` where `sourceDocumentId = id`), `getSalesReturnOrderCredits(client, salesReturnOrderId, companyId)` (`memo` where `salesReturnOrderId = id`), `getSalesReturnOrderIssues(client, salesReturnOrderId, companyId)` (`nonConformanceSalesReturnOrderLine` where `salesReturnOrderId = id`).
8. Every query `.eq("companyId", companyId)`-scoped; all return raw `{ data, error }`; export from the barrel.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** lifecycle/caps (Task 8); routes.

---

## Task 8: `sales.service.ts` — lifecycle, transactional caps, returnable-lines + shipped-entities queries

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts`
- Copy from (precedent): `replaceInvoiceSettlements` (`apps/erp/app/modules/invoicing/invoicing.service.ts:1734` — the canonical `.forUpdate()` cap-validation transaction, with the why-comment at `:1729`), `shortClosePurchaseOrderLine` (`purchasing.service.ts:1832`), `getTrackedEntitiesByMakeMethodId` (`inventory.service.ts:1369` — the `attributes->>` query pattern)

**Steps:**
1. `confirmSalesReturnOrder(db: Kysely<KyselyDatabase>, { id, companyId, userId })` — one transaction:
   a. `selectFrom("salesReturnOrder").where("id","=",id).where("companyId","=",companyId).forUpdate()` — must be `Draft`, must have ≥1 line; throw otherwise.
   b. Lock the order's lines `.forUpdate()`; for each linked line re-read the reversible cap under lock: base = `shipmentLine.shippedQuantity` when `shipmentLineId` set, else `salesOrderLine.quantitySent`, else `salesInvoiceLine.quantity`; minus Σ `quantity` over OTHER `salesReturnOrderLine` rows sharing that link whose header status is not `Cancelled`. If any line's `quantity` > cap, throw a message naming the line and cap. Blind lines (no links) skip the check.
   c. `updateTable("salesReturnOrder").set({ status: "Confirmed", updatedBy: userId, updatedAt })`.
2. `cancelSalesReturnOrder(client, { id, userId })` — guard: no receipt for this RMA is `Posted`/`Pending` (query `receipt` by `sourceDocumentId`) AND `quantityReceived = 0` on all lines; set `Cancelled`.
3. `completeSalesReturnOrder(client, { id, companyId, userId })` — guard (mirrors `closeIssue`'s blocker-collection style, `quality-disposition.server.ts:668`): every line with `closedComplete = false` must have `quantityReceived >= quantity`, and every line with `quantityReceived > 0` must have `disposition != 'Pending'`. Collect violations into one joined error message; on pass set `Completed`.
4. `shortCloseSalesReturnOrderLine(db, { lineId, salesReturnOrderId, companyId, userId, intent: "close" | "reopen" })` — Kysely txn setting `closedComplete`, then recompute the header status: if every non-closed line has `quantityReceived >= quantity` and any receipt happened → `Received`; the `shortClosePurchaseOrderLine` mechanic with the RMA ladder.
5. `getReturnableLinesForCustomer(client, companyId, customerId, { salesOrderId?: string })` — the "from document" picker source: posted `shipmentLine`s of shipments whose source SO belongs to the customer (join `shipment` → `salesOrder`), each with item, shipped quantity, unit price from the SO line, minus already-authorized quantities (one `.in()` aggregate over `salesReturnOrderLine` by `shipmentLineId` on non-Cancelled headers — never a per-row query). Return rows shaped `{ itemId, description, shippedQuantity, alreadyReturned, returnableQuantity, unitPrice, unitOfMeasureCode, salesOrderLineId, shipmentLineId, salesInvoiceLineId? }`. If assembling this via PostgREST embeds turns unreadable, define an RPC `get_returnable_lines_for_customer` in a small follow-up migration instead — flag it in the run log rather than hand-rolling N+1.
6. `getShippedTrackedEntitiesForCustomer(client, companyId, customerId, itemId)` — entity picker source: shipment ids for the customer (`shipment` joined to `salesOrder` by sourceDocumentId, or `shipment.customerId` — verify which column exists on `shipment`; it carries `customerId` per the create-fn header insert), then `trackedEntity` where `attributes->>Shipment` in those ids, `.eq("itemId", itemId)`, `.eq("status", "Consumed")` — the `getTrackedEntitiesByMakeMethodId` attribute pattern. Two queries total.
7. `getCreditableQuantities(client, salesReturnOrderId, companyId)` — per line: `quantityReceived` minus Σ credit-line quantity over memos with `status != 'Voided'` (Draft counts against the cap so two drafts can't double-credit; the VIEW's displayed `quantityCredited` still derives from Posted only — state this in a comment).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** credit memo creation (Task 19); replacement (Task 20); any route.

---

## Task 9: `create` edge fn — `receiptFromSalesReturnOrder`

**Depends on:** Tasks 4, 8
**Files:**
- Modify: `packages/database/supabase/functions/create/index.ts`
- Copy from (precedent): case `receiptFromInboundTransfer` (`create/index.ts:1031-1197` — the outstanding-balance quantity shape) and `receiptFromPurchaseOrder` (`:765` — tracking-type resolution, pickMethod storage units)

**Steps:**
1. Add union member to `payloadValidator`: `{ type: z.literal("receiptFromSalesReturnOrder"), companyId, userId, salesReturnOrderId: z.string(), receiptId: z.string().optional(), locationId: z.string().optional() }` (match the sibling literals' exact field style).
2. Add `receiptFromSalesReturnOrder: { create: "inventory" }` to `permissionsByType`.
3. New case: read `salesReturnOrder` (must be `Confirmed` or `Partially Received`; else throw) + its lines + `item.itemTrackingType` for the line items + pickMethod default storage units (copy the PO case's `${itemId}::${locationId}` map). Build `ReceiptLineItem`s from lines where `!closedComplete && quantity - quantityReceived > 0`:
   - `lineId: line.id`, `orderQuantity: line.quantity`, `outstandingQuantity`/`receivedQuantity`: `line.quantity - line.quantityReceived`, `unitPrice: 0` (cost is resolved at posting, not from the credit-basis price — comment this), `conversionFactor: 1`, `unitOfMeasure: line.unitOfMeasureCode ?? "EA"`, `locationId` (header's, overridable by payload), `storageUnitId` from pickMethod default, `requiresSerialTracking`/`requiresBatchTracking` from tracking type, `companyId`, `createdBy`.
4. Transaction: existing-receipt path updates header + deletes lines (the inbound-transfer shape); else `getNextSequence(trx, "receipt", companyId)` + insert receipt with `sourceDocument: "Sales Return Order"`, `sourceDocumentId: salesReturnOrder.id`, `sourceDocumentReadableId: salesReturnOrder.salesReturnOrderId`, `customerId` if the receipt table has such a column (grep `receipt` columns first; if absent, skip), `locationId`. Bulk-insert `receiptLine`s.

**Verify:**
```bash
pnpm exec biome check packages/database/supabase/functions/create --reporter=summary
# Expected: 0 errors (deno check is NOT a gate — it fails on pre-existing shared-graph errors; lesson)
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** posting (Task 10); the shipment cases (Tasks 23, 25); any UI.

---

## Task 10: `post-receipt` — Sales Return Order post + void branch

**Depends on:** Tasks 4, 9
**Files:**
- Modify: `packages/database/supabase/functions/post-receipt/index.ts`
- Create: `packages/database/supabase/functions/shared/resolve-return-cost.ts` + `packages/database/supabase/functions/shared/resolve-return-cost.test.ts`
- Copy from (precedent): the Purchase Order post branch (`post-receipt/index.ts:595-1969`) for structure; `post-inventory-adjustment/resolve-unscrap-cost.ts` (+ its test) for the historical-cost resolver; the void path (`:196-588`) for reversal mechanics

**Steps:**
1. **Cost resolver** (`shared/resolve-return-cost.ts`): pure function `resolveReturnUnitCost(rows: { quantity: number; cost: number }[]): number | null` = `Σ|cost| / Σ|quantity|`, null on empty/zero — extract the `resolve-unscrap-cost.ts` math into `shared/` (import it from `post-inventory-adjustment` too if trivial, otherwise leave that copy alone — do not refactor its call site beyond an import swap). `deno test` file with: single layer, multi-layer average, empty → null, zero-quantity → null.
2. **Post branch** — new `case "Sales Return Order":` in the `switch (receipt.data?.sourceDocument)` (at `:594`). Per receipt line (line links back via `receiptLine.lineId` → `salesReturnOrderLine.id`):
   a. **Cost resolution**: if the RMA line's `returnReason.inventoryValueZero` → unit cost 0. Else if `shipmentLineId` set → fetch that `shipmentLine`'s `shipmentId` and query `costLedger` rows `WHERE documentId = <shipmentId> AND documentType = 'Sales Shipment' AND itemId = <itemId> AND companyId = …` → `resolveReturnUnitCost` (drift #14: consumption rows are per shipment+item). If null/unlinked → current cost from `itemCost.unitCost` (blind-return fallback; also the flagged-variance fallback the spec's risk row prescribes — add a comment).
   b. **itemLedger**: `entryType: "Positive Adjmt."`, `documentType: "Sales Return Receipt"`, `documentId: receipt.id`, positive quantity, `postingDate: today` — the three tracked/untracked insert sites mirror the PO branch (`:1274-1361`), including per-unit serial rows and `trackedEntityId` discovery via `attributes["Receipt Line"]` / `["Receipt Line Index"]`.
   c. **costLedger** layer: `itemLedgerType: "Sale"`, `costLedgerType: "Direct Cost"`, `documentType: "Sales Return Receipt"`, `documentId: receipt.id`, `quantity`, `cost = quantity × resolvedUnitCost`, `remainingQuantity = quantity` (consumable layer; zero-value reasons produce a 0-cost layer, still with remainingQuantity).
   d. **Journal** (only `accountingEnabled && accountDefaults`, and skip entirely when resolved cost is 0): paired lines by `journalLineReference` — Dr `resolveInventoryAccount(replenishmentSystem, accountDefaults)` / Cr `accountDefaults.costOfGoodsSoldAccount` at layer value; journal header `sourceType: "Sales Return Receipt"`, `documentType: "Receipt"` on lines, `documentId: receipt.id` (the PO-branch journal shape at `:1114-1217`).
   e. **Tracked entities**: ALWAYS `status: "On Hold"` (spec: disposition is the only path to Available — deliberately NOT the `assignmentByItemId` Available/On-Hold split the PO branch uses), `quantity` restored to the received quantity. `trackedActivity` `{ type: "Return Receipt", sourceDocument: "Receipt", sourceDocumentId: receiptId, sourceDocumentReadableId: receipt.receiptId }` + one `trackedActivityOutput` per entity (the `:1882-1927` shape). `trackedActivity.type` is free TEXT — no enum work.
   f. **Source bump + ladder**: `salesReturnOrderLine.quantityReceived += receivedQuantity` (inventory units, conversionFactor 1 — no division); then re-read all lines in-transaction and set header status: every non-`closedComplete` line `quantityReceived >= quantity` → `Received`; else any line `quantityReceived > 0` → `Partially Received`; else keep `Confirmed`. (New ladder — there is no shared helper; drift-verified.)
   g. Receipt → `Posted` (same as PO branch).
3. **Void branch**: the void guard at `:197-215` currently throws for `sourceDocument !== "Purchase Order"` — extend to allow `"Sales Return Order"`, then branch: sign-flip the original `itemLedger` rows (query by `documentId` + `documentType: "Sales Return Receipt"`), sign-flip journal lines (VOID description, same references), roll back `quantityReceived` per line (`max(0, existing − received)`), recompute the header ladder downward (may return to `Confirmed`), flip reactivated entities back to `status: "Consumed"` (their pre-receipt state — NOT `Available` as the PO void does; blind-created entities also go `Consumed`) with a `Void Receipt` activity, **and zero the return's own cost layers** (`UPDATE costLedger SET remainingQuantity = 0 WHERE documentId = receiptId AND documentType = 'Sales Return Receipt'`) so FIFO can never consume voided return stock — an improvement scoped to our own rows only (the PO void's layer gap is out of scope). Set receipt `Voided`.
4. Keep the entire branch additive — zero edits inside the `"Purchase Order"` / `"Inbound Transfer"` cases.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test shared/resolve-return-cost.test.ts
# Expected: all tests pass
pnpm exec biome check packages/database/supabase/functions/post-receipt packages/database/supabase/functions/shared --reporter=summary
# Expected: 0 errors
```

**Out of scope:** the PO/transfer branches (byte-identical); dispositions; `post-shipment`.

---

## Task 11: Return receipt tracked-entity assignment (route branch + ReceiptLines UI)

**Depends on:** Tasks 8, 10
**Files:**
- Modify: `apps/erp/app/routes/x+/receipt+/lines.tracking.tsx` — new `trackingType === "returnEntity"` branch
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptLines.tsx` — return-source picker path
- Copy from (precedent): the existing serial/batch branches in `lines.tracking.tsx`; `packages/react/src/TrackedEntityPicker.tsx` (props: caller supplies `entities`, `onSelect`)

**Steps:**
1. The standard tracking flow (`update_receipt_line_serial_tracking`) REJECTS a serial whose entity already carries a `Receipt Line Index` attribute — which every returned serial does from its original receipt. So returns need their own branch, not the RPCs:
2. `lines.tracking.tsx`: add branch for `trackingType === "returnEntity"` with fields `trackedEntityId`, `receiptLineId`, `receiptId`, `quantity`. Validate with the RLS client: the receipt's `sourceDocument === "Sales Return Order"`; the entity is `Consumed`; the entity id appears in `salesReturnOrderLineTrackedEntity` for the RMA line the receipt line points at (`receiptLine.lineId`). Then via service role, UPDATE the entity's `attributes` merging `{ "Receipt": receiptId, "Receipt Line": receiptLineId }` (+ `"Receipt Line Index"` for serials, using the submitted index) — do NOT change status or quantity here; posting owns that (Task 10 discovers entities by these attributes, unchanged). Also support un-assignment (`intent: "remove"` clears those attribute keys).
3. `ReceiptLines.tsx`: where the serial/batch entry UI renders, branch on the receipt's `sourceDocument === "Sales Return Order"`: render `TrackedEntityPicker` fed with the RMA line's expected entities (loader/fetcher reading `getSalesReturnOrderLineTrackedEntities` + `trackedEntity` status — only `Consumed` ones selectable), submitting the `returnEntity` form to `path.to.receiptLinesTracking`. Blind returns (line has no expected entities): keep the existing free-text serial/batch inputs (the standard creation path handles new entities correctly).
4. **Escape hatch:** if `ReceiptLines.tsx`'s internal structure can't host a per-source branch without restructuring unrelated flows, STOP and report with the component's actual shape — do not refactor the PO tracking UI.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** the `update_receipt_line_*` SQL functions (untouched); shipment-side tracking.

---

## Task 12: Receipts UI activation for "Sales Return Order"

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — uncomment `"Sales Return Order"` in `receiptSourceDocumentType` (line ~75)
- Modify: `apps/erp/app/modules/inventory/ui/Receipts/ReceiptForm/useReceiptForm.tsx` — new `fetchSourceDocuments` branch
- Modify: `apps/erp/app/routes/x+/receipt+/new.tsx` — new switch case
- Modify: `apps/erp/app/routes/x+/receipt+/$receiptId.details.tsx` — new switch case
- Copy from (precedent): the `"Purchase Order"` branch in each of those four places

**Steps:**
1. `inventory.models.ts`: uncomment ONLY `"Sales Return Order"` in `receiptSourceDocumentType` (leave the other commented values untouched).
2. `useReceiptForm.tsx`: add case `"Sales Return Order"` → `carbon.from("salesReturnOrder").select("id, salesReturnOrderId").eq("companyId", companyId).in("status", ["Confirmed", "Partially Received"])` → map to `{ name: salesReturnOrderId, id }`.
3. `x+/receipt+/new.tsx` switch: case `"Sales Return Order"` → invoke `create` with `{ type: "receiptFromSalesReturnOrder", salesReturnOrderId: sourceDocumentId, companyId, userId }`, redirect to `path.to.receiptDetails(data.id)` — mirror the PO case's error handling.
4. `$receiptId.details.tsx` source-change switch: same case with `receiptId` included.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** `shipmentSourceDocumentType` (Tasks 23/28); any receipt-posting logic.

---

## Task 13: Paths, nav, Return Reasons CRUD quartet

**Depends on:** Tasks 6, 7
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — all sales-return path helpers (alphabetical placement)
- Modify: `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` — nav items
- Create: `apps/erp/app/routes/x+/sales+/return-reasons.tsx`, `return-reasons.new.tsx`, `return-reasons.$id.tsx`, `return-reasons.delete.$id.tsx`
- Create: `apps/erp/app/modules/sales/ui/ReturnReasons/ReturnReasonForm.tsx`, `ReturnReasonsTable.tsx`, `index.ts`
- Copy from (precedent): the `no-quote-reasons` quartet (`apps/erp/app/routes/x+/sales+/no-quote-reasons*.tsx`) + `apps/erp/app/modules/sales/ui/NoQuoteReasons/*`

**Steps:**
1. `path.ts` additions (exact URL shapes, `generatePath` for parameterized): `salesReturnOrders: ${x}/sales/rmas`, `salesReturnOrder(id): ${x}/sales-return-order/${id}`, `salesReturnOrderDetails(id): …/details`, `salesReturnOrderLine(orderId, lineId): …/${lineId}/details`, `newSalesReturnOrder`, `newSalesReturnOrderLine(orderId)`, `salesReturnOrderConfirm/Cancel/Complete/Status(id)`, `salesReturnOrderCredit(id)`, `salesReturnOrderReplacement(id)`, `salesReturnOrderLineDisposition(orderId, lineId)`, `salesReturnOrderLineIssue(orderId, lineId)`, `salesReturnOrderLineReceiving(orderId, lineId)` (short-close), `deleteSalesReturnOrder(id)`, `deleteSalesReturnOrderLine(orderId, lineId)`, `returnReason(id)`, `returnReasons`, `newReturnReason`, `deleteReturnReason(id)`, and in the `file` group `salesReturnOrder(id): ${file}/sales-return-order/${id}.pdf`.
2. Nav (`useSalesSubmodules.tsx`): `Manage` group gets `{ name: t\`RMAs\`, to: path.to.salesReturnOrders, icon: <pick a lucide return/undo icon>, table: "salesReturnOrder" }`; `Configure` group gets `{ name: t\`Return Reasons\`, to: path.to.returnReasons, role: "employee" }` — match the exact item shapes already in the file.
3. Return-reasons quartet: clone the four `no-quote-reasons` routes 1:1 (loader `{ view: "sales", role: "employee" }`, actions `create/update/delete: "sales"`, `?${getParams(request)}` redirect preservation, `ConfirmDelete` + PG `23503` special-case). Form adds a `Boolean` field `inventoryValueZero` with description "Returned goods re-enter inventory at zero value" — labels via Lingui `` t`…` ``.
4. Table: clone `NoQuoteReasonsTable` + an `inventoryValueZero` boolean column.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** purchasing paths/nav (Task 26); the RMA routes themselves.

---

## Task 14: RMA list route + `SalesReturnOrdersTable`

**Depends on:** Task 13
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/rmas.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx`, `SalesReturnOrderStatus.tsx`, `index.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/sales+/orders.tsx` (list route loader shape) + `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrdersTable.tsx` (memo + columns + context menu + `Table` props) + `PurchasingStatus.tsx`-style status badge components

**Steps:**
1. Route: loader `{ view: "sales" }`, parse `GenericQueryFilters` + `search`/`status`/`customerId` exactly as `orders.tsx` does, call `getSalesReturnOrders`, render `<SalesReturnOrdersTable data count />` + `<Outlet />`.
2. Table: `memo`'d component; columns: `salesReturnOrderId` (Hyperlink to `path.to.salesReturnOrderDetails`, pinned left), customer (via `useCustomers()` store), status badge (`SalesReturnOrderStatus` — small component mapping the six statuses to badge variants), `orderDate`, received progress (`quantityReceived`/`quantityAuthorized` from the view), `quantityCredited`, assignee (via `usePeople()`), `createdAt`. `meta.filter` static options for status; `useCustomColumns<T>("salesReturnOrder")` spread; context menu Edit/Delete gated on permissions; `primaryAction={<New … to={path.to.newSalesReturnOrder} />}`; `table="salesReturnOrder"` + `withSavedView`; `ConfirmDelete` wired to `path.to.deleteSalesReturnOrder`. CSV export is automatic — add `meta.exportValue` for the store-resolved customer column.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** detail routes (Task 15); purchasing table.

---

## Task 15: RMA detail shell + new/update routes

**Depends on:** Task 13
**Files:**
- Create: `apps/erp/app/routes/x+/sales-return-order+/_layout.tsx`, `new.tsx`, `update.tsx`, `$id.tsx`, `$id._index.tsx`, `$id.details.tsx`, `$id.delete.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderForm.tsx`, `SalesReturnOrderHeader.tsx`, `SalesReturnOrderProperties.tsx`, `SalesReturnOrderExplorer.tsx`
- Copy from (precedent): `x+/sales-order+/_layout.tsx` (+ `$orderId.tsx` shell: `PanelProvider` + `ResizablePanels` + header), `x+/sales-order+/new.tsx` (insert flow), `SalesOrderExplorer.tsx`, `SalesOrderProperties.tsx`; `x+/purchase-order+/new.tsx:72` for the `useCompanyToday()` order-date default
**Steps:**
1. `_layout.tsx`: `handle = { breadcrumb: msg\`Sales\`, to: path.to.sales, module: "sales" }`, bare `<Outlet/>` — the sales-order layout verbatim.
2. `new.tsx`: action `{ create: "sales" }` → `validator(salesReturnOrderValidator).validate` → `insertSalesReturnOrder` → `throw redirect(path.to.salesReturnOrderDetails(id))`. Default export renders `SalesReturnOrderForm` with `orderDate: useCompanyToday()` (the PO precedent — deliberately better than sales-order's empty string), centered `max-w-4xl`.
3. `$id.tsx`: loader `{ view: "sales" }` fetching order + lines + related panels (defer the panels); shell = `SalesReturnOrderHeader` (status badge + Confirm/Cancel/Complete/Credit/Replacement action buttons, permission-gated, wired to the POST routes of Tasks 18-20) above `ResizablePanels{ explorer: SalesReturnOrderExplorer (lines list, add-line button, navigates to line routes), content: <Outlet/>, properties: SalesReturnOrderProperties (customer/location/dates/assignee/customerReference/replacement-link chip) }`. `handle` uses `detailBreadcrumb` with the readable id.
4. `$id._index.tsx`: redirect to details. `$id.details.tsx`: order summary card + related panels — **Receipts** (`getSalesReturnOrderReceipts`, linking to `path.to.receiptDetails`), **Credits** (`getSalesReturnOrderCredits`, linking to `path.to.memo`-equivalent in `x+/credits+`), **Issues** (`getSalesReturnOrderIssues`, linking to `path.to.issue`).
5. `update.tsx`: header-field edit action (`update: "sales"`, `updateSalesReturnOrder`), guarded by `isSalesReturnOrderLocked`. `$id.delete.tsx`: `delete: "sales"`, only when `Draft`/`Cancelled` with no received quantity; `ConfirmDelete` pattern.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** line CRUD routes (Task 16), status actions (Task 18).

---

## Task 16: RMA line routes + line form

**Depends on:** Tasks 8, 15
**Files:**
- Create: `apps/erp/app/routes/x+/sales-return-order+/$id.new.tsx` (new line), `$id.$lineId.details.tsx`, `$id.$lineId.delete.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderLineForm.tsx`, `ReturnableLinesModal.tsx`
- Copy from (precedent): `x+/sales-order+/$orderId.new.tsx` + `$orderId.$lineId.details.tsx` + `SalesOrderLineForm.tsx`; `packages/react/src/TrackedEntityPicker.tsx`; `requireUnlocked` from `~/utils/lockedGuard.server`
**Steps:**
1. `$id.new.tsx`: action-only (`create: "sales"`), `requireUnlocked` on `isSalesReturnOrderLocked`, validate `salesReturnOrderLineValidator`, `upsertSalesReturnOrderLine` + `setSalesReturnOrderLineTrackedEntities` when `trackedEntityIds` present.
2. `SalesReturnOrderLineForm`: fields — `Item` selector, `quantity` (Number, `INPUT_STEP.quantity`), `unitPrice` (Number with `INPUT_FORMAT.rate(currency, decimals)` — a per-unit price, rate kind), `restockFeePercent` (percent-points field: mirror whichever existing form field binds `discountPercent`, including its format/step — grep `discountPercent` in `SalesOrderLineForm.tsx` and copy exactly), `returnReasonId` (Combobox fed by `getReturnReasonsList`), read-only linkage chips when `salesOrderLineId`/`shipmentLineId`/`salesInvoiceLineId` set, disposition select (subset `salesReturnDispositionType`, disabled until `quantityReceived > 0` — submits to the Task 22 disposition route), tracked-entity picker for Serial/Batch items fed by `getShippedTrackedEntitiesForCustomer` (blind lines allow skipping).
3. `ReturnableLinesModal` (the "from document" picker on the new-RMA flow): fetches `getReturnableLinesForCustomer` for the chosen customer (fetcher route: add a small `x+/sales-return-order+/returnable-lines.tsx` loader, or an `api+` route — match how `SalesOrderExplorer` fetches auxiliary data); multi-select rows with editable quantity clamped to `returnableQuantity`; submits multiple line creates to `$id.new`. Client-side clamp is UX only — the authoritative cap is Task 8's confirm-time lock (state this in a comment).
4. `$id.$lineId.details.tsx`: loader + form with `initialValues` from the line (`getCustomFields`), read-only when locked; `$id.$lineId.delete.tsx` standard.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** disposition execution (Task 22); receipt creation.

---

## Task 17: RMA PDF (template type + blocks + file route)

**Depends on:** Tasks 6, 7
**Files:**
- Modify: `packages/documents/src/template/schema.ts` (`documentTemplateTypeSchema` + block union entries if needed), `template/defaults.ts` (`BLOCK_META` unchanged, `DEFAULT_TEMPLATES` + `DOCUMENT_CATALOG` entries), `packages/documents/src/pdf/index.ts`, `pdf/preview-documents.tsx`
- Create: `packages/documents/src/pdf/SalesReturnOrderPDF.tsx`, `pdf/blocks/salesReturnOrder/{types.ts,vars.ts,registry.tsx,HeaderBlock.tsx,PartiesBlock.tsx,LineItemsBlock.tsx,NotesBlock.tsx,TermsBlock.tsx}`, `pdf/salesReturnOrder.samples.ts`
- Create: `apps/erp/app/routes/file+/sales-return-order+/$id[.]pdf.tsx`
- Copy from (precedent): `packages/documents/src/pdf/SalesOrderPDF.tsx` + `pdf/blocks/salesOrder/*` + `salesOrder.samples.ts`; route `apps/erp/app/routes/file+/sales-order+/$id[.]pdf.tsx`

**Steps:**
1. Add `salesReturnOrder` to `documentTemplateTypeSchema` and a `DEFAULT_TEMPLATES.salesReturnOrder` (blocks: header, parties, lineItems, notes, terms — reusing the existing block *types*; no new block type, so no registry-breaking union change). Add the `DOCUMENT_CATALOG` label ("RMA").
2. `pdf/blocks/salesReturnOrder/`: `types.ts` data bag typed off the generated `salesReturnOrders` view Row + line rows + returnReason names; `vars.ts` merge vars (rma number, customer, dates, expiration); block components adapted from the salesOrder ones — LineItems columns: line #, item, description, quantity authorized, unit price, return reason; header shows "Return Merchandise Authorization" + `salesReturnOrderId` + `expirationDate`; parties shows return-to (company location) + customer. `registry.tsx` must key EVERY block type in the union (unused → `() => null`).
3. `SalesReturnOrderPDF.tsx` driver: `resolveTemplate("salesReturnOrder", template)` → `<Template>` loop — the SalesOrderPDF shape. Register in `pdf/index.ts` + `preview-documents.tsx` (`DOCUMENT_PDFS.salesReturnOrder = { Component, sample }`) with a sample fixture.
4. File route: loader `{ view: "sales" }`, `Promise.all` of company/companySettings/salesReturnOrder/lines/returnReasons/location/documentTemplate, then `toDocumentTemplate` → `resolveTemplate` → `resolveSections(collectSectionIds(...))` → `ensureFont` → `renderToStream` → drain to Buffer → `Response` with `Content-Disposition: inline; filename="{company} - {salesReturnOrderId}.pdf"` — the sales-order route verbatim.
5. Check `x+/templates+/$type.tsx` — if the `$type` param validates against `documentTemplateTypeSchema`, the customizer picks the new type up automatically; if there's a hardcoded type list anywhere in the templates routes or `DocumentTemplateEditor/labelConfigs`, extend it. **If adding the type forces changes in more than these known places (schema, defaults, catalog, registries, preview, editor labels), STOP and report the extra coupling before proceeding.**

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents && pnpm exec turbo run typecheck --filter=erp
# Expected: both exit 0
```

**Out of scope:** the purchase-return PDF (Task 27); email sending.

---

## Task 18: RMA status actions (confirm/cancel/complete/line short-close)

**Depends on:** Tasks 8, 15, 17
**Files:**
- Create: `apps/erp/app/routes/x+/sales-return-order+/$id.confirm.tsx`, `$id.status.tsx` (cancel + complete via a `status` field), `$id.$lineId.receiving.tsx` (short-close toggle)
- Modify: `apps/erp/app/modules/shared/shared.server.ts` — `generateAndAttachSalesReturnOrderPdf`
- Modify: `SalesReturnOrderHeader.tsx` (Task 15) — wire the buttons + confirm modal
- Copy from (precedent): `x+/sales-order+/$orderId.confirm.tsx` (PDF generate-and-attach + service-role companyId assertion), `$orderId.status.tsx` (status-field branching + `requestReferrer` redirects — do NOT copy its `path.to.quote(id)` fallback bug), `generateAndAttachSalesOrderPdf` (`shared.server.ts:140`), `x+/purchase-order+/$orderId.$lineId.receiving.tsx`

**Steps:**
1. `$id.confirm.tsx` (POST-only, `assertIsPost`, `{ update: "sales", role: "employee" }`): call `confirmSalesReturnOrder(getDatabaseClient(), …)` in try/catch (Kysely throws; return the thrown cap-violation message via `flash(error(...))`) → on success `generateAndAttachSalesReturnOrderPdf(serviceRole, { companyId, id, userId })` → return `{ success }`.
2. `generateAndAttachSalesReturnOrderPdf`: mirror the sales-order version — call the Task 17 pdf loader with `params.id`, upload to the `private` bucket at `${companyId}/sales-return-order/${id}/${fileName}` (no opportunity dir — RMAs have no opportunity), `upsertDocument(serviceRole, { sourceDocument: "Sales Return Order", sourceDocumentId: id, … })` (the document-type enum already contains the value).
3. `$id.status.tsx` (POST-only, `{ update: "sales" }`): `status` form field validated against `salesReturnOrderStatusType`; `Cancelled` → `cancelSalesReturnOrder` (guard errors → flash); `Completed` → `completeSalesReturnOrder` (blocker list → flash, the joined-message style); reject any other submitted status (receipt-driven statuses are never set manually). `throw redirect(requestReferrer(request) ?? path.to.salesReturnOrderDetails(id))`.
4. `$id.$lineId.receiving.tsx`: `intent: "close" | "reopen"` → `shortCloseSalesReturnOrderLine(getDatabaseClient(), …)` — the PO receiving-route shape, permission `{ update: "sales" }`.
5. Header wiring: Confirm visible on `Draft`; Cancel on `Draft`/`Confirmed` (service re-guards); Complete on `Partially Received`/`Received`; buttons use fetchers to the routes above; PDF download link → `path.to.file.salesReturnOrder(id)` once not Draft.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** email notification on confirm (not in spec — PDF only); receipt-driven transitions (Task 10 owns them).

---

## Task 19: Credit generation (post-memo branch, service, route, dialog)

**Depends on:** Tasks 8, 15
**Files:**
- Modify: `packages/database/supabase/functions/post-memo/index.ts` — reason-account resolution branch (~L233-249)
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `createSalesReturnOrderCredit`
- Create: `apps/erp/app/routes/x+/sales-return-order+/$id.credit.tsx`
- Create: `apps/erp/app/modules/sales/ui/SalesReturnOrders/SalesReturnOrderCreditModal.tsx`
- Copy from (precedent): memo creation in `x+/credits+/new.tsx` (sequence pick + `upsertMemo` field shape); `replaceInvoiceSettlements` (`invoicing.service.ts:1734`) for the locked cap transaction; `MemoForm.tsx` for field conventions

**Steps:**
1. **`post-memo` branch (drift #3)** — in the reason-account derivation, ahead of the existing party-side default:
```ts
const memoRow = /* already loaded */;
const reasonAccountId = memoRow.salesReturnOrderId
  ? (ad.salesReturnsAccount ?? ad.salesAccount)
  : memoRow.purchaseReturnOrderId
    ? ad.goodsReceivedNotInvoicedAccount
    : isAR ? ad.salesDiscountAccount : ad.supplierPaymentDiscountAccount;
```
Both new columns are on the loaded memo row after Task 4's type regen. The void path mirrors the post journal by re-reading stored lines, so it needs no change — verify that assumption by reading the void branch; if void re-derives accounts instead, apply the same branch there. `build-memo-journal.ts` untouched.
2. `createSalesReturnOrderCredit(db: Kysely, { salesReturnOrderId, companyId, userId, lines: { salesReturnOrderLineId, quantity }[] })` — one transaction:
   a. Lock the RMA header + its lines `.forUpdate()`; recompute per-line creditable = `quantityReceived` − Σ existing credit-line quantity over memos `status != 'Voided'` (Draft counts — comment why). Reject any requested quantity above it; reject when the header is `Draft`/`Cancelled`.
   b. `getNextSequence(trx, "creditMemo", companyId)`; compute per-line amount = `quantity × line.unitPrice × (1 − restockFeePercent)`, `restockFee` = `quantity × unitPrice × restockFeePercent`; memo `amount` = Σ line amounts **rounded once at the currency's `decimalPlaces`** via `round(total, currency.decimalPlaces)` from `@carbon/utils` (settlement boundary — numeric-precision rule; fetch decimals from the `currency` table by the RMA's `currencyCode`).
   c. Insert one `memo`: `{ memoId: <sequence>, direction: "Credit", status: "Draft", customerId, currencyCode, exchangeRate, memoDate: today, salesReturnOrderId, companyId, createdBy }` (match `memoValidator`/`upsertMemo` columns exactly — read `x+/credits+/new.tsx` for required fields), then the `salesReturnOrderCreditLine` rows with the stored `restockFee`.
   d. Return the memo id.
3. `$id.credit.tsx` (POST-only, **`create: "invoicing"`** — the same permission as `x+/credits+/new.tsx`): validate `salesReturnOrderCreditValidator`, call the service in try/catch, `throw redirect` to the memo detail (`/x/credits/{memoId}` path helper) with a success flash.
4. `SalesReturnOrderCreditModal`: per-line rows (item, received, already credited, quantity input defaulted to `received − credited`, fee preview line, line total) + grand total — quantities via `useQuantityFormatter`, money via `useCurrencyFormatter` (no inline fraction digits); submits to `$id.credit`. Launch from the header's "Issue Credit" button (visible when any creditable quantity > 0, gated `permissions.can("create", "invoicing")`).
5. Posting/voiding stays entirely in `x+/credits+` — zero changes there.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec biome check packages/database/supabase/functions/post-memo --reporter=summary
# Expected: exit 0 / 0 errors
```

**Out of scope:** credit application to invoices (existing payment flow untouched); AP memo columns beyond the branch above (Task 29 reuses this branch).

---

## Task 20: Replacement sales order

**Depends on:** Tasks 8, 15
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `createReplacementSalesOrder`
- Create: `apps/erp/app/routes/x+/sales-return-order+/$id.replacement.tsx`
- Copy from (precedent): `insertSalesOrder` (`sales.service.ts:5180` — creation + rollback-by-delete), `resolvePrice` (`:2064`), `upsertSalesOrderLine` usage in `x+/sales-order+/$orderId.new.tsx`

**Steps:**
1. `createReplacementSalesOrder(client, { salesReturnOrderId, companyId, companyGroupId, userId })` (app-side — drift #15): guard `replacementSalesOrderId` is null (one replacement per RMA; re-invoke returns the existing id); `insertSalesOrder` with the RMA's customer/location/currency and `customerReference = salesReturnOrder.salesReturnOrderId`; for each RMA line insert a `salesOrderLine` (`saleQuantity = quantity`, `unitPrice` from `resolvePrice(client, companyId, { customerId, itemId, quantity })` — the spec's user-adjusts-for-warranty happens on the draft SO afterwards); on any line failure `deleteSalesOrder` the new order and return the error (the insertSalesOrder rollback pattern); finally set `salesReturnOrder.replacementSalesOrderId`.
2. `$id.replacement.tsx` (POST-only, `{ create: "sales" }`): call service, `throw redirect(path.to.salesOrder(newId))` with success flash.
3. Header button "Create Replacement Order" (hidden once `replacementSalesOrderId` set — then show a link chip to the SO instead; the SO side needs no column, the link lives on the RMA per spec).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** replacement PO (Task 29); pricing UI on the draft SO.

---

## Task 21: Issue association type `salesReturnOrderLines`

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.models.ts` (`nonConformanceAssociationType` array at `:71`; `issueAssociationValidator` refine list `:167-186`)
- Modify: `apps/erp/app/modules/quality/quality.service.ts` (`getIssueAssociations` `:485`, `deleteIssueAssociation` `:86`)
- Modify: `apps/erp/app/routes/x+/issue+/$id.association.new.tsx` (insert switch `:47`), `$id.tsx` (tree literal `:110-207`)
- Modify: `apps/erp/app/modules/quality/ui/Issue/IssueAssociations.tsx` (`getAssociationIcon` `:299`, `getAssociationLink` `:1043`, `NewAssociationModal` switch `:981`, new `NewSalesReturnOrderLineAssociation` form component)
- Copy from (precedent): the `receiptLines` wiring in each of those exact places (the 9-touchpoint map)

**Steps:**
1. Add `"salesReturnOrderLines"` to the const array; it needs `lineId` (a line-level association) so it does NOT join the `.refine` exempt list.
2. `getIssueAssociations`: add the query to the `Promise.all` (`nonConformanceSalesReturnOrderLine` select with denormalized `salesReturnOrderId`/`salesReturnOrderReadableId`), destructure + map to the `{id, documentId, documentReadableId, documentLineId, type}` child shape. `deleteIssueAssociation`: new case.
3. `$id.association.new.tsx`: new insert case resolving the line's `salesReturnOrder` readable id for the denormalized columns (the `receiptLines` case shape).
4. `IssueAssociations.tsx`: icon (a return-arrow lucide icon), link → `path.to.salesReturnOrderLine(documentId, documentLineId)`, `NewSalesReturnOrderLineAssociation` form (customer-agnostic: an RMA combobox then a line combobox — mirror `NewReceiptLineAssociation`'s two-step fetch), modal switch entry.
5. `$id.tsx` tree literal: node `{ key: "salesReturnOrderLines", name: "RMA Line", pluralName: "RMA Lines", module: "sales" }` — the per-node `module` gates visibility on sales permissions (existing `IssueAssociationItem` behavior).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** `purchaseReturnOrderLines` (Task 30); the escalation action (Task 22).

---

## Task 22: RMA dispositions (Use As Is, set-disposition, escalate to Issue)

**Depends on:** Tasks 18, 21
**Files:**
- Create: `apps/erp/app/routes/x+/sales-return-order+/$id.$lineId.disposition.tsx`, `$id.$lineId.issue.tsx`
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `setSalesReturnOrderLineDisposition`
- Copy from (precedent): `x+/inspection+/$id.reject.tsx` (the create-Issue-from-elsewhere flow: `insertIssue` → overwrite item row → pre-associate → `create` edge fn `nonConformanceTasks` → compensating delete); `quality-disposition.server.ts:928-989` (Disposition activity + entity flip shape)

**Steps:**
1. `setSalesReturnOrderLineDisposition(client, { lineId, companyId, disposition, userId })`: guard `quantityReceived > 0`; set the line's `disposition`. For `"Use As Is"`: flip this RMA's received entities for the line (entities in `salesReturnOrderLineTrackedEntity` whose status is `On Hold` — plus blind entities discovered via the receipt-line attribute) to `Available`, and write one `trackedActivity` `{ type: "Disposition", sourceDocument: "Sales Return Order", sourceDocumentId, sourceDocumentReadableId }` + `trackedActivityInput` rows (the quality-disposition shape). Untracked stock: no entity work, no GL (already on hand). For `"Return to Customer"`: just record it (the shipment executes it — Task 23). `"Pending"` resets. `"Scrap"`/`"Rework"` are NOT set here — they arrive via the Issue route below.
2. `$id.$lineId.disposition.tsx` (POST-only, `{ update: "sales" }`): validate `salesReturnOrderDispositionValidator`; reject `Scrap`/`Rework` with a flash pointing at "Escalate to Issue"; call the service.
3. `$id.$lineId.issue.tsx` (POST-only, `{ create: "quality" }` — creating an Issue is a quality act): the inspection-reject sequence adapted: `insertIssue(serviceRole, { items: [line.itemId], … })` with a description naming the RMA + reason; overwrite the seeded `nonConformanceItem` row with the line's received quantity + submitted disposition (`Scrap` or `Rework`); pre-associate `nonConformanceSalesReturnOrderLine` (with denormalized ids) + `nonConformanceTrackedEntity` + `nonConformanceItemTrackedEntity` rows for the line's received entities; invoke `create` `{ type: "nonConformanceTasks" }`, deleting the NCR on failure (the compensating-delete precedent); set the RMA line's `disposition` to the submitted value; `throw redirect(path.to.issue(ncrId))`. The Issue owns approvals + GL from here (`post-nonconformance` via `closeIssue`) — the RMA posts nothing.
4. Line form (Task 16's) wires the disposition select to route 2 and an "Escalate to Issue" button (Scrap/Rework choice) to route 3.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** customer-RMA-FROM-Issue (explicitly deferred); `post-nonconformance` changes (none needed — it's caller-driven); Return-to-Customer execution (Task 23).

---

## Task 23: Return-to-customer shipment (create + post-shipment + UI activation)

**Depends on:** Tasks 10, 22
**Files:**
- Modify: `packages/database/supabase/functions/create/index.ts` — case `shipmentFromSalesReturnOrder`
- Modify: `packages/database/supabase/functions/post-shipment/index.ts` — post + void cases for `"Sales Return Order"`
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — uncomment `"Sales Return Order"` in `shipmentSourceDocumentType` (~line 296)
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentForm/useShipmentForm.tsx`, `apps/erp/app/routes/x+/shipment+/new.tsx`, `$shipmentId.details.tsx` — new branches
- Copy from (precedent): `shipmentFromSalesOrder` (`create/index.ts:1891`) trimmed to the Make-to-Stock path; post-shipment's Sales Order branch (`:113-1243`) and its void (`:1792`)

**Steps:**
1. `create` case `shipmentFromSalesReturnOrder`: lines from RMA lines with `disposition = 'Return to Customer'` and `quantityReceived > 0`; `shippedQuantity` = received quantity not yet shipped back (compute from prior posted shipments of this source — query `shipmentLine` of posted shipments with this `sourceDocumentId` grouped by `lineId`, one query); header `sourceDocument: "Sales Return Order"`, `sourceDocumentId`, `sourceDocumentReadableId`, `customerId`, `locationId`. `unitPrice: 0` (no revenue — it's a rejected claim going home).
2. `post-shipment` post case `"Sales Return Order"`: negative `itemLedger` (`entryType "Negative Adjmt."`, `documentType "Sales Shipment"` — goods leaving to a customer; the return identity lives on the shipment's sourceDocument), cost consumption via `calculateCOGS` per item + a consumption `costLedger` row (the SO-branch shape), journal Dr `costOfGoodsSoldAccount` / Cr `resolveInventoryAccount` at consumed cost, header `sourceType: "Sales Shipment"`; tracked entities → `Consumed` + `trackedActivity { type: "Return Shipment", … }` with `trackedActivityInput` rows; NO salesOrderLine/RMA quantity bumps and NO RMA status change (dispositions already recorded; Complete's guard reads dispositions, not shipped-back counters). Shipment → `Posted`.
3. Void case: mirror the SO void (rebuild positive ledger entries, sign-flip journals, entities back to `On Hold` — their pre-shipment RMA state, NOT `Available` — activity `Void Shipment`), shipment → `Voided`.
4. UI activation: uncomment the enum value; `useShipmentForm` branch listing RMAs `.in("status", ["Partially Received", "Received"])` having any `Return to Customer` line; `new.tsx` + `$shipmentId.details.tsx` switch cases invoking `shipmentFromSalesReturnOrder`.

**Verify:**
```bash
pnpm exec biome check packages/database/supabase/functions/create packages/database/supabase/functions/post-shipment --reporter=summary
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors / exit 0
```

**Out of scope:** the purchase-return shipment branch (Task 25 — keep the cases separate even though both are in post-shipment); packing-slip PDF changes.

---

## Task 24: `purchasing.models.ts` + `purchasing.service.ts` — supplier returns

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts`, `purchasing.service.ts`, module barrel `index.ts`
- Copy from (precedent): Tasks 6-8's sales twins; `insertPurchaseOrder` (`purchasing.service.ts:1395`); `getTrackedEntitiesByMakeMethodId` attribute pattern

**Steps:**
1. Models: `purchaseReturnOrderStatusType` (six values), `isPurchaseReturnOrderLocked`, `purchaseReturnOrderValidator` (supplier fields + `supplierReference`; NO disposition), `purchaseReturnOrderLineValidator` (links `purchaseOrderLineId`/`receiptLineId`/`purchaseInvoiceLineId`; quantities/unitPrice documented **inventory-UOM always**), `purchaseReturnOrderCreditValidator`.
2. Service mirrors of Tasks 7-8 (`getPurchaseReturnOrders` on the view, `insertPurchaseReturnOrder` with `get_next_sequence("purchaseReturnOrder")`, lines CRUD, tracked-entity junction setter, related-panel reads — shipments via `shipment.sourceDocumentId`, credits via `memo.purchaseReturnOrderId`):
3. `getReturnableLinesForSupplier(client, companyId, supplierId, { purchaseOrderId? })` — **source lineage per spec**: base rows are POSTED `receiptLine`s of receipts whose `sourceDocument = 'Purchase Order'` and whose PO belongs to the supplier; quantities already in inventory units. Reversible = `receivedQuantity` − already authorized (aggregate over `purchaseReturnOrderLine.receiptLineId`, non-Cancelled headers, one `.in()`). `unitPrice` (commercial basis) from the linked PO line: `unitPrice / conversionFactor` → inventory-unit price, converted ONCE here at authoring (drift-verified: `purchaseOrderLine.unitPrice` is per purchase unit). Rows carry all three link ids where resolvable. An invoice-only pick that resolves to no posted receipt allocation is returned flagged `blind: true` (explicit blind-return fallback per spec).
4. `getReturnableEntitiesForSupplier(client, companyId, supplierId, itemId)` — `trackedEntity` where `attributes->>Supplier = supplierId` (written by the receipt tracking functions), `.eq("itemId", itemId)`, `.eq("status", "Available")`.
5. `confirmPurchaseReturnOrder(db, …)` — the Task 8 confirm with the cap base = linked `receiptLine.receivedQuantity` (or PO line `quantityReceived × conversionFactor` when only PO-linked) minus other non-cancelled authorizations; `cancelPurchaseReturnOrder` (no posted/pending shipment, `quantityShipped = 0`); `completePurchaseReturnOrder` (every non-closed line `quantityShipped >= quantity` — no disposition guard, there is no disposition); `shortClosePurchaseReturnOrderLine`; `getCreditableQuantitiesForPurchaseReturn` (shipped − credited over non-voided memos).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** routes/UI (Tasks 26-28); edge functions (Task 25).

---

## Task 25: `create` + `post-shipment` — Purchase Return Order branches

**Depends on:** Tasks 4, 24
**Files:**
- Modify: `packages/database/supabase/functions/create/index.ts` — case `shipmentFromPurchaseReturnOrder`
- Modify: `packages/database/supabase/functions/post-shipment/index.ts` — post + void cases for `"Purchase Return Order"`
- Copy from (precedent): Task 23's cases; the SO branch's `calculateCOGS` call + journal pairing; `post-receipt`'s GRNI journal side (`goodsReceivedNotInvoicedAccount` usage)

**Steps:**
1. `create` case `shipmentFromPurchaseReturnOrder`: lines from open return lines (`!closedComplete`, `quantity − quantityShipped > 0`), quantities in inventory units (conversionFactor 1 on the shipment line — conversion already happened at authoring); header `sourceDocument: "Purchase Return Order"`, `supplierId`, location from header.
2. `post-shipment` post case `"Purchase Return Order"`:
   - negative `itemLedger` (`entryType "Negative Adjmt."`, **`documentType "Purchase Return Shipment"`** — the pre-existing unused value), per tracked/untracked site shape;
   - cost: `calculateCOGS(trx, { itemId, quantity, companyId })` per item (standard carried-cost consumption — no policy choice) + one consumption `costLedger` row per item with `itemLedgerType: "Purchase"`, `documentType: "Purchase Return Shipment"`;
   - journal: Cr `resolveInventoryAccount(...)` / Dr `accountDefaults.goodsReceivedNotInvoicedAccount` at consumed cost (reverses the receipt posting), header `sourceType: "Purchase Return Shipment"`. The credit-vs-cost delta to `purchaseVarianceAccount` happens at MEMO POSTING time, not here — the shipment relieves at cost only; note this in a comment (post-memo's GRNI reason leg vs the shipment's GRNI debit nets the GRNI account; any residual is the variance, visible on GRNI until credited — matching how invoice-vs-receipt variances already live on GRNI);
   - tracked entities → `Consumed` + activity `{ type: "Return Shipment", sourceDocument: "Shipment", … }` with input links; partial-batch quantities go through `buildBatchSplitRecords` exactly as the SO branch does;
   - `purchaseReturnOrderLine.quantityShipped` bump + header ladder (`Confirmed → Partially Shipped → Shipped`, skipping `closedComplete` lines); shipment → `Posted`.
3. Void case: mirror Task 23's void — positive ledger rebuild, journal sign-flip, `quantityShipped` rollback + ladder recompute, entities back to `Available` (their pre-shipment state — they were on-hand stock), `Void Shipment` activity, shipment → `Voided`.

**Verify:**
```bash
pnpm exec biome check packages/database/supabase/functions/create packages/database/supabase/functions/post-shipment --reporter=summary
# Expected: 0 errors
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** GRNI/variance journal at memo posting (Task 19's branch already routes the memo's reason leg to GRNI; no further GL work); sales-side branches.

---

## Task 26: Purchasing paths, nav, list route + table

**Depends on:** Tasks 13 (path.ts conventions), 24
**Files:**
- Modify: `apps/erp/app/utils/path.ts`, `apps/erp/app/modules/purchasing/ui/usePurchasingSubmodules.tsx`
- Create: `apps/erp/app/routes/x+/purchasing+/supplier-returns.tsx`
- Create: `apps/erp/app/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrdersTable.tsx`, `PurchaseReturnOrderStatus.tsx`, `index.ts`
- Copy from (precedent): Task 14's sales twins; `x+/purchasing+/orders.tsx`

**Steps:**
1. `path.ts`: the full purchase-return helper set mirroring Task 13 step 1 (`purchaseReturnOrders: ${x}/purchasing/supplier-returns`, detail tree under `${x}/purchase-return-order/…`, `file.purchaseReturnOrder(id)`).
2. Nav: `Manage` group item `{ name: t\`Supplier Returns\`, to: path.to.purchaseReturnOrders, icon: …, table: "purchaseReturnOrder" }`.
3. List route (loader `{ view: "purchasing" }`) + table mirroring Task 14 (supplier via `useSuppliers()` store, shipped progress from the view's `quantityShipped`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** detail tree (Task 28).

---

## Task 27: Supplier return PDF

**Depends on:** Tasks 17 (template plumbing exists), 24
**Files:**
- Modify: `packages/documents/src/template/schema.ts`, `template/defaults.ts`, `pdf/index.ts`, `pdf/preview-documents.tsx`
- Create: `packages/documents/src/pdf/PurchaseReturnOrderPDF.tsx`, `pdf/blocks/purchaseReturnOrder/*`, `pdf/purchaseReturnOrder.samples.ts`
- Create: `apps/erp/app/routes/file+/purchase-return-order+/$id[.]pdf.tsx`
- Copy from (precedent): Task 17's files + `file+/purchase-order+/$orderId[.]pdf.tsx` (view permission `purchasing`)

**Steps:**
1. Add `purchaseReturnOrder` to the template type schema + defaults + catalog ("Supplier Return"); block set mirrors Task 17 with supplier parties, `supplierReference` (the supplier's RMA number) prominent in the header block, and ship-to = supplier address.
2. Driver + registry + samples + `DOCUMENT_PDFS` entry; file route loader `{ view: "purchasing" }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents && pnpm exec turbo run typecheck --filter=erp
# Expected: both exit 0
```

**Out of scope:** email; ZPL.

---

## Task 28: Supplier return detail tree + lines + status actions + shipments UI activation

**Depends on:** Tasks 24, 25, 26, 27
**Files:**
- Create: `apps/erp/app/routes/x+/purchase-return-order+/` — `_layout.tsx`, `new.tsx`, `update.tsx`, `$id.tsx`, `$id._index.tsx`, `$id.details.tsx`, `$id.delete.tsx`, `$id.new.tsx`, `$id.$lineId.details.tsx`, `$id.$lineId.delete.tsx`, `$id.confirm.tsx`, `$id.status.tsx`, `$id.$lineId.receiving.tsx`
- Create: `apps/erp/app/modules/purchasing/ui/PurchaseReturnOrders/` — `PurchaseReturnOrderForm.tsx`, `PurchaseReturnOrderHeader.tsx`, `PurchaseReturnOrderProperties.tsx`, `PurchaseReturnOrderExplorer.tsx`, `PurchaseReturnOrderLineForm.tsx`, `ReturnableReceiptLinesModal.tsx`
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` (uncomment `"Purchase Return Order"` in `shipmentSourceDocumentType`), `useShipmentForm.tsx`, `x+/shipment+/new.tsx`, `$shipmentId.details.tsx` (new branches)
- Modify: `apps/erp/app/modules/shared/shared.server.ts` — `generateAndAttachPurchaseReturnOrderPdf`
- Copy from (precedent): Tasks 15/16/18 sales twins (`handle.module: "purchasing"`, permissions `purchasing_*`); Task 12's activation shape for the shipment side

**Steps:**
1. Detail tree + forms: mirror Tasks 15-16 with supplier selectors (`Supplier`/`SupplierLocation`/`SupplierContact` from `~/components/Form`), `supplierReference` input, line form with the receipt-lineage picker (`ReturnableReceiptLinesModal` fed by `getReturnableLinesForSupplier`; blind rows visibly flagged), entity picker fed by `getReturnableEntitiesForSupplier`, NO disposition field anywhere.
2. Status actions: `$id.confirm.tsx` (Kysely confirm + `generateAndAttachPurchaseReturnOrderPdf`), `$id.status.tsx` (Cancelled/Completed only), `$id.$lineId.receiving.tsx` short-close — the Task 18 shapes with `update: "purchasing"`.
3. Shipments UI activation: uncomment `"Purchase Return Order"`; `useShipmentForm` branch listing returns `.in("status", ["Confirmed", "Partially Shipped"])`; the two route switches invoking `shipmentFromPurchaseReturnOrder`.
4. Related panels on `$id.details.tsx`: Shipments (by `sourceDocumentId`), Credits (`memo.purchaseReturnOrderId`), linked Issues (via `nonConformancePurchaseReturnOrderLine`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** credit/replacement actions (Task 29); the quality bridge (Task 30).

---

## Task 29: Supplier credit + replacement purchase order

**Depends on:** Tasks 19 (post-memo branch already live), 24, 28
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — `createPurchaseReturnOrderCredit`, `createReplacementPurchaseOrder`
- Create: `apps/erp/app/routes/x+/purchase-return-order+/$id.credit.tsx`, `$id.replacement.tsx`
- Create: `apps/erp/app/modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrderCreditModal.tsx`
- Copy from (precedent): Task 19's service/route/modal (direction-flipped); `insertPurchaseOrder` (`purchasing.service.ts:1395`) + supplierPart pricing read (`PurchaseOrderLineForm.tsx:351-418` logic, done server-side via `getSupplierParts` from `items.service.ts:2086`)

**Steps:**
1. `createPurchaseReturnOrderCredit` — Task 19's transaction with: cap = `quantityShipped` − credited (non-voided); memo `{ direction: "Credit", supplierId, purchaseReturnOrderId, … }`; sequence `"creditMemo"` (AP credit memos use the same sequence the credits UI picks for direction Credit — verify against `x+/credits+/new.tsx`'s direction→sequence mapping and use exactly what it uses for an AP credit; if it uses `debitMemo` for supplier-side credits, STOP and report the naming mismatch rather than guessing). `restockFeePercent` reduces our credit (supplier-charged fee).
2. `$id.credit.tsx` (`create: "invoicing"`) + modal — Task 19 mirrors. `post-memo` already routes the reason leg to GRNI via Task 19's branch — no edge-function work here.
3. `createReplacementPurchaseOrder(client, …)`: guard single replacement; `insertPurchaseOrder` with supplier/currency from the return; lines priced from the linked `purchaseOrderLine.unitPrice` (purchase-UOM price + the line's own conversionFactor/UOM copied) else `supplierPart.unitPrice`; rollback-by-delete; set `replacementPurchaseOrderId`. `$id.replacement.tsx` (`create: "purchasing"`) redirects to the new PO.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** memo posting/voiding UI; AP payment application.

---

## Task 30: Issue association `purchaseReturnOrderLines` + quality bridge

**Depends on:** Tasks 21 (touchpoint map), 24, 25, 28
**Files:**
- Modify: the Task 21 file set (quality.models/service, `$id.association.new.tsx`, `$id.tsx`, `IssueAssociations.tsx`) — second association type `purchaseReturnOrderLines`
- Modify: `apps/erp/app/modules/quality/quality-disposition.server.ts` — `closeIssue` guard + write-off reduction + entity-flip exemption
- Create: `apps/erp/app/routes/x+/issue+/$id.supplier-return.tsx`
- Create: `apps/erp/app/modules/quality/ui/Issue/CreateSupplierReturnModal.tsx`
- Modify: `apps/erp/app/modules/quality/ui/Issue/IssueHeader.tsx` (or `$id.details.tsx` disposition row actions — put the button where `AssociatedItemsList` renders the `Return to Supplier` disposition)
- Copy from (precedent): Task 21's wiring; `x+/inspection+/$id.reject.tsx` (multi-step create with compensating delete); `closeIssue`'s blocker collection (`quality-disposition.server.ts:668-708`) and movement builder (`:759-807`)

**Steps:**
1. Association type `purchaseReturnOrderLines`: repeat Task 21's nine touchpoints with `module: "purchasing"` on the tree node.
2. **Create Supplier Return** (`$id.supplier-return.tsx`, POST, `{ create: "purchasing" }`):
   a. Load the issue's `nonConformanceItem` rows with disposition `Return to Supplier` + their `nonConformanceItemTrackedEntity` links + `nonConformanceSupplier` rows + `nonConformanceReceiptLine` associations.
   b. **Supplier resolution** (spec rule): exactly one distinct `nonConformanceSupplier` → that supplier; else derive from the receipt-line associations' parent receipts' `supplierId` (via the receipts' source POs); multiple/none → the modal REQUIRES an explicit `supplierId` + per-row inclusion (an Issue spanning suppliers yields one draft per invocation, scoped to the chosen supplier). Validate every included row's lineage (receipt→PO→supplier, and each tracked entity's `attributes->>Supplier`) against the resolved supplier; reject mismatches naming the row.
   c. **Idempotent coverage**: per disposition row, covered = Σ `quantity` on its `nonConformancePurchaseReturnOrderLine` association rows whose return header is not `Cancelled`; uncovered = row quantity − covered. If nothing is uncovered for the selection → redirect to the newest linked open draft (no new rows).
   d. Create the draft: `insertPurchaseReturnOrder` (Draft, resolved supplier) + one line per uncovered disposition row (inventory-unit quantity = uncovered; `receiptLineId` from the association where resolvable, `unitPrice` from the receipt's PO line converted once; blind otherwise) + `purchaseReturnOrderLineTrackedEntity` picks (the row's entity links, capped to uncovered) + one `nonConformancePurchaseReturnOrderLine` association row per line with `quantity` = the covered amount it now owns (+ denormalized ids). Use sequential service calls with a compensating `deletePurchaseReturnOrder` on partial failure (the inspection-reject pattern). Redirect to the draft.
3. **`closeIssue` changes** (all inside the existing structure):
   a. New preflight + in-lock blocker: any linked `purchaseReturnOrder` (via the association rows) with status `Draft`/`Confirmed`/`Partially Shipped` → blocker "Supplier return {readableId} is open — ship, short-close, or cancel it first".
   b. Movement builder (`:759-807`): for each `Return to Supplier` row, reduce the write-off movement by `min(row quantity, Σ over its association rows of shipped-via-return quantity)` — shipped-via = for each association row, the covered quantity that the linked return line has actually shipped (allocate `quantityShipped` across covering associations; with the one-association-per-line design of 2d this is simply `min(association.quantity, returnLine.quantityShipped)`). Cancelled returns contribute 0 (their unshipped coverage re-enters the write-off pool automatically since blockers only count open returns).
   c. Entity handling: entities that a linked return SHIPPED are already `Consumed` — exempt them from the guard-3 "must not be Consumed" check and from the `Rejected` flip (`:974-989`); they are done. Entities NOT shipped via a return keep today's behavior.
4. Modal + button: on the disposition row (or header) when any `Return to Supplier` disposition exists, gated `permissions.can("create", "purchasing")`; modal shows resolved supplier (or the explicit picker), per-row uncovered quantities, and linked existing returns.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** creating customer RMAs from Issues (deferred spec); `post-nonconformance` edge function (unchanged — the caller computes movements); changing existing `Return to Supplier` close behavior when NO linked return exists (must stay byte-identical).

---

## Task 31: Docs sync + i18n translate

**Depends on:** Tasks 1-30
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md`, `apps/erp/app/modules/purchasing/AGENTS.md`, `apps/erp/app/modules/quality/AGENTS.md` (new tables/services/routes/bridge), `packages/documents/AGENTS.md` if it enumerates document types
- Modify: `packages/locale/locales/*/*.po` (generated by the translate flow)

**Steps:**
1. Update each AGENTS.md's tables/services/routes sections with the return-order additions — claims traced to the real code written above; while there, fix the stale `closeIssue`-location line in quality's AGENTS.md (it moved to `quality-disposition.server.ts`).
2. Run `pnpm lingui:extract` (or the repo's extract script) then invoke the `/translate` skill to fill the new msgstrs.

**Verify:**
```bash
grep -rn "salesReturnOrder" apps/erp/app/modules/sales/AGENTS.md | head -1
# Expected: at least one hit
pnpm run lint
# Expected: exit 0
```

**Out of scope:** the product docs site (`docs/`) — a follow-on; `.claude/rules/` additions.

---

## Task 32: Validation gates

**Depends on:** Task 31
**Steps:**
1. `pnpm run lint` — fix anything the branch introduced.
2. Scoped typechecks (NEVER whole-repo — it OOMs): `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/documents`.
3. `pnpm --filter erp test` (covers `list-select-columns.test.ts` among others) and `cd packages/database/supabase/functions && deno test shared/resolve-return-cost.test.ts shared/short-close.test.ts`.
4. `pnpm run build` only if any packages' build outputs changed (documents did — fonts/templates): `pnpm --filter @carbon/documents build`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/documents && pnpm run lint && pnpm --filter erp test
# Expected: all exit 0
```

**Out of scope:** committing (per-task commits are /execute's job via /check-and-commit).

---

## Task 33: Browser verification via /test

**Depends on:** Task 32
**Steps:** Invoke the `/test` skill against the running dev stack with this scenario list (maps 1:1 to the spec's acceptance criteria; needs a seeded customer+supplier with a shipped/received order — build fixtures through the UI, not raw SQL, per the lessons):
1. RMA from a shipped sales order: pre-filled reversible lines; over-authorization rejected at confirm.
2. Blind RMA end-to-end: create → confirm (RMA-prefixed id + PDF downloads) → receipt (source "Sales Return Order") partial → `Partially Received` → remainder → `Received` → credit → posted memo → `quantityCredited` updates → void memo → reverts.
3. Receipt void restores quantities + status.
4. Costing spot-check (accounting enabled): linked line re-enters at original cost (inspect the journal + costLedger rows via the UI/ledger screens); `inventoryValueZero` reason → 0-value layer, no journal.
5. Serialized round-trip: same `trackedEntity` id On Hold after receipt, `Return Receipt` activity visible in traceability; Use As Is → Available in on-hand; Return to Customer → shipment posts and removes it.
6. Scrap escalation: Issue opens pre-associated; closing it with Scrap posts the write-off (no GL from the RMA).
7. Credit math: 2 of 5 received at 100 with 10% fee → Draft memo 180.
8. Replacement order cross-links both documents.
9. Complete blocked on Pending disposition / short quantity; line short-close unblocks.
10. Supplier return from a posted PO receipt: pre-filled reversible lines; over-authorization rejected; partial ship → `Partially Shipped` → `Shipped`; entities `Consumed` with `Return Shipment` activity; shipment void reverses.
11. Supplier credit: Draft AP memo (GRNI reason account visible after posting), linked via the return; posting/voiding updates credited quantities.
12. Quality bridge: Issue with `Return to Supplier` → Create Supplier Return drafts with resolved supplier + entities; re-invoke drafts nothing new; close blocked while open; after shipping, close writes off only the remainder.
13. Permission spot-checks: RMA routes 403 without `sales`; credit route without `invoicing`; supplier-return routes without `purchasing`.

**Verify:** the /test run report — every scenario green or explicitly triaged.

**Out of scope:** load/perf testing; concurrent-transaction race verification (covered by code review of the `.forUpdate()` transactions — a browser can't drive it deterministically).
