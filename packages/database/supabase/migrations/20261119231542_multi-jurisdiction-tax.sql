-- Multi-jurisdiction tax, Phase 1 (.ai/specs/2026-10-16-multi-jurisdiction-tax.md).
-- Tax codes with components, authorities, registrations, the tax subledger,
-- the Odoo-style tax account names, and taxCodeId on every in-scope document.
-- RLS rules live in packages/database/src/authz/manifest.ts.

-- The file runs as one transaction and takes locks on live tables (the new
-- tables' FKs lock journal, customer, supplier; the ALTERs lock the document
-- tables): give up after 5s behind a long transaction (the migration is
-- re-run) rather than queue every reader and writer behind it.
SET lock_timeout = '5s';

-- Enums
DO $$ BEGIN
  CREATE TYPE "taxCalculationType" AS ENUM ('Normal', 'Reverse Charge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "taxReportingCategory" AS ENUM
    ('Standard', 'Reduced', 'Zero-Rated', 'Exempt', 'Reverse Charge', 'Export', 'Out of Scope');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "taxLedgerSource" AS ENUM ('Sales', 'Purchase');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authorities
CREATE TABLE IF NOT EXISTS "taxAuthority" (
  "id" TEXT NOT NULL DEFAULT id('txa'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "supplierId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "taxAuthority_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxAuthority_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxAuthority_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
    REFERENCES "supplier"("id", "companyId") ON DELETE SET NULL ("supplierId"),
  CONSTRAINT "taxAuthority_name_key" UNIQUE ("companyId", "name")
);
CREATE INDEX IF NOT EXISTS "taxAuthority_companyId_idx" ON "taxAuthority" ("companyId");
CREATE INDEX IF NOT EXISTS "taxAuthority_supplierId_idx" ON "taxAuthority" ("supplierId");
CREATE INDEX IF NOT EXISTS "taxAuthority_createdBy_idx" ON "taxAuthority" ("createdBy");

-- Codes
CREATE TABLE IF NOT EXISTS "taxCode" (
  "id" TEXT NOT NULL DEFAULT id('txc'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "calculationType" "taxCalculationType" NOT NULL DEFAULT 'Normal',
  "reportingCategory" "taxReportingCategory" NOT NULL DEFAULT 'Standard',
  "taxesShipping" BOOLEAN NOT NULL DEFAULT FALSE,
  "invoiceMessage" TEXT,
  "countryCode" TEXT REFERENCES "country"("alpha2"),
  "state" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "taxCode_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxCode_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxCode_name_key" UNIQUE ("companyId", "name")
);
CREATE INDEX IF NOT EXISTS "taxCode_companyId_idx" ON "taxCode" ("companyId");
CREATE INDEX IF NOT EXISTS "taxCode_countryCode_idx" ON "taxCode" ("countryCode");
CREATE INDEX IF NOT EXISTS "taxCode_createdBy_idx" ON "taxCode" ("createdBy");

-- Components
CREATE TABLE IF NOT EXISTS "taxCodeComponent" (
  "id" TEXT NOT NULL DEFAULT id('txcc'),
  "companyId" TEXT NOT NULL,
  "taxCodeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "taxAuthorityId" TEXT,
  "taxPercent" NUMERIC NOT NULL,
  "recoverablePercent" NUMERIC NOT NULL DEFAULT 0,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "isCompound" BOOLEAN NOT NULL DEFAULT FALSE,
  "taxReceivedAccountId" TEXT,
  "taxPaidAccountId" TEXT,
  "effectiveDate" DATE,
  "expirationDate" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "taxCodeComponent_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxCodeComponent_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "taxCodeComponent_taxCodeId_fkey" FOREIGN KEY ("taxCodeId", "companyId")
    REFERENCES "taxCode"("id", "companyId") ON DELETE CASCADE,
  -- deleteTaxAuthority refuses first, with the counts; this holds for a
  -- direct delete too.
  CONSTRAINT "taxCodeComponent_taxAuthorityId_fkey" FOREIGN KEY ("taxAuthorityId", "companyId")
    REFERENCES "taxAuthority"("id", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "taxCodeComponent_taxReceivedAccountId_fkey" FOREIGN KEY ("taxReceivedAccountId")
    REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "taxCodeComponent_taxPaidAccountId_fkey" FOREIGN KEY ("taxPaidAccountId")
    REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "taxCodeComponent_taxPercent_check" CHECK ("taxPercent" >= 0 AND "taxPercent" <= 1),
  CONSTRAINT "taxCodeComponent_recoverablePercent_check"
    CHECK ("recoverablePercent" >= 0 AND "recoverablePercent" <= 1),
  CONSTRAINT "taxCodeComponent_dates_check"
    CHECK ("expirationDate" IS NULL OR "effectiveDate" IS NULL OR "expirationDate" >= "effectiveDate")
);
CREATE INDEX IF NOT EXISTS "taxCodeComponent_companyId_idx" ON "taxCodeComponent" ("companyId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxCodeId_idx" ON "taxCodeComponent" ("taxCodeId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxAuthorityId_idx" ON "taxCodeComponent" ("taxAuthorityId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxReceivedAccountId_idx" ON "taxCodeComponent" ("taxReceivedAccountId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_taxPaidAccountId_idx" ON "taxCodeComponent" ("taxPaidAccountId");
CREATE INDEX IF NOT EXISTS "taxCodeComponent_createdBy_idx" ON "taxCodeComponent" ("createdBy");

-- Registrations
CREATE TABLE IF NOT EXISTS "taxRegistration" (
  "id" TEXT NOT NULL DEFAULT id('txr'),
  "companyId" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL REFERENCES "country"("alpha2"),
  "state" TEXT,
  "registrationNumber" TEXT NOT NULL,
  "effectiveDate" DATE,
  "endDate" DATE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "taxRegistration_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxRegistration_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "taxRegistration_companyId_idx" ON "taxRegistration" ("companyId");
CREATE INDEX IF NOT EXISTS "taxRegistration_countryCode_idx" ON "taxRegistration" ("countryCode");
CREATE INDEX IF NOT EXISTS "taxRegistration_createdBy_idx" ON "taxRegistration" ("createdBy");

-- Ledger
CREATE TABLE IF NOT EXISTS "taxLedger" (
  "id" TEXT NOT NULL DEFAULT id('txl'),
  "companyId" TEXT NOT NULL,
  "source" "taxLedgerSource" NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentLineId" TEXT,
  "journalId" TEXT NOT NULL,
  "postingDate" DATE NOT NULL,
  "taxCodeId" TEXT,
  "taxCodeComponentId" TEXT,
  "componentName" TEXT,
  "taxAuthorityId" TEXT,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0,
  "recoverablePercent" NUMERIC NOT NULL DEFAULT 0,
  "customerId" TEXT,
  "supplierId" TEXT,
  "taxableAmount" NUMERIC NOT NULL DEFAULT 0,
  "taxAmount" NUMERIC NOT NULL DEFAULT 0,
  "recoverableAmount" NUMERIC NOT NULL DEFAULT 0,
  "exemptAmount" NUMERIC NOT NULL DEFAULT 0,
  "documentTaxableAmount" NUMERIC NOT NULL DEFAULT 0,
  "documentTaxAmount" NUMERIC NOT NULL DEFAULT 0,
  "currencyCode" TEXT,
  "exchangeRate" NUMERIC,
  "taxExemptionReason" "taxExemptionReason",
  "exemptionCertificateNumber" TEXT,
  -- The company owes the tax itself (a Reverse Charge purchase), recorded at
  -- posting so the liability report never reads the live code.
  "selfAssessed" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  CONSTRAINT "taxLedger_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxLedger_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Real FKs, so a restore into another company remaps them; documentId and
  -- documentLineId are polymorphic and listed in ID_REF_COLUMNS instead.
  CONSTRAINT "taxLedger_journalId_fkey" FOREIGN KEY ("journalId")
    REFERENCES "journal"("id"),
  CONSTRAINT "taxLedger_taxCodeId_fkey" FOREIGN KEY ("taxCodeId", "companyId")
    REFERENCES "taxCode"("id", "companyId") ON DELETE SET NULL ("taxCodeId"),
  CONSTRAINT "taxLedger_taxCodeComponentId_fkey" FOREIGN KEY ("taxCodeComponentId", "companyId")
    REFERENCES "taxCodeComponent"("id", "companyId") ON DELETE SET NULL ("taxCodeComponentId"),
  -- Filed figures keep their authority: deleteTaxAuthority refuses first.
  CONSTRAINT "taxLedger_taxAuthorityId_fkey" FOREIGN KEY ("taxAuthorityId", "companyId")
    REFERENCES "taxAuthority"("id", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "taxLedger_customerId_fkey" FOREIGN KEY ("customerId", "companyId")
    REFERENCES "customer"("id", "companyId") ON DELETE SET NULL ("customerId"),
  CONSTRAINT "taxLedger_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
    REFERENCES "supplier"("id", "companyId") ON DELETE SET NULL ("supplierId")
);
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_postingDate_idx" ON "taxLedger" ("companyId", "postingDate");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_documentId_idx" ON "taxLedger" ("companyId", "documentId");
CREATE INDEX IF NOT EXISTS "taxLedger_journalId_idx" ON "taxLedger" ("journalId");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_taxAuthorityId_idx" ON "taxLedger" ("companyId", "taxAuthorityId");
CREATE INDEX IF NOT EXISTS "taxLedger_taxCodeId_idx" ON "taxLedger" ("taxCodeId");
CREATE INDEX IF NOT EXISTS "taxLedger_taxCodeComponentId_idx" ON "taxLedger" ("taxCodeComponentId");
CREATE INDEX IF NOT EXISTS "taxLedger_customerId_idx" ON "taxLedger" ("customerId");
CREATE INDEX IF NOT EXISTS "taxLedger_supplierId_idx" ON "taxLedger" ("supplierId");
CREATE INDEX IF NOT EXISTS "taxLedger_createdBy_idx" ON "taxLedger" ("createdBy");

-- Account-default renames (grill 2). No live SQL function reads the old names.
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME COLUMN "salesTaxPayableAccount" TO "taxReceivedAccount";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME COLUMN "purchaseTaxPayableAccount" TO "taxPaidAccount";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME CONSTRAINT "accountDefault_salesTaxPayableAccount_fkey" TO "accountDefault_taxReceivedAccount_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME CONSTRAINT "accountDefault_purchaseTaxPayableAccount_fkey" TO "accountDefault_taxPaidAccount_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Columns
ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "taxable" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "taxAmount" NUMERIC NOT NULL DEFAULT 0;

-- taxCodeId on every in-scope document and on the party tax records
ALTER TABLE "customerTax" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "customerTax" ADD CONSTRAINT "customerTax_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "customerTax_taxCodeId_idx" ON "customerTax" ("taxCodeId");

ALTER TABLE "supplierTax" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "supplierTax" ADD CONSTRAINT "supplierTax_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "supplierTax_taxCodeId_idx" ON "supplierTax" ("taxCodeId");

ALTER TABLE "customerLocation" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "customerLocation" ADD CONSTRAINT "customerLocation_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "customerLocation_taxCodeId_idx" ON "customerLocation" ("taxCodeId");

ALTER TABLE "quoteLine" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "quoteLine" ADD CONSTRAINT "quoteLine_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "quoteLine_taxCodeId_idx" ON "quoteLine" ("taxCodeId");

ALTER TABLE "salesOrderLine" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "salesOrderLine" ADD CONSTRAINT "salesOrderLine_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "salesOrderLine_taxCodeId_idx" ON "salesOrderLine" ("taxCodeId");

ALTER TABLE "salesInvoiceLine" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_taxCodeId_idx" ON "salesInvoiceLine" ("taxCodeId");

-- The line's snapshot of its code's "taxes shipping", which the
-- salesInvoices view and the posting read instead of the live code.
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "taxesShipping" BOOLEAN NOT NULL DEFAULT FALSE;

-- A plain BEFORE trigger, not an event-system interceptor: an interceptor
-- cannot change the row it runs on. SECURITY DEFINER so the snapshot does
-- not depend on whether the writer may read tax codes; a TRIGGER function
-- cannot be called over RPC, and the composite FK keeps the code in the
-- line's company. A line of a posted invoice keeps the value it was posted
-- with (a restore that cannot use replica mode re-inserts it).
CREATE OR REPLACE FUNCTION public.snapshot_sales_invoice_line_taxes_shipping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "salesInvoice" si
    WHERE si."id" = NEW."invoiceId" AND si."companyId" = NEW."companyId"
      AND si."status" NOT IN ('Draft', 'Pending')
  ) THEN
    RETURN NEW;
  END IF;
  NEW."taxesShipping" := COALESCE((
    SELECT tc."taxesShipping" FROM "taxCode" tc
    WHERE tc."id" = NEW."taxCodeId" AND tc."companyId" = NEW."companyId"
  ), FALSE);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "salesInvoiceLine_taxesShipping_snapshot" ON "salesInvoiceLine";
CREATE TRIGGER "salesInvoiceLine_taxesShipping_snapshot"
  BEFORE INSERT
  ON "salesInvoiceLine"
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_sales_invoice_line_taxes_shipping();
DROP TRIGGER IF EXISTS "salesInvoiceLine_taxesShipping_snapshot_update" ON "salesInvoiceLine";
CREATE TRIGGER "salesInvoiceLine_taxesShipping_snapshot_update"
  BEFORE UPDATE OF "taxCodeId"
  ON "salesInvoiceLine"
  FOR EACH ROW
  WHEN (OLD."taxCodeId" IS DISTINCT FROM NEW."taxCodeId")
  EXECUTE FUNCTION public.snapshot_sales_invoice_line_taxes_shipping();

-- A code's "taxes shipping" change reaches the lines of its draft invoices,
-- so a draft never posts the old value or mixes old and new lines. Posted
-- invoices keep their snapshot. Same style as the line snapshot above.
CREATE OR REPLACE FUNCTION public.sync_draft_sales_invoice_line_taxes_shipping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE "salesInvoiceLine" l
  SET "taxesShipping" = NEW."taxesShipping"
  FROM "salesInvoice" si
  WHERE l."taxCodeId" = NEW."id" AND l."companyId" = NEW."companyId"
    AND si."id" = l."invoiceId" AND si."companyId" = l."companyId"
    AND si."status" IN ('Draft', 'Pending')
    AND l."taxesShipping" IS DISTINCT FROM NEW."taxesShipping";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "taxCode_taxesShipping_sync_draft_lines" ON "taxCode";
CREATE TRIGGER "taxCode_taxesShipping_sync_draft_lines"
  AFTER UPDATE OF "taxesShipping"
  ON "taxCode"
  FOR EACH ROW
  WHEN (OLD."taxesShipping" IS DISTINCT FROM NEW."taxesShipping")
  EXECUTE FUNCTION public.sync_draft_sales_invoice_line_taxes_shipping();

ALTER TABLE "rentalAgreement" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "rentalAgreement" ADD CONSTRAINT "rentalAgreement_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "rentalAgreement_taxCodeId_idx" ON "rentalAgreement" ("taxCodeId");

ALTER TABLE "rentalAgreementCharge" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "rentalAgreementCharge" ADD CONSTRAINT "rentalAgreementCharge_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "rentalAgreementCharge_taxCodeId_idx" ON "rentalAgreementCharge" ("taxCodeId");

ALTER TABLE "customerContractLine" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "customerContractLine_taxCodeId_idx" ON "customerContractLine" ("taxCodeId");

ALTER TABLE "supplierQuoteLinePrice" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "supplierQuoteLinePrice" ADD CONSTRAINT "supplierQuoteLinePrice_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "supplierQuoteLinePrice_taxCodeId_idx" ON "supplierQuoteLinePrice" ("taxCodeId");

ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "purchaseOrderLine_taxCodeId_idx" ON "purchaseOrderLine" ("taxCodeId");
-- Restoring an approved version puts the code back with its rate. A real FK,
-- like the version's other id columns, so a restore into another company
-- remaps it.
ALTER TABLE "purchaseOrderLineVersion" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "purchaseOrderLineVersion" ADD CONSTRAINT "purchaseOrderLineVersion_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "purchaseOrderLineVersion_taxCodeId_idx" ON "purchaseOrderLineVersion" ("taxCodeId");

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "purchaseInvoiceLine" ADD CONSTRAINT "purchaseInvoiceLine_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_taxCodeId_idx" ON "purchaseInvoiceLine" ("taxCodeId");

ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;
DO $$ BEGIN
  ALTER TABLE "memo" ADD CONSTRAINT "memo_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "memo_taxCodeId_idx" ON "memo" ("taxCodeId");

-- Recreate the line views so their expanded column lists include taxCodeId

DROP VIEW IF EXISTS "salesInvoiceLines";
CREATE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    (SELECT cp."customerPartId"
     FROM "customerPartToItem" cp
     WHERE cp."customerId" = si."customerId" AND cp."itemId" = i.id
     LIMIT 1) as "customerPartId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

DROP VIEW IF EXISTS "purchaseInvoiceLines";
CREATE OR REPLACE VIEW "purchaseInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i."readableIdWithRevision" as "itemReadableId",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    sp."supplierPartId",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName",
    ls."leaseId" as "leaseReadableId",
    ls."name" as "leaseName"
  FROM "purchaseInvoiceLine" pl
  INNER JOIN "purchaseInvoice" pi ON pi.id = pl."invoiceId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = pi."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "lease" ls ON ls."id" = pl."leaseId" AND ls."companyId" = pl."companyId"
);

DROP VIEW IF EXISTS "salesOrderLines";
CREATE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
  LEFT JOIN "fixedAsset" fa ON fa.id = sl."assetId"
);

DROP VIEW IF EXISTS "quoteLines";
CREATE OR REPLACE VIEW "quoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost"
  FROM "quoteLine" ql
  LEFT JOIN "modelUpload" mu ON ql."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

-- Forked from 20261104063431_purchase-order-lines-filter-pushdown.sql, the newest
-- definition; recreated so pl.* picks up "taxCodeId".
DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    pl.*,
    sp."supplierPartId" as "supplierPartIdFromSupplier",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    jo."description" as "jobOperationDescription",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN LATERAL (
    SELECT c."unitCost" FROM "itemCost" c WHERE c."itemId" = i.id
    ORDER BY c."updatedAt" DESC NULLS LAST, c."createdAt" DESC
    LIMIT 1
  ) ic ON true
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp
    ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id AND sp."companyId" = so."companyId"
);

DROP VIEW IF EXISTS "supplierQuoteLines";
CREATE OR REPLACE VIEW "supplierQuoteLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    ql.*,
    i."readableIdWithRevision" as "itemReadableId",
    i."type" as "itemType",
    COALESCE(i."thumbnailPath", mu."thumbnailPath") as "thumbnailPath",
    ic."unitCost" as "unitCost",
    a."name" as "accountName"
  FROM "supplierQuoteLine" ql
  LEFT JOIN "item" i ON i.id = ql."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "account" a ON a.id = ql."accountId"
);

RESET lock_timeout;
