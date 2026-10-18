-- Multi-jurisdiction tax, Phase 1 (.ai/specs/2026-10-16-multi-jurisdiction-tax.md).
-- Tax codes with components, authorities, registrations, the tax subledger,
-- the Odoo-style tax account names, and taxCodeId on every in-scope document.
-- RLS rules live in packages/database/src/authz/manifest.ts.

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
  CONSTRAINT "taxCodeComponent_taxAuthorityId_fkey" FOREIGN KEY ("taxAuthorityId", "companyId")
    REFERENCES "taxAuthority"("id", "companyId") ON DELETE SET NULL ("taxAuthorityId"),
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
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  CONSTRAINT "taxLedger_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "taxLedger_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_postingDate_idx" ON "taxLedger" ("companyId", "postingDate");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_documentId_idx" ON "taxLedger" ("companyId", "documentId");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_journalId_idx" ON "taxLedger" ("companyId", "journalId");
CREATE INDEX IF NOT EXISTS "taxLedger_companyId_taxAuthorityId_idx" ON "taxLedger" ("companyId", "taxAuthorityId");
CREATE INDEX IF NOT EXISTS "taxLedger_createdBy_idx" ON "taxLedger" ("createdBy");

-- Account-default renames (grill 2). No live SQL function reads the old names.
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME COLUMN "salesTaxPayableAccount" TO "taxReceivedAccount";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "accountDefault" RENAME COLUMN "purchaseTaxPayableAccount" TO "taxPaidAccount";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

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

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
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
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
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

