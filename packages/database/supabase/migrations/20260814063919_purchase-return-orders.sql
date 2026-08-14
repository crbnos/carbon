-- Returns module, purchasing side: purchaseReturnOrder (supplier returns).
-- Direction-flipped mirror of 20260814063415_sales-return-orders.sql.
-- 'Purchase Return Order' already exists in shipmentSourceDocument and
-- 'Purchase Return Shipment' in itemLedgerDocumentType — no ALTER needed.
-- id prefix is 'pret' (NOT 'pro' — that is procedure's prefix).

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
    PRIMARY KEY ("id"),
    CONSTRAINT "nonConformancePurchaseReturnOrderLine_lineId_fkey"
      FOREIGN KEY ("purchaseReturnOrderLineId", "companyId")
      REFERENCES "purchaseReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "nonConformancePurchaseReturnOrderLine_nonConformanceId_idx"
  ON "nonConformancePurchaseReturnOrderLine" ("nonConformanceId");
CREATE INDEX IF NOT EXISTS "nonConformancePurchaseReturnOrderLine_lineId_idx"
  ON "nonConformancePurchaseReturnOrderLine" ("purchaseReturnOrderLineId");
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
) lines ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cl."quantity"), 0) AS "quantityCredited"
  FROM "purchaseReturnOrderCreditLine" cl
  INNER JOIN "memo" m ON m."id" = cl."memoId"
  INNER JOIN "purchaseReturnOrderLine" l ON l."id" = cl."purchaseReturnOrderLineId"
  WHERE l."purchaseReturnOrderId" = pret."id" AND m."status" = 'Posted'
) credits ON TRUE;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE "public"."purchaseReturnOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."purchaseReturnOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrder"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrder"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

ALTER TABLE "public"."purchaseReturnOrderLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."purchaseReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

ALTER TABLE "public"."purchaseReturnOrderLineTrackedEntity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrderLineTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

ALTER TABLE "public"."purchaseReturnOrderCreditLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."purchaseReturnOrderCreditLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."purchaseReturnOrderCreditLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."purchaseReturnOrderCreditLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."purchaseReturnOrderCreditLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_delete'))::text[])
);

ALTER TABLE "public"."nonConformancePurchaseReturnOrderLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_view'))::text[])
);
CREATE POLICY "INSERT" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."nonConformancePurchaseReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_delete'))::text[])
);
