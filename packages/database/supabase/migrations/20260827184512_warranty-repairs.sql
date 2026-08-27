-- Warranty & Repairs.
-- Spec: .ai/specs/2026-08-27-warranty-repairs.md — everything additive.
-- Plan: .ai/plans/2026-08-27-warranty-repairs.md (Task 1).
--
-- Layers: (a) warrantyTerm + warrantyRegistration — reusable coverage terms and
-- the per-sold-unit registration stamped when a shipment or sales invoice posts;
-- (b) repairOrder + lines + charges — the repair document that takes custody of a
-- customer unit at ZERO value, optionally ships it to the OEM and receives the
-- SAME unit back, and records parts/service charges with per-charge billing codes.
--
-- FK style follows the returns precedent (20260814063415): composite
-- ("id","companyId") FKs to this module's own parents, single-column FKs to the
-- shared masters whose PK is "id" alone (item, customer, shipmentLine,
-- salesInvoiceLine, salesOrder, quote, purchaseOrder, trackedEntity).

-- ============================================================
-- Enums
-- ============================================================

DO $$ BEGIN
CREATE TYPE "warrantyTermStartBasis" AS ENUM ('Ship Date', 'Invoice Date');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE TYPE "repairOrderStatus" AS ENUM (
  'Draft', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Custody of the customer's unit. 'Scrapped' is terminal, like 'Shipped':
-- a unit in custody must leave through a ship-back or a scrap, never a flag.
DO $$ BEGIN
CREATE TYPE "repairOrderLineStatus" AS ENUM (
  'Pending', 'Received', 'At Supplier', 'Repaired', 'Shipped', 'Scrapped'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE TYPE "repairBillingCode" AS ENUM ('Warranty', 'No Charge', 'Billable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE TYPE "repairOrderChargeType" AS ENUM ('Part', 'Service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ADD VALUE cannot run in the same transaction as its use; these are additive
-- and referenced only by application code / later migrations.
ALTER TYPE "receiptSourceDocument" ADD VALUE IF NOT EXISTS 'Repair Order';
ALTER TYPE "shipmentSourceDocument" ADD VALUE IF NOT EXISTS 'Repair Order';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Repair Receipt';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Repair Shipment';
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Repair Consumption';
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Repair Order';
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Warranty Registration';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Repair Consumption';

-- ============================================================
-- warrantyTerm (reusable coverage definition, attached to items)
-- NULL duration with covers* TRUE = lifetime coverage for that class.
-- ============================================================

CREATE TABLE IF NOT EXISTS "warrantyTerm" (
    "id" TEXT NOT NULL DEFAULT id('wtm'),
    "name" TEXT NOT NULL,
    "coversParts" BOOLEAN NOT NULL DEFAULT TRUE,
    "partsDurationMonths" INTEGER,
    "coversLabor" BOOLEAN NOT NULL DEFAULT TRUE,
    "laborDurationMonths" INTEGER,
    "startBasis" "warrantyTermStartBasis" NOT NULL DEFAULT 'Ship Date',
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
ALTER TABLE "warrantyTerm" ADD CONSTRAINT "warrantyTerm_companyId_name_key"
    UNIQUE ("companyId", "name");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "warrantyTerm_companyId_idx" ON "warrantyTerm" ("companyId");
CREATE INDEX IF NOT EXISTS "warrantyTerm_createdBy_idx" ON "warrantyTerm" ("createdBy");

-- ============================================================
-- warrantyRegistration (one per sold unit; the install-base row)
--
-- Stamping keys decide BOTH idempotency and void cleanup:
--   ship-stamped    -> "shipmentLineId" set, "salesInvoiceLineId" NULL
--   invoice-stamped -> "salesInvoiceLineId" set ("shipmentLineId" = lineage)
--   manual / repair -> both NULL (survives every document void)
-- Cleanup is performed explicitly by the posting functions: a shipment or
-- invoice void reverses status without deleting its line rows, so no FK
-- action can do that job.
-- ============================================================

CREATE TABLE IF NOT EXISTS "warrantyRegistration" (
    "id" TEXT NOT NULL DEFAULT id('wty'),
    "warrantyRegistrationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL REFERENCES "item"("id"),
    "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
    "trackedEntityId" TEXT REFERENCES "trackedEntity"("id") ON DELETE SET NULL,
    "shipmentLineId" TEXT REFERENCES "shipmentLine"("id") ON DELETE SET NULL,
    "salesInvoiceLineId" TEXT REFERENCES "salesInvoiceLine"("id") ON DELETE SET NULL,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "warrantyTermId" TEXT,
    "startDate" DATE NOT NULL,
    "coversParts" BOOLEAN NOT NULL DEFAULT TRUE,
    "partsExpirationDate" DATE,
    "coversLabor" BOOLEAN NOT NULL DEFAULT TRUE,
    "laborExpirationDate" DATE,
    "supplierId" TEXT REFERENCES "supplier"("id") ON DELETE SET NULL,
    "supplierWarrantyExpirationDate" DATE,
    "repairOrderLineId" TEXT,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "warrantyRegistration_warrantyTermId_fkey"
      FOREIGN KEY ("warrantyTermId", "companyId")
      REFERENCES "warrantyTerm"("id", "companyId")
);

DO $$ BEGIN
ALTER TABLE "warrantyRegistration"
  ADD CONSTRAINT "warrantyRegistration_warrantyRegistrationId_companyId_key"
  UNIQUE ("warrantyRegistrationId", "companyId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "warrantyRegistration_companyId_idx" ON "warrantyRegistration" ("companyId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_customerId_idx" ON "warrantyRegistration" ("customerId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_itemId_idx" ON "warrantyRegistration" ("itemId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_trackedEntityId_idx" ON "warrantyRegistration" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_shipmentLineId_idx" ON "warrantyRegistration" ("shipmentLineId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_salesInvoiceLineId_idx" ON "warrantyRegistration" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_warrantyTermId_idx" ON "warrantyRegistration" ("warrantyTermId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_supplierId_idx" ON "warrantyRegistration" ("supplierId");
CREATE INDEX IF NOT EXISTS "warrantyRegistration_createdBy_idx" ON "warrantyRegistration" ("createdBy");

-- Idempotency by constraint: an auto-created row is unique per its OWN stamping
-- line, so a void/re-post cycle can never duplicate registrations.
CREATE UNIQUE INDEX IF NOT EXISTS "warrantyRegistration_ship_tracked_idx"
  ON "warrantyRegistration" ("shipmentLineId", "trackedEntityId", "companyId")
  WHERE "salesInvoiceLineId" IS NULL AND "shipmentLineId" IS NOT NULL AND "trackedEntityId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "warrantyRegistration_ship_untracked_idx"
  ON "warrantyRegistration" ("shipmentLineId", "companyId")
  WHERE "salesInvoiceLineId" IS NULL AND "shipmentLineId" IS NOT NULL AND "trackedEntityId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "warrantyRegistration_invoice_tracked_idx"
  ON "warrantyRegistration" ("salesInvoiceLineId", "trackedEntityId", "companyId")
  WHERE "salesInvoiceLineId" IS NOT NULL AND "trackedEntityId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "warrantyRegistration_invoice_untracked_idx"
  ON "warrantyRegistration" ("salesInvoiceLineId", "companyId")
  WHERE "salesInvoiceLineId" IS NOT NULL AND "trackedEntityId" IS NULL;

-- ============================================================
-- repairOrder (header)
-- ============================================================

CREATE TABLE IF NOT EXISTS "repairOrder" (
    "id" TEXT NOT NULL DEFAULT id('rep'),
    "repairOrderId" TEXT NOT NULL,
    "status" "repairOrderStatus" NOT NULL DEFAULT 'Draft',
    "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
    "customerLocationId" TEXT REFERENCES "customerLocation"("id"),
    "customerContactId" TEXT REFERENCES "customerContact"("id"),
    "customerReference" TEXT,
    "locationId" TEXT REFERENCES "location"("id"),
    "salesReturnOrderId" TEXT,
    "supplierId" TEXT REFERENCES "supplier"("id") ON DELETE SET NULL,
    "supplierReference" TEXT,
    "purchaseOrderId" TEXT REFERENCES "purchaseOrder"("id") ON DELETE SET NULL,
    "quoteId" TEXT REFERENCES "quote"("id") ON DELETE SET NULL,
    "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
    "orderDate" DATE NOT NULL,
    "promisedDate" DATE,
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
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    -- salesReturnOrder's PK is ("id","companyId"), so this FK must be composite.
    CONSTRAINT "repairOrder_salesReturnOrderId_fkey"
      FOREIGN KEY ("salesReturnOrderId", "companyId")
      REFERENCES "salesReturnOrder"("id", "companyId")
      ON DELETE SET NULL ("salesReturnOrderId")
);

DO $$ BEGIN
ALTER TABLE "repairOrder" ADD CONSTRAINT "repairOrder_repairOrderId_companyId_key"
    UNIQUE ("repairOrderId", "companyId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "repairOrder_companyId_idx" ON "repairOrder" ("companyId");
CREATE INDEX IF NOT EXISTS "repairOrder_customerId_idx" ON "repairOrder" ("customerId");
CREATE INDEX IF NOT EXISTS "repairOrder_supplierId_idx" ON "repairOrder" ("supplierId");
CREATE INDEX IF NOT EXISTS "repairOrder_status_idx" ON "repairOrder" ("status");
CREATE INDEX IF NOT EXISTS "repairOrder_locationId_idx" ON "repairOrder" ("locationId");
CREATE INDEX IF NOT EXISTS "repairOrder_salesReturnOrderId_idx" ON "repairOrder" ("salesReturnOrderId");
CREATE INDEX IF NOT EXISTS "repairOrder_createdBy_idx" ON "repairOrder" ("createdBy");

-- One-shot link actions are row-locked check-then-create in the service; these
-- partial uniques are the backstop that keeps even a bug from double-linking.
CREATE UNIQUE INDEX IF NOT EXISTS "repairOrder_quoteId_idx"
  ON "repairOrder" ("quoteId", "companyId") WHERE "quoteId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "repairOrder_salesOrderId_idx"
  ON "repairOrder" ("salesOrderId", "companyId") WHERE "salesOrderId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "repairOrder_purchaseOrderId_idx"
  ON "repairOrder" ("purchaseOrderId", "companyId") WHERE "purchaseOrderId" IS NOT NULL;

-- ============================================================
-- repairOrderLine (one unit under repair)
-- quantity is 1 for tracked lines; untracked legs move the FULL quantity
-- (split the line for partials) so the scalar custody status stays truthful.
-- ============================================================

CREATE TABLE IF NOT EXISTS "repairOrderLine" (
    "id" TEXT NOT NULL DEFAULT id('repl'),
    "repairOrderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT NOT NULL REFERENCES "item"("id"),
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "unitOfMeasureCode" TEXT,
    "status" "repairOrderLineStatus" NOT NULL DEFAULT 'Pending',
    "warrantyRegistrationId" TEXT,
    "underWarranty" BOOLEAN NOT NULL DEFAULT FALSE,
    "returnReasonId" TEXT,
    "salesReturnOrderLineId" TEXT,
    "closedComplete" BOOLEAN NOT NULL DEFAULT FALSE,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "repairOrderLine_repairOrderId_fkey"
      FOREIGN KEY ("repairOrderId", "companyId")
      REFERENCES "repairOrder"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "repairOrderLine_returnReasonId_fkey"
      FOREIGN KEY ("returnReasonId", "companyId")
      REFERENCES "returnReason"("id", "companyId"),
    CONSTRAINT "repairOrderLine_salesReturnOrderLineId_fkey"
      FOREIGN KEY ("salesReturnOrderLineId", "companyId")
      REFERENCES "salesReturnOrderLine"("id", "companyId")
      ON DELETE SET NULL ("salesReturnOrderLineId"),
    CONSTRAINT "repairOrderLine_warrantyRegistrationId_fkey"
      FOREIGN KEY ("warrantyRegistrationId", "companyId")
      REFERENCES "warrantyRegistration"("id", "companyId")
      ON DELETE SET NULL ("warrantyRegistrationId")
);

CREATE INDEX IF NOT EXISTS "repairOrderLine_companyId_idx" ON "repairOrderLine" ("companyId");
CREATE INDEX IF NOT EXISTS "repairOrderLine_repairOrderId_idx" ON "repairOrderLine" ("repairOrderId");
CREATE INDEX IF NOT EXISTS "repairOrderLine_itemId_idx" ON "repairOrderLine" ("itemId");
CREATE INDEX IF NOT EXISTS "repairOrderLine_status_idx" ON "repairOrderLine" ("status");
CREATE INDEX IF NOT EXISTS "repairOrderLine_warrantyRegistrationId_idx" ON "repairOrderLine" ("warrantyRegistrationId");
CREATE INDEX IF NOT EXISTS "repairOrderLine_returnReasonId_idx" ON "repairOrderLine" ("returnReasonId");
CREATE INDEX IF NOT EXISTS "repairOrderLine_createdBy_idx" ON "repairOrderLine" ("createdBy");

-- RMA-spawn idempotency by constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "repairOrderLine_salesReturnOrderLineId_idx"
  ON "repairOrderLine" ("salesReturnOrderLineId", "companyId")
  WHERE "salesReturnOrderLineId" IS NOT NULL;

-- Repair-generated warranty provenance (declared after repairOrderLine exists).
DO $$ BEGIN
ALTER TABLE "warrantyRegistration" ADD CONSTRAINT "warrantyRegistration_repairOrderLineId_fkey"
  FOREIGN KEY ("repairOrderLineId", "companyId")
  REFERENCES "repairOrderLine"("id", "companyId")
  ON DELETE SET NULL ("repairOrderLineId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "warrantyRegistration_repairOrderLineId_idx"
  ON "warrantyRegistration" ("repairOrderLineId");

-- ============================================================
-- repairOrderLineTrackedEntity (the held unit — at most ONE per line)
-- ============================================================

CREATE TABLE IF NOT EXISTS "repairOrderLineTrackedEntity" (
    "repairOrderLineId" TEXT NOT NULL,
    "trackedEntityId" TEXT NOT NULL REFERENCES "trackedEntity"("id") ON DELETE CASCADE,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("repairOrderLineId", "trackedEntityId", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "repairOrderLineTrackedEntity_repairOrderLineId_fkey"
      FOREIGN KEY ("repairOrderLineId", "companyId")
      REFERENCES "repairOrderLine"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "repairOrderLineTrackedEntity_companyId_idx"
  ON "repairOrderLineTrackedEntity" ("companyId");
CREATE INDEX IF NOT EXISTS "repairOrderLineTrackedEntity_trackedEntityId_idx"
  ON "repairOrderLineTrackedEntity" ("trackedEntityId");

-- Exactly one entity per line: the line's scalar custody state describes one unit.
CREATE UNIQUE INDEX IF NOT EXISTS "repairOrderLineTrackedEntity_one_per_line_idx"
  ON "repairOrderLineTrackedEntity" ("repairOrderLineId", "companyId");

-- ============================================================
-- repairOrderCharge (parts consumed + service/fee amounts)
-- billingCode has NO default: the service resolves it from coverage at insert
-- (uncovered/unregistered -> 'Billable'), and it locks once "issuedAt" is set.
-- ============================================================

CREATE TABLE IF NOT EXISTS "repairOrderCharge" (
    "id" TEXT NOT NULL DEFAULT id('repc'),
    "repairOrderId" TEXT NOT NULL,
    "repairOrderLineId" TEXT,
    "chargeType" "repairOrderChargeType" NOT NULL,
    "itemId" TEXT REFERENCES "item"("id"),
    "description" TEXT,
    "quantity" NUMERIC NOT NULL DEFAULT 1,
    "unitPrice" NUMERIC NOT NULL DEFAULT 0,
    "unitCost" NUMERIC NOT NULL DEFAULT 0,
    "billingCode" "repairBillingCode" NOT NULL,
    "issuedAt" TIMESTAMP WITH TIME ZONE,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "repairOrderCharge_repairOrderId_fkey"
      FOREIGN KEY ("repairOrderId", "companyId")
      REFERENCES "repairOrder"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "repairOrderCharge_repairOrderLineId_fkey"
      FOREIGN KEY ("repairOrderLineId", "companyId")
      REFERENCES "repairOrderLine"("id", "companyId")
      ON DELETE SET NULL ("repairOrderLineId"),
    -- A Part charge always names the consumed item.
    CONSTRAINT "repairOrderCharge_partRequiresItem_check"
      CHECK ("chargeType" <> 'Part' OR "itemId" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "repairOrderCharge_companyId_idx" ON "repairOrderCharge" ("companyId");
CREATE INDEX IF NOT EXISTS "repairOrderCharge_repairOrderId_idx" ON "repairOrderCharge" ("repairOrderId");
CREATE INDEX IF NOT EXISTS "repairOrderCharge_repairOrderLineId_idx" ON "repairOrderCharge" ("repairOrderLineId");
CREATE INDEX IF NOT EXISTS "repairOrderCharge_itemId_idx" ON "repairOrderCharge" ("itemId");
CREATE INDEX IF NOT EXISTS "repairOrderCharge_createdBy_idx" ON "repairOrderCharge" ("createdBy");

-- ============================================================
-- Additive columns on existing tables
-- ============================================================

-- The warranty we grant the customer, and the one our supplier grants us.
-- Both nullable: an item with neither simply never auto-registers.
ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "warrantyTermId" TEXT;
ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "supplierWarrantyTermId" TEXT;

DO $$ BEGIN
ALTER TABLE "item" ADD CONSTRAINT "item_warrantyTermId_fkey"
  FOREIGN KEY ("warrantyTermId", "companyId")
  REFERENCES "warrantyTerm"("id", "companyId")
  ON DELETE SET NULL ("warrantyTermId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE "item" ADD CONSTRAINT "item_supplierWarrantyTermId_fkey"
  FOREIGN KEY ("supplierWarrantyTermId", "companyId")
  REFERENCES "warrantyTerm"("id", "companyId")
  ON DELETE SET NULL ("supplierWarrantyTermId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "item_warrantyTermId_idx" ON "item" ("warrantyTermId");
CREATE INDEX IF NOT EXISTS "item_supplierWarrantyTermId_idx" ON "item" ("supplierWarrantyTermId");

-- Nullable BY DESIGN (salesReturnsAccount precedent): runtime falls back to
-- costOfGoodsSoldAccount when unset. No SET NOT NULL phase.
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "warrantyCostAccount" TEXT
  REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Seed the Warranty Expense account (existing company groups)
-- Group headers have no number — resolve the parent by isGroup + name,
-- never by number (precedent: 20260814063415 / 20260630093809).
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
    WHERE "companyGroupId" = cg.id AND "isGroup" = TRUE AND name = 'Cost of Goods Sold'
    LIMIT 1;

    IF parent_id IS NULL THEN
      -- Customized COA without the group header: skip rather than insert an
      -- orphan. accountDefault stays NULL and the app falls back to COGS.
      RAISE WARNING 'companyGroup % has no Cost of Goods Sold group header; skipping Warranty Expense seed', cg.id;
      CONTINUE;
    END IF;

    INSERT INTO "account" (
      number, name, "isGroup", "accountType", "incomeBalance", class,
      "consolidatedRate", "parentId", "isSystem", "companyGroupId", "createdBy"
    )
    SELECT
      '5330', 'Warranty Expense', FALSE,
      'Cost of Goods Sold'::"accountType",
      'Income Statement'::"glIncomeBalance",
      'Expense'::"glAccountClass",
      'Current'::"glConsolidatedRate",
      parent_id, FALSE, cg.id, 'system'
    WHERE NOT EXISTS (
      SELECT 1 FROM "account"
      WHERE "companyGroupId" = cg.id AND number = '5330'
    );
  END LOOP;
END $$;

UPDATE "accountDefault" ad
SET "warrantyCostAccount" = (
  SELECT a.id FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c.id = ad."companyId"
      AND a.number = '5330'
      -- a customized chart may use 5330 for something unrelated; then leave
      -- NULL so the documented costOfGoodsSoldAccount fallback applies
      AND a.name = 'Warranty Expense'
    LIMIT 1
)
WHERE ad."warrantyCostAccount" IS NULL;

-- ============================================================
-- Sequence rows (REP000001 / WTY000001 readable ids)
-- ============================================================

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'repairOrder', 'Repair Order', 'REP', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'warrantyRegistration', 'Warranty Registration', 'WTY', NULL, 0, 6, 1, c."id"
FROM "company" c
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE "public"."warrantyTerm" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."warrantyTerm"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."warrantyTerm"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."warrantyTerm"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."warrantyTerm"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."warrantyRegistration" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."warrantyRegistration"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."warrantyRegistration"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."warrantyRegistration"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."warrantyRegistration"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."repairOrder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."repairOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."repairOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."repairOrder"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."repairOrder"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."repairOrderLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."repairOrderLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."repairOrderLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."repairOrderLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."repairOrderLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."repairOrderLineTrackedEntity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."repairOrderLineTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."repairOrderLineTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."repairOrderLineTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."repairOrderLineTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."repairOrderCharge" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."repairOrderCharge"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."repairOrderCharge"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."repairOrderCharge"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."repairOrderCharge"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

-- ============================================================
-- Views (security_invoker so RLS applies to the reader)
-- ============================================================

-- repairOrders: header + party names + custody rollup for the list screen.
DROP VIEW IF EXISTS "repairOrders";
CREATE VIEW "repairOrders" WITH (security_invoker = true) AS
SELECT
  ro.*,
  c."name" AS "customerName",
  s."name" AS "supplierName",
  COALESCE(lines."linesCount", 0) AS "linesCount",
  COALESCE(lines."linesPending", 0) AS "linesPending",
  COALESCE(lines."linesReceived", 0) AS "linesReceived",
  COALESCE(lines."linesAtSupplier", 0) AS "linesAtSupplier",
  COALESCE(lines."linesRepaired", 0) AS "linesRepaired",
  COALESCE(lines."linesShipped", 0) AS "linesShipped",
  COALESCE(lines."linesScrapped", 0) AS "linesScrapped",
  COALESCE(charges."billableTotal", 0) AS "billableTotal"
FROM "repairOrder" ro
INNER JOIN "customer" c ON c."id" = ro."customerId"
LEFT JOIN "supplier" s ON s."id" = ro."supplierId"
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS "linesCount",
    COUNT(*) FILTER (WHERE l."status" = 'Pending') AS "linesPending",
    COUNT(*) FILTER (WHERE l."status" = 'Received') AS "linesReceived",
    COUNT(*) FILTER (WHERE l."status" = 'At Supplier') AS "linesAtSupplier",
    COUNT(*) FILTER (WHERE l."status" = 'Repaired') AS "linesRepaired",
    COUNT(*) FILTER (WHERE l."status" = 'Shipped') AS "linesShipped",
    COUNT(*) FILTER (WHERE l."status" = 'Scrapped') AS "linesScrapped"
  FROM "repairOrderLine" l
  WHERE l."repairOrderId" = ro."id" AND l."companyId" = ro."companyId"
) lines ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(ch."quantity" * ch."unitPrice"), 0) AS "billableTotal"
  FROM "repairOrderCharge" ch
  WHERE ch."repairOrderId" = ro."id"
    AND ch."companyId" = ro."companyId"
    AND ch."billingCode" = 'Billable'
) charges ON TRUE;

-- warrantyRegistrations: registration + item/customer/serial + derived status
-- per coverage class. A NULL expiration with covers* TRUE is lifetime coverage.
DROP VIEW IF EXISTS "warrantyRegistrations";
CREATE VIEW "warrantyRegistrations" WITH (security_invoker = true) AS
SELECT
  wr.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i."name" AS "itemName",
  i."type" AS "itemType",
  c."name" AS "customerName",
  te."readableId" AS "serialNumber",
  wt."name" AS "warrantyTermName",
  s."name" AS "supplierName",
  CASE
    WHEN wr."coversParts" = FALSE THEN 'Not Covered'
    WHEN wr."partsExpirationDate" IS NULL THEN 'Lifetime'
    WHEN wr."partsExpirationDate" >= CURRENT_DATE THEN 'Active'
    ELSE 'Expired'
  END AS "partsStatus",
  CASE
    WHEN wr."coversLabor" = FALSE THEN 'Not Covered'
    WHEN wr."laborExpirationDate" IS NULL THEN 'Lifetime'
    WHEN wr."laborExpirationDate" >= CURRENT_DATE THEN 'Active'
    ELSE 'Expired'
  END AS "laborStatus",
  CASE
    WHEN wr."shipmentLineId" IS NOT NULL AND wr."salesInvoiceLineId" IS NULL THEN 'Shipment'
    WHEN wr."salesInvoiceLineId" IS NOT NULL THEN 'Invoice'
    WHEN wr."repairOrderLineId" IS NOT NULL THEN 'Repair'
    ELSE 'Manual'
  END AS "source"
FROM "warrantyRegistration" wr
INNER JOIN "item" i ON i."id" = wr."itemId"
INNER JOIN "customer" c ON c."id" = wr."customerId"
LEFT JOIN "trackedEntity" te ON te."id" = wr."trackedEntityId"
LEFT JOIN "warrantyTerm" wt ON wt."id" = wr."warrantyTermId" AND wt."companyId" = wr."companyId"
LEFT JOIN "supplier" s ON s."id" = wr."supplierId";

-- trackedEntityCustody: "where is this customer's unit right now" in one read.
-- Only OPEN repair lines (a shipped-back or scrapped unit is no longer in custody).
DROP VIEW IF EXISTS "trackedEntityCustody";
CREATE VIEW "trackedEntityCustody" WITH (security_invoker = true) AS
SELECT
  rlte."trackedEntityId",
  rl."id" AS "repairOrderLineId",
  rl."status" AS "custodyStatus",
  rl."itemId",
  ro."id" AS "repairOrderId",
  ro."repairOrderId" AS "repairOrderReadableId",
  ro."customerId",
  ro."supplierId",
  ro."companyId"
FROM "repairOrderLineTrackedEntity" rlte
INNER JOIN "repairOrderLine" rl
  ON rl."id" = rlte."repairOrderLineId" AND rl."companyId" = rlte."companyId"
INNER JOIN "repairOrder" ro
  ON ro."id" = rl."repairOrderId" AND ro."companyId" = rl."companyId"
WHERE rl."status" IN ('Pending', 'Received', 'At Supplier', 'Repaired')
  AND ro."status" <> 'Cancelled';
