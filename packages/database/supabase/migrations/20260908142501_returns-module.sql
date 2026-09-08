-- Returns module: salesReturnOrder (customer RMAs) + purchaseReturnOrder
-- (supplier returns). Spec: .ai/specs/2026-08-07-rma-module.md — everything additive.
--
-- Squash of the original three returns migrations (20260814063415_sales-return-orders,
-- 20260814063919_purchase-return-orders, 20260814074003_return-order-document-types —
-- the last was an empty no-op). Content preserved verbatim except:
--   1. CREATE POLICY statements are now DROP-IF-EXISTS + CREATE, so the file is
--      fully idempotent end to end (a DB that ran the pre-squash files re-applies
--      this one cleanly).
--   2. Added the missing indexes on nonConformanceSalesReturnOrderLine("salesReturnOrderId")
--      and nonConformancePurchaseReturnOrderLine("purchaseReturnOrderId") — both are
--      the filter column of getSalesReturnOrderIssues / getPurchaseReturnOrderIssues.
--   3. New enum value 'Sales Return Shipment' (itemLedgerDocumentType +
--      journalEntrySourceType): return-to-customer shipments used to post as
--      'Sales Shipment', double-counting them in shipment reporting and pushing
--      their journals through the always-on external-sync policy.
--   4. Partial unique indexes enforcing one open Draft receipt/shipment per
--      return order — the create routes' redirect-to-existing-draft logic was
--      a check-then-create race with nothing backing it.
--
-- 'Sales Return Order' / 'Purchase Return Order' already exist in
-- receiptSourceDocument/shipmentSourceDocument, and 'Sales Return Receipt' /
-- 'Purchase Return Shipment' in itemLedgerDocumentType — no ALTER needed for those.
-- id prefix is 'pret' (NOT 'pro' — that is procedure's prefix).

-- ############################################################
-- Part 1: Sales side (customer RMAs)
-- ############################################################

-- ============================================================
-- Enums
-- ============================================================

DO $$ BEGIN
CREATE TYPE "salesReturnOrderStatus" AS ENUM (
  'Draft',
  'Confirmed',
  'Partially Received',
  'Received',
  'Completed',
  'Cancelled'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mirrors the pre-existing 'Return to Supplier'. Not referenced elsewhere in
-- this migration (ADD VALUE cannot be used in the same transaction).
ALTER TYPE "disposition" ADD VALUE IF NOT EXISTS 'Return to Customer';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Sales Return Receipt';
-- Return-to-customer shipments get their own ledger/journal identity so they
-- never masquerade as ordinary sales shipments (reporting + sync policy).
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Sales Return Shipment';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Sales Return Shipment';

-- One open Draft per return order: backs the create routes' redirect-to-
-- existing-draft behavior (previously an unbacked check-then-create race).
CREATE UNIQUE INDEX IF NOT EXISTS "receipt_oneOpenDraftPerSalesReturnOrder_idx"
  ON "receipt" ("sourceDocumentId", "companyId")
  WHERE "status" = 'Draft' AND "sourceDocument" = 'Sales Return Order';
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_oneOpenDraftPerSalesReturnOrder_idx"
  ON "shipment" ("sourceDocumentId", "companyId")
  WHERE "status" = 'Draft' AND "sourceDocument" = 'Sales Return Order';
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_oneOpenDraftPerPurchaseReturnOrder_idx"
  ON "shipment" ("sourceDocumentId", "companyId")
  WHERE "status" = 'Draft' AND "sourceDocument" = 'Purchase Return Order';

-- ============================================================
-- returnReason (why — company-defined; shared with purchase returns)
-- ============================================================

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

DO $$ BEGIN
ALTER TABLE "returnReason" ADD CONSTRAINT "returnReason_companyId_name_key"
    UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "returnReason_companyId_idx" ON "returnReason" ("companyId");
CREATE INDEX IF NOT EXISTS "returnReason_createdBy_idx" ON "returnReason" ("createdBy");

-- ============================================================
-- salesReturnOrder (header)
-- ============================================================

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

DO $$ BEGIN
ALTER TABLE "salesReturnOrder" ADD CONSTRAINT "salesReturnOrder_salesReturnOrderId_companyId_key"
    UNIQUE ("salesReturnOrderId", "companyId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "salesReturnOrder_companyId_idx" ON "salesReturnOrder" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_customerId_idx" ON "salesReturnOrder" ("customerId");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_status_idx" ON "salesReturnOrder" ("status");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_createdBy_idx" ON "salesReturnOrder" ("createdBy");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_salesOrderId_idx" ON "salesReturnOrder" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_replacementSalesOrderId_idx" ON "salesReturnOrder" ("replacementSalesOrderId");
CREATE INDEX IF NOT EXISTS "salesReturnOrder_locationId_idx" ON "salesReturnOrder" ("locationId");

-- ============================================================
-- salesReturnOrderLine
-- ============================================================

CREATE TABLE IF NOT EXISTS "salesReturnOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('srol'),
    "salesReturnOrderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT NOT NULL REFERENCES "item"("id"),
    "quantity" NUMERIC NOT NULL,
    "quantityReceived" NUMERIC NOT NULL DEFAULT 0,
    "unitOfMeasureCode" TEXT,
    "unitPrice" NUMERIC NOT NULL DEFAULT 0,
    "restockFeePercent" NUMERIC NOT NULL DEFAULT 0,
    "returnReasonId" TEXT,
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
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    -- Composite tenant FKs: the parents' PKs are ("id","companyId")
    CONSTRAINT "salesReturnOrderLine_salesReturnOrderId_fkey"
      FOREIGN KEY ("salesReturnOrderId", "companyId")
      REFERENCES "salesReturnOrder"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "salesReturnOrderLine_returnReasonId_fkey"
      FOREIGN KEY ("returnReasonId", "companyId")
      REFERENCES "returnReason"("id", "companyId")
);

CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_companyId_idx" ON "salesReturnOrderLine" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_salesReturnOrderId_idx" ON "salesReturnOrderLine" ("salesReturnOrderId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_itemId_idx" ON "salesReturnOrderLine" ("itemId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_salesOrderLineId_idx" ON "salesReturnOrderLine" ("salesOrderLineId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_shipmentLineId_idx" ON "salesReturnOrderLine" ("shipmentLineId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_salesInvoiceLineId_idx" ON "salesReturnOrderLine" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_returnReasonId_idx" ON "salesReturnOrderLine" ("returnReasonId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLine_createdBy_idx" ON "salesReturnOrderLine" ("createdBy");

-- ============================================================
-- salesReturnOrderLineTrackedEntity (expected serials/batches)
-- ============================================================

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
    FOREIGN KEY ("salesReturnOrderLineId", "companyId")
      REFERENCES "salesReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "salesReturnOrderLineTrackedEntity_companyId_idx"
  ON "salesReturnOrderLineTrackedEntity" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderLineTrackedEntity_trackedEntityId_idx"
  ON "salesReturnOrderLineTrackedEntity" ("trackedEntityId");

-- ============================================================
-- salesReturnOrderCreditLine (per-line credit breakdown; memo stays header-level)
-- ============================================================

CREATE TABLE IF NOT EXISTS "salesReturnOrderCreditLine" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "memoId" TEXT NOT NULL REFERENCES "memo"("id") ON DELETE CASCADE,
    "salesReturnOrderLineId" TEXT NOT NULL,
    "quantity" NUMERIC NOT NULL,
    "unitPrice" NUMERIC NOT NULL,
    "restockFee" NUMERIC NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "salesReturnOrderCreditLine_salesReturnOrderLineId_fkey"
      FOREIGN KEY ("salesReturnOrderLineId", "companyId")
      REFERENCES "salesReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "salesReturnOrderCreditLine_companyId_idx" ON "salesReturnOrderCreditLine" ("companyId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderCreditLine_memoId_idx" ON "salesReturnOrderCreditLine" ("memoId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderCreditLine_salesReturnOrderLineId_idx" ON "salesReturnOrderCreditLine" ("salesReturnOrderLineId");
CREATE INDEX IF NOT EXISTS "salesReturnOrderCreditLine_createdBy_idx" ON "salesReturnOrderCreditLine" ("createdBy");

-- ============================================================
-- nonConformanceSalesReturnOrderLine (quality-Issue association junction;
-- mirrors the shape of the existing 10 NC junctions: bare id PK,
-- denormalized parent readable id, quality_* RLS)
-- ============================================================

CREATE TABLE IF NOT EXISTS "nonConformanceSalesReturnOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('ncsro'),
    "nonConformanceId" TEXT NOT NULL REFERENCES "nonConformance"("id") ON DELETE CASCADE,
    "salesReturnOrderLineId" TEXT NOT NULL,
    "salesReturnOrderId" TEXT NOT NULL,
    "salesReturnOrderReadableId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT REFERENCES "user"("id"),
    PRIMARY KEY ("id", "companyId"),
    -- nonConformance has a bare-id PK, so its FK above cannot be composite;
    -- the app stamps companyId from the session on every insert.
    CONSTRAINT "nonConformanceSalesReturnOrderLine_salesReturnOrderLineId_fkey"
      FOREIGN KEY ("salesReturnOrderLineId", "companyId")
      REFERENCES "salesReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_nonConformanceId_idx"
  ON "nonConformanceSalesReturnOrderLine" ("nonConformanceId");
CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_salesReturnOrderLineId_idx"
  ON "nonConformanceSalesReturnOrderLine" ("salesReturnOrderLineId");
CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_salesReturnOrderId_idx"
  ON "nonConformanceSalesReturnOrderLine" ("salesReturnOrderId");
CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_companyId_idx"
  ON "nonConformanceSalesReturnOrderLine" ("companyId");

-- ============================================================
-- Additive columns on existing tables
-- ============================================================

ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "salesReturnOrderId" TEXT;
-- Composite tenant FK; PG15 column-list SET NULL clears only the ref column
-- (precedent: 20260810100100_workflows-foundation.sql "activeVersionId").
DO $$ BEGIN
ALTER TABLE "memo" ADD CONSTRAINT "memo_salesReturnOrderId_fkey"
  FOREIGN KEY ("salesReturnOrderId", "companyId")
  REFERENCES "salesReturnOrder"("id", "companyId")
  ON DELETE SET NULL ("salesReturnOrderId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "memo_salesReturnOrderId_idx" ON "memo" ("salesReturnOrderId");

-- Nullable BY DESIGN (unlike the ar-ap columns): runtime falls back to
-- salesAccount when unset. No SET NOT NULL phase.
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "salesReturnsAccount" TEXT
  REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Seed the Sales Returns contra-revenue account (existing company groups)
-- Precedent: 20260630093809_ar-ap-payments.sql. Group headers have no number —
-- resolve the parent by isGroup + name, never by number.
-- ============================================================

DO $$
DECLARE
  cg RECORD;
  parent_id TEXT;
BEGIN
  FOR cg IN SELECT id FROM "companyGroup"
  LOOP
    SELECT id INTO parent_id
    FROM "account"
    WHERE "companyGroupId" = cg.id AND "isGroup" = TRUE AND name = 'Revenue'
    LIMIT 1;

    IF parent_id IS NULL THEN
      -- Customized COA without a Revenue group header: skip rather than insert
      -- an orphan. accountDefault stays NULL for these companies and the app
      -- falls back to salesAccount.
      RAISE WARNING 'companyGroup % has no Revenue group header; skipping Sales Returns seed', cg.id;
      CONTINUE;
    END IF;

    INSERT INTO "account" (
      number, name, "isGroup", "accountType", "incomeBalance", class,
      "consolidatedRate", "parentId", "isSystem", "companyGroupId", "createdBy"
    )
    SELECT
      '4900', 'Sales Returns', FALSE,
      'Income'::"accountType",
      'Income Statement'::"glIncomeBalance",
      'Revenue'::"glAccountClass",
      -- match seed.data.ts and the sibling revenue accounts (default is 'Current')
      'Average'::"glConsolidatedRate",
      parent_id, FALSE, cg.id, 'system'
    WHERE NOT EXISTS (
      SELECT 1 FROM "account"
      WHERE "companyGroupId" = cg.id AND number = '4900'
    );
  END LOOP;
END $$;

UPDATE "accountDefault" ad
SET "salesReturnsAccount" = (
  SELECT a.id FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c.id = ad."companyId"
      AND a.number = '4900'
      -- a customized chart may use 4900 for something unrelated; then leave
      -- NULL so the documented salesAccount fallback applies
      AND a.name = 'Sales Returns'
    LIMIT 1
)
WHERE ad."salesReturnsAccount" IS NULL;

-- ============================================================
-- Seed returnReason for existing companies
-- ============================================================

INSERT INTO "returnReason" ("name", "inventoryValueZero", "companyId", "createdBy")
SELECT v.name, FALSE, c."id", 'system'
FROM "company" c
CROSS JOIN (VALUES
  ('Defective'),
  ('Wrong Item Shipped'),
  ('Damaged in Transit'),
  ('No Longer Needed'),
  ('Warranty'),
  ('Other')
) AS v(name)
ON CONFLICT ("companyId", "name") DO NOTHING;

-- ============================================================
-- Sequence rows (RMA000001-style readable ids)
-- ============================================================

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'salesReturnOrder', 'Sales Return Order', 'RMA', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;

-- ============================================================
-- salesReturnOrders list view
-- Two separate laterals (salesOrders-view precedent, 20260813222930): the
-- credit aggregate must never share a lateral with the line fan-out, so no
-- sum(DISTINCT) is ever needed. quantityCredited derives from Posted memos
-- only — voiding a memo automatically un-credits.
-- ============================================================

DROP VIEW IF EXISTS "salesReturnOrders";
CREATE VIEW "salesReturnOrders" WITH (security_invoker = true) AS
SELECT
  sro.*,
  COALESCE(lines."linesCount", 0) AS "linesCount",
  COALESCE(lines."quantityAuthorized", 0) AS "quantityAuthorized",
  COALESCE(lines."quantityReceived", 0) AS "quantityReceived",
  COALESCE(credits."quantityCredited", 0) AS "quantityCredited"
FROM "salesReturnOrder" sro
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS "linesCount",
    COALESCE(SUM(l."quantity"), 0) AS "quantityAuthorized",
    COALESCE(SUM(l."quantityReceived"), 0) AS "quantityReceived"
  FROM "salesReturnOrderLine" l
  WHERE l."salesReturnOrderId" = sro."id"
    AND l."companyId" = sro."companyId"
) lines ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cl."quantity"), 0) AS "quantityCredited"
  FROM "salesReturnOrderCreditLine" cl
  INNER JOIN "memo" m ON m."id" = cl."memoId" AND m."companyId" = cl."companyId"
  INNER JOIN "salesReturnOrderLine" l ON l."id" = cl."salesReturnOrderLineId"
    AND l."companyId" = cl."companyId"
  WHERE l."salesReturnOrderId" = sro."id"
    AND cl."companyId" = sro."companyId"
    AND m."status" = 'Posted'
) credits ON TRUE;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE "public"."returnReason" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."returnReason";
CREATE POLICY "SELECT" ON "public"."returnReason"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."returnReason";
CREATE POLICY "INSERT" ON "public"."returnReason"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."returnReason";
CREATE POLICY "UPDATE" ON "public"."returnReason"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."returnReason";
CREATE POLICY "DELETE" ON "public"."returnReason"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrder" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."salesReturnOrder";
CREATE POLICY "SELECT" ON "public"."salesReturnOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."salesReturnOrder";
CREATE POLICY "INSERT" ON "public"."salesReturnOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesReturnOrder";
CREATE POLICY "UPDATE" ON "public"."salesReturnOrder"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."salesReturnOrder";
CREATE POLICY "DELETE" ON "public"."salesReturnOrder"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrderLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."salesReturnOrderLine";
CREATE POLICY "SELECT" ON "public"."salesReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."salesReturnOrderLine";
CREATE POLICY "INSERT" ON "public"."salesReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesReturnOrderLine";
CREATE POLICY "UPDATE" ON "public"."salesReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."salesReturnOrderLine";
CREATE POLICY "DELETE" ON "public"."salesReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrderLineTrackedEntity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."salesReturnOrderLineTrackedEntity";
CREATE POLICY "SELECT" ON "public"."salesReturnOrderLineTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."salesReturnOrderLineTrackedEntity";
CREATE POLICY "INSERT" ON "public"."salesReturnOrderLineTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesReturnOrderLineTrackedEntity";
CREATE POLICY "UPDATE" ON "public"."salesReturnOrderLineTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."salesReturnOrderLineTrackedEntity";
CREATE POLICY "DELETE" ON "public"."salesReturnOrderLineTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrderCreditLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."salesReturnOrderCreditLine";
CREATE POLICY "SELECT" ON "public"."salesReturnOrderCreditLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."salesReturnOrderCreditLine";
CREATE POLICY "INSERT" ON "public"."salesReturnOrderCreditLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."salesReturnOrderCreditLine";
CREATE POLICY "UPDATE" ON "public"."salesReturnOrderCreditLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."salesReturnOrderCreditLine";
CREATE POLICY "DELETE" ON "public"."salesReturnOrderCreditLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_delete'))::text[])
);

-- NC junction: all four policies on quality_* permissions (sibling pattern —
-- SELECT uses the permission helper here, not the role helper).
ALTER TABLE "public"."nonConformanceSalesReturnOrderLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."nonConformanceSalesReturnOrderLine";
CREATE POLICY "SELECT" ON "public"."nonConformanceSalesReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."nonConformanceSalesReturnOrderLine";
CREATE POLICY "INSERT" ON "public"."nonConformanceSalesReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."nonConformanceSalesReturnOrderLine";
CREATE POLICY "UPDATE" ON "public"."nonConformanceSalesReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."nonConformanceSalesReturnOrderLine";
CREATE POLICY "DELETE" ON "public"."nonConformanceSalesReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_delete'))::text[])
);

-- ############################################################
-- Part 2: Purchasing side (supplier returns)
-- Direction-flipped mirror of Part 1; shares returnReason.
-- ############################################################

-- ============================================================
-- Enums
-- ============================================================

DO $$ BEGIN
CREATE TYPE "purchaseReturnOrderStatus" AS ENUM (
  'Draft',
  'Confirmed',
  'Partially Shipped',
  'Shipped',
  'Completed',
  'Cancelled'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Purchase Return Shipment';

-- ============================================================
-- purchaseReturnOrder (header)
-- ============================================================

CREATE TABLE IF NOT EXISTS "purchaseReturnOrder" (
    -- 'pret', not 'pro': id('pro') is already procedure's prefix
    "id" TEXT NOT NULL DEFAULT id('pret'),
    "purchaseReturnOrderId" TEXT NOT NULL,
    "status" "purchaseReturnOrderStatus" NOT NULL DEFAULT 'Draft',
    "supplierId" TEXT NOT NULL REFERENCES "supplier"("id"),
    "supplierLocationId" TEXT REFERENCES "supplierLocation"("id"),
    "supplierContactId" TEXT REFERENCES "supplierContact"("id"),
    "supplierReference" TEXT,
    "locationId" TEXT REFERENCES "location"("id"),
    "purchaseOrderId" TEXT REFERENCES "purchaseOrder"("id") ON DELETE SET NULL,
    "replacementPurchaseOrderId" TEXT REFERENCES "purchaseOrder"("id") ON DELETE SET NULL,
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

DO $$ BEGIN
ALTER TABLE "purchaseReturnOrder" ADD CONSTRAINT "purchaseReturnOrder_purchaseReturnOrderId_companyId_key"
    UNIQUE ("purchaseReturnOrderId", "companyId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "purchaseReturnOrder_companyId_idx" ON "purchaseReturnOrder" ("companyId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrder_supplierId_idx" ON "purchaseReturnOrder" ("supplierId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrder_status_idx" ON "purchaseReturnOrder" ("status");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrder_createdBy_idx" ON "purchaseReturnOrder" ("createdBy");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrder_purchaseOrderId_idx" ON "purchaseReturnOrder" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrder_replacementPurchaseOrderId_idx" ON "purchaseReturnOrder" ("replacementPurchaseOrderId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrder_locationId_idx" ON "purchaseReturnOrder" ("locationId");

-- ============================================================
-- purchaseReturnOrderLine
-- Quantities and unitPrice are ALWAYS in the item's inventory unit of
-- measure — purchase-UOM conversion happens once at authoring.
-- No disposition column: goods leave; nothing to disposition.
-- ============================================================

CREATE TABLE IF NOT EXISTS "purchaseReturnOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('pretl'),
    "purchaseReturnOrderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT NOT NULL REFERENCES "item"("id"),
    "quantity" NUMERIC NOT NULL,
    "quantityShipped" NUMERIC NOT NULL DEFAULT 0,
    "unitOfMeasureCode" TEXT,
    "unitPrice" NUMERIC NOT NULL DEFAULT 0,
    "restockFeePercent" NUMERIC NOT NULL DEFAULT 0,
    "returnReasonId" TEXT,
    "purchaseOrderLineId" TEXT REFERENCES "purchaseOrderLine"("id") ON DELETE SET NULL,
    "receiptLineId" TEXT REFERENCES "receiptLine"("id") ON DELETE SET NULL,
    "purchaseInvoiceLineId" TEXT REFERENCES "purchaseInvoiceLine"("id") ON DELETE SET NULL,
    "closedComplete" BOOLEAN NOT NULL DEFAULT FALSE,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "purchaseReturnOrderLine_purchaseReturnOrderId_fkey"
      FOREIGN KEY ("purchaseReturnOrderId", "companyId")
      REFERENCES "purchaseReturnOrder"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "purchaseReturnOrderLine_returnReasonId_fkey"
      FOREIGN KEY ("returnReasonId", "companyId")
      REFERENCES "returnReason"("id", "companyId")
);

CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_companyId_idx" ON "purchaseReturnOrderLine" ("companyId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_purchaseReturnOrderId_idx" ON "purchaseReturnOrderLine" ("purchaseReturnOrderId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_itemId_idx" ON "purchaseReturnOrderLine" ("itemId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_purchaseOrderLineId_idx" ON "purchaseReturnOrderLine" ("purchaseOrderLineId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_receiptLineId_idx" ON "purchaseReturnOrderLine" ("receiptLineId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_purchaseInvoiceLineId_idx" ON "purchaseReturnOrderLine" ("purchaseInvoiceLineId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_returnReasonId_idx" ON "purchaseReturnOrderLine" ("returnReasonId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLine_createdBy_idx" ON "purchaseReturnOrderLine" ("createdBy");

-- ============================================================
-- purchaseReturnOrderLineTrackedEntity (entities to send back)
-- ============================================================

CREATE TABLE IF NOT EXISTS "purchaseReturnOrderLineTrackedEntity" (
    "purchaseReturnOrderLineId" TEXT NOT NULL,
    "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id") ON DELETE CASCADE,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("purchaseReturnOrderLineId", "trackedEntityId", "companyId"),
    FOREIGN KEY ("purchaseReturnOrderLineId", "companyId")
      REFERENCES "purchaseReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLineTrackedEntity_companyId_idx"
  ON "purchaseReturnOrderLineTrackedEntity" ("companyId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderLineTrackedEntity_trackedEntityId_idx"
  ON "purchaseReturnOrderLineTrackedEntity" ("trackedEntityId");

-- ============================================================
-- purchaseReturnOrderCreditLine
-- ============================================================

CREATE TABLE IF NOT EXISTS "purchaseReturnOrderCreditLine" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "memoId" TEXT NOT NULL REFERENCES "memo"("id") ON DELETE CASCADE,
    "purchaseReturnOrderLineId" TEXT NOT NULL,
    "quantity" NUMERIC NOT NULL,
    "unitPrice" NUMERIC NOT NULL,
    "restockFee" NUMERIC NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "purchaseReturnOrderCreditLine_purchaseReturnOrderLineId_fkey"
      FOREIGN KEY ("purchaseReturnOrderLineId", "companyId")
      REFERENCES "purchaseReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "purchaseReturnOrderCreditLine_companyId_idx" ON "purchaseReturnOrderCreditLine" ("companyId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderCreditLine_memoId_idx" ON "purchaseReturnOrderCreditLine" ("memoId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderCreditLine_purchaseReturnOrderLineId_idx" ON "purchaseReturnOrderCreditLine" ("purchaseReturnOrderLineId");
CREATE INDEX IF NOT EXISTS "purchaseReturnOrderCreditLine_createdBy_idx" ON "purchaseReturnOrderCreditLine" ("createdBy");

-- ============================================================
-- nonConformancePurchaseReturnOrderLine (Issue <-> supplier-return bridge)
-- Sibling NC-junction shape PLUS a quantity column: each association row
-- records the issue quantity it covers (per-quantity ownership; makes
-- Create Supplier Return idempotent and the close write-off exact).
-- ============================================================

CREATE TABLE IF NOT EXISTS "nonConformancePurchaseReturnOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('ncpro'),
    "nonConformanceId" TEXT NOT NULL REFERENCES "nonConformance"("id") ON DELETE CASCADE,
    "purchaseReturnOrderLineId" TEXT NOT NULL,
    "purchaseReturnOrderId" TEXT NOT NULL,
    "purchaseReturnOrderReadableId" TEXT NOT NULL,
    "quantity" NUMERIC NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT REFERENCES "user"("id"),
    PRIMARY KEY ("id", "companyId"),
    -- nonConformance has a bare-id PK, so its FK above cannot be composite;
    -- the app stamps companyId from the session on every insert.
    CONSTRAINT "nonConformancePurchaseReturnOrderLine_lineId_fkey"
      FOREIGN KEY ("purchaseReturnOrderLineId", "companyId")
      REFERENCES "purchaseReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "nonConformancePurchaseReturnOrderLine_nonConformanceId_idx"
  ON "nonConformancePurchaseReturnOrderLine" ("nonConformanceId");
CREATE INDEX IF NOT EXISTS "nonConformancePurchaseReturnOrderLine_lineId_idx"
  ON "nonConformancePurchaseReturnOrderLine" ("purchaseReturnOrderLineId");
CREATE INDEX IF NOT EXISTS "nonConformancePurchaseReturnOrderLine_purchaseReturnOrderId_idx"
  ON "nonConformancePurchaseReturnOrderLine" ("purchaseReturnOrderId");
CREATE INDEX IF NOT EXISTS "nonConformancePurchaseReturnOrderLine_companyId_idx"
  ON "nonConformancePurchaseReturnOrderLine" ("companyId");

-- ============================================================
-- Additive columns on existing tables
-- ============================================================

ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "purchaseReturnOrderId" TEXT;
DO $$ BEGIN
ALTER TABLE "memo" ADD CONSTRAINT "memo_purchaseReturnOrderId_fkey"
  FOREIGN KEY ("purchaseReturnOrderId", "companyId")
  REFERENCES "purchaseReturnOrder"("id", "companyId")
  ON DELETE SET NULL ("purchaseReturnOrderId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "memo_purchaseReturnOrderId_idx" ON "memo" ("purchaseReturnOrderId");

-- ============================================================
-- Sequence rows (RTS000001-style readable ids)
-- ============================================================

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'purchaseReturnOrder', 'Purchase Return Order', 'RTS', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;

-- ============================================================
-- purchaseReturnOrders list view (mirror of salesReturnOrders)
-- ============================================================

DROP VIEW IF EXISTS "purchaseReturnOrders";
CREATE VIEW "purchaseReturnOrders" WITH (security_invoker = true) AS
SELECT
  pret.*,
  COALESCE(lines."linesCount", 0) AS "linesCount",
  COALESCE(lines."quantityAuthorized", 0) AS "quantityAuthorized",
  COALESCE(lines."quantityShipped", 0) AS "quantityShipped",
  COALESCE(credits."quantityCredited", 0) AS "quantityCredited"
FROM "purchaseReturnOrder" pret
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS "linesCount",
    COALESCE(SUM(l."quantity"), 0) AS "quantityAuthorized",
    COALESCE(SUM(l."quantityShipped"), 0) AS "quantityShipped"
  FROM "purchaseReturnOrderLine" l
  WHERE l."purchaseReturnOrderId" = pret."id"
    AND l."companyId" = pret."companyId"
) lines ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cl."quantity"), 0) AS "quantityCredited"
  FROM "purchaseReturnOrderCreditLine" cl
  INNER JOIN "memo" m ON m."id" = cl."memoId" AND m."companyId" = cl."companyId"
  INNER JOIN "purchaseReturnOrderLine" l ON l."id" = cl."purchaseReturnOrderLineId"
    AND l."companyId" = cl."companyId"
  WHERE l."purchaseReturnOrderId" = pret."id"
    AND cl."companyId" = pret."companyId"
    AND m."status" = 'Posted'
) credits ON TRUE;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE "public"."purchaseReturnOrder" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."purchaseReturnOrder";
CREATE POLICY "SELECT" ON "public"."purchaseReturnOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."purchaseReturnOrder";
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."purchaseReturnOrder";
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrder"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."purchaseReturnOrder";
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrder"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

ALTER TABLE "public"."purchaseReturnOrderLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."purchaseReturnOrderLine";
CREATE POLICY "SELECT" ON "public"."purchaseReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."purchaseReturnOrderLine";
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."purchaseReturnOrderLine";
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."purchaseReturnOrderLine";
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

ALTER TABLE "public"."purchaseReturnOrderLineTrackedEntity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."purchaseReturnOrderLineTrackedEntity";
CREATE POLICY "SELECT" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."purchaseReturnOrderLineTrackedEntity";
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."purchaseReturnOrderLineTrackedEntity";
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."purchaseReturnOrderLineTrackedEntity";
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

ALTER TABLE "public"."purchaseReturnOrderCreditLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."purchaseReturnOrderCreditLine";
CREATE POLICY "SELECT" ON "public"."purchaseReturnOrderCreditLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."purchaseReturnOrderCreditLine";
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrderCreditLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."purchaseReturnOrderCreditLine";
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrderCreditLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."purchaseReturnOrderCreditLine";
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrderCreditLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_delete'))::text[])
);

ALTER TABLE "public"."nonConformancePurchaseReturnOrderLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."nonConformancePurchaseReturnOrderLine";
CREATE POLICY "SELECT" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."nonConformancePurchaseReturnOrderLine";
CREATE POLICY "INSERT" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."nonConformancePurchaseReturnOrderLine";
CREATE POLICY "UPDATE" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."nonConformancePurchaseReturnOrderLine";
CREATE POLICY "DELETE" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_delete'))::text[])
);
