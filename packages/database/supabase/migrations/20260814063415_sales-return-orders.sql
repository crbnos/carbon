-- Returns module, sales side: salesReturnOrder (customer RMAs).
-- Spec: .ai/specs/2026-08-07-rma-module.md — everything additive.
-- 'Sales Return Order' already exists in receiptSourceDocument/shipmentSourceDocument,
-- and 'Sales Return Receipt' in itemLedgerDocumentType — no ALTER needed for those.

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
    PRIMARY KEY ("id"),
    CONSTRAINT "nonConformanceSalesReturnOrderLine_salesReturnOrderLineId_fkey"
      FOREIGN KEY ("salesReturnOrderLineId", "companyId")
      REFERENCES "salesReturnOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_nonConformanceId_idx"
  ON "nonConformanceSalesReturnOrderLine" ("nonConformanceId");
CREATE INDEX IF NOT EXISTS "nonConformanceSalesReturnOrderLine_salesReturnOrderLineId_idx"
  ON "nonConformanceSalesReturnOrderLine" ("salesReturnOrderLineId");
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
      "parentId", "isSystem", "companyGroupId", "createdBy"
    )
    SELECT
      '4900', 'Sales Returns', FALSE,
      'Income'::"accountType",
      'Income Statement'::"glIncomeBalance",
      'Revenue'::"glAccountClass",
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
    WHERE c.id = ad."companyId" AND a.number = '4900' LIMIT 1
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
) lines ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cl."quantity"), 0) AS "quantityCredited"
  FROM "salesReturnOrderCreditLine" cl
  INNER JOIN "memo" m ON m."id" = cl."memoId"
  INNER JOIN "salesReturnOrderLine" l ON l."id" = cl."salesReturnOrderLineId"
  WHERE l."salesReturnOrderId" = sro."id" AND m."status" = 'Posted'
) credits ON TRUE;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE "public"."returnReason" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."returnReason"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."returnReason"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."returnReason"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."returnReason"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."salesReturnOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."salesReturnOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."salesReturnOrder"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."salesReturnOrder"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrderLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."salesReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."salesReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."salesReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."salesReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrderLineTrackedEntity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."salesReturnOrderLineTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."salesReturnOrderLineTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."salesReturnOrderLineTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."salesReturnOrderLineTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."salesReturnOrderCreditLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."salesReturnOrderCreditLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."salesReturnOrderCreditLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."salesReturnOrderCreditLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."salesReturnOrderCreditLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_delete'))::text[])
);

-- NC junction: all four policies on quality_* permissions (sibling pattern —
-- SELECT uses the permission helper here, not the role helper).
ALTER TABLE "public"."nonConformanceSalesReturnOrderLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."nonConformanceSalesReturnOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_view'))::text[])
);
CREATE POLICY "INSERT" ON "public"."nonConformanceSalesReturnOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."nonConformanceSalesReturnOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."nonConformanceSalesReturnOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('quality_delete'))::text[])
);
