-- Rental agreements: rate ladders (item, customer, customer type), agreement header +
-- lines + charges + billing periods, the sales-type lease schedule, the Rental invoice
-- line, deposits on payments, lease settings, the RA sequence, and the fleetAssets view.
-- The rentalAgreements view is created by 20261003035637_rental-invoice-automation.sql,
-- which adds the columns it reads. RLS is rendered from the authz manifest.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §3–§4, Data Model §5

-- 1) Rate ladder per item and currency ---------------------------------------------
CREATE TABLE IF NOT EXISTS "itemRentalRate" (
  "id" TEXT NOT NULL DEFAULT id('irr'),
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "currencyCode" TEXT NOT NULL,
  "dayRate" NUMERIC,
  "weekRate" NUMERIC,
  "monthRate" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "itemRentalRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "itemRentalRate_item_currency_key" UNIQUE ("companyId", "itemId", "currencyCode"),
  CONSTRAINT "itemRentalRate_tier_check" CHECK (num_nonnulls("dayRate", "weekRate", "monthRate") >= 1),
  CONSTRAINT "itemRentalRate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "itemRentalRate_companyId_idx" ON "itemRentalRate" ("companyId");
CREATE INDEX IF NOT EXISTS "itemRentalRate_itemId_idx" ON "itemRentalRate" ("itemId");
CREATE INDEX IF NOT EXISTS "itemRentalRate_createdBy_idx" ON "itemRentalRate" ("createdBy");

-- 2) Agreement header ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "rentalAgreement" (
  "id" TEXT NOT NULL DEFAULT id('rag'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementId" TEXT NOT NULL,
  "status" "rentalAgreementStatus" NOT NULL DEFAULT 'Draft',
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "customerLocationId" TEXT REFERENCES "customerLocation"("id"),
  "customerContactId" TEXT REFERENCES "customerContact"("id"),
  "salesPersonId" TEXT REFERENCES "user"("id"),
  "locationId" TEXT NOT NULL REFERENCES "location"("id"),
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "billingCycle" "rentalBillingCycle" NOT NULL DEFAULT 'Calendar Month',
  "billingTiming" "rentalBillingTiming" NOT NULL DEFAULT 'Advance',
  "paymentTermId" TEXT REFERENCES "paymentTerm"("id"),
  "currencyCode" TEXT NOT NULL,
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0,
  "depositAmount" NUMERIC NOT NULL DEFAULT 0,
  "discountRate" NUMERIC NOT NULL,
  "ownershipTransfers" BOOLEAN NOT NULL DEFAULT false,
  "specializedAsset" BOOLEAN NOT NULL DEFAULT false,
  "purchaseOptionAmount" NUMERIC,
  "purchaseOptionReasonablyCertain" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "activatedAt" TIMESTAMP WITH TIME ZONE,
  "closedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "rentalAgreement_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreement_rentalAgreementId_companyId_key" UNIQUE ("rentalAgreementId", "companyId"),
  CONSTRAINT "rentalAgreement_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rentalAgreement_dates_check" CHECK ("endDate" IS NULL OR "endDate" > "startDate")
);
CREATE INDEX IF NOT EXISTS "rentalAgreement_companyId_idx" ON "rentalAgreement" ("companyId");
CREATE INDEX IF NOT EXISTS "rentalAgreement_companyId_status_idx" ON "rentalAgreement" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "rentalAgreement_customerId_idx" ON "rentalAgreement" ("customerId");
CREATE INDEX IF NOT EXISTS "rentalAgreement_customerLocationId_idx" ON "rentalAgreement" ("customerLocationId");
CREATE INDEX IF NOT EXISTS "rentalAgreement_customerContactId_idx" ON "rentalAgreement" ("customerContactId");
CREATE INDEX IF NOT EXISTS "rentalAgreement_salesPersonId_idx" ON "rentalAgreement" ("salesPersonId");
CREATE INDEX IF NOT EXISTS "rentalAgreement_locationId_idx" ON "rentalAgreement" ("locationId");
CREATE INDEX IF NOT EXISTS "rentalAgreement_paymentTermId_idx" ON "rentalAgreement" ("paymentTermId");
CREATE INDEX IF NOT EXISTS "rentalAgreement_createdBy_idx" ON "rentalAgreement" ("createdBy");

-- 3) Lines: one serialized fleet unit each ----------------------------------------------
CREATE TABLE IF NOT EXISTS "rentalAgreementLine" (
  "id" TEXT NOT NULL DEFAULT id('ragl'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementId" TEXT NOT NULL,
  "status" "rentalAgreementLineStatus" NOT NULL DEFAULT 'Pending',
  "fixedAssetId" TEXT REFERENCES "fixedAsset"("id"),
  "itemId" TEXT NOT NULL REFERENCES "item"("id"),
  "trackedEntityId" TEXT REFERENCES "trackedEntity"("id"),
  "quantity" NUMERIC NOT NULL DEFAULT 1 CHECK ("quantity" = 1),
  -- A unit bills ONE rate: a frequency and its value. The value starts from the
  -- customer's, customer type's or item's rate card for that frequency and is the
  -- unit's own from then on, so it is what billing and lease classification read.
  "rateUnit" "rentalRateUnit" NOT NULL DEFAULT 'Month',
  "rate" NUMERIC NOT NULL,
  "fairValue" NUMERIC,
  "economicLifeMonths" INTEGER,
  "guaranteedResidualValue" NUMERIC NOT NULL DEFAULT 0,
  "unguaranteedResidualValue" NUMERIC NOT NULL DEFAULT 0,
  "lessorClassification" "lessorClassification",
  "classificationOverride" BOOLEAN NOT NULL DEFAULT false,
  "classificationOverrideReason" TEXT,
  "classificationInputs" JSONB,
  "initialNetInvestment" NUMERIC,
  "sellingProfit" NUMERIC,
  "deliveredAt" DATE,
  "returnedAt" DATE,
  "meterOut" NUMERIC,
  "meterIn" NUMERIC,
  "returnNotes" TEXT,
  "commencementJournalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalAgreementLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreementLine_rate_nonnegative" CHECK ("rate" >= 0),
  CONSTRAINT "rentalAgreementLine_agreement_fkey" FOREIGN KEY ("rentalAgreementId", "companyId")
    REFERENCES "rentalAgreement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalAgreementLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "rentalAgreementLine_companyId_idx" ON "rentalAgreementLine" ("companyId");
CREATE INDEX IF NOT EXISTS "rentalAgreementLine_agreement_idx" ON "rentalAgreementLine" ("rentalAgreementId", "companyId");
CREATE INDEX IF NOT EXISTS "rentalAgreementLine_fixedAssetId_idx" ON "rentalAgreementLine" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "rentalAgreementLine_itemId_idx" ON "rentalAgreementLine" ("itemId");
CREATE INDEX IF NOT EXISTS "rentalAgreementLine_trackedEntityId_idx" ON "rentalAgreementLine" ("trackedEntityId");
CREATE INDEX IF NOT EXISTS "rentalAgreementLine_commencementJournalId_idx" ON "rentalAgreementLine" ("commencementJournalId");
CREATE INDEX IF NOT EXISTS "rentalAgreementLine_createdBy_idx" ON "rentalAgreementLine" ("createdBy");
-- A unit is on at most one live line.
CREATE UNIQUE INDEX IF NOT EXISTS "rentalAgreementLine_asset_live_idx"
  ON "rentalAgreementLine" ("companyId", "fixedAssetId")
  WHERE "fixedAssetId" IS NOT NULL AND "status" IN ('Pending', 'On Rent');

-- 4) Charges (variable payments, billed as entered) --------------------------------------
CREATE TABLE IF NOT EXISTS "rentalAgreementCharge" (
  "id" TEXT NOT NULL DEFAULT id('ragc'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementLineId" TEXT NOT NULL,
  "chargeType" "rentalInvoiceLineType" NOT NULL DEFAULT 'Charge',
  "chargeDate" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "taxPercent" NUMERIC NOT NULL DEFAULT 0,
  "salesInvoiceLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalAgreementCharge_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreementCharge_line_fkey" FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalAgreementCharge_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "rentalAgreementCharge_companyId_idx" ON "rentalAgreementCharge" ("companyId");
CREATE INDEX IF NOT EXISTS "rentalAgreementCharge_line_idx" ON "rentalAgreementCharge" ("rentalAgreementLineId", "companyId");
CREATE INDEX IF NOT EXISTS "rentalAgreementCharge_salesInvoiceLineId_idx" ON "rentalAgreementCharge" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "rentalAgreementCharge_createdBy_idx" ON "rentalAgreementCharge" ("createdBy");

-- 5) Billing periods (persisted so invoice generation is idempotent) ---------------------
CREATE TABLE IF NOT EXISTS "rentalBillingPeriod" (
  "id" TEXT NOT NULL DEFAULT id('rbp'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementLineId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "days" INTEGER NOT NULL,
  "rateUnitApplied" "rentalRateUnit",
  "amount" NUMERIC NOT NULL,
  "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
  "dueOn" DATE NOT NULL,
  "status" "rentalBillingPeriodStatus" NOT NULL DEFAULT 'Pending',
  "salesInvoiceLineId" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalBillingPeriod_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalBillingPeriod_line_fkey" FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalBillingPeriod_unique" UNIQUE ("companyId", "rentalAgreementLineId", "periodStart", "isAdjustment"),
  CONSTRAINT "rentalBillingPeriod_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "rentalBillingPeriod_companyId_idx" ON "rentalBillingPeriod" ("companyId");
CREATE INDEX IF NOT EXISTS "rentalBillingPeriod_line_idx" ON "rentalBillingPeriod" ("rentalAgreementLineId", "companyId");
CREATE INDEX IF NOT EXISTS "rentalBillingPeriod_due_idx" ON "rentalBillingPeriod" ("companyId", "status", "dueOn");
CREATE INDEX IF NOT EXISTS "rentalBillingPeriod_salesInvoiceLineId_idx" ON "rentalBillingPeriod" ("salesInvoiceLineId");
CREATE INDEX IF NOT EXISTS "rentalBillingPeriod_createdBy_idx" ON "rentalBillingPeriod" ("createdBy");

-- 6) The Rental invoice line ---------------------------------------------------------------
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalAgreementLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalBillingPeriodId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalAgreementChargeId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalLineType" "rentalInvoiceLineType";

DO $rentcheck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salesInvoiceLine_rental_check') THEN
    ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_rental_check" CHECK (
      ("invoiceLineType" <> 'Rental' AND "rentalAgreementLineId" IS NULL) OR
      ("invoiceLineType" = 'Rental' AND "rentalAgreementLineId" IS NOT NULL AND "rentalLineType" IS NOT NULL)
    );
  END IF;
END $rentcheck$;

CREATE INDEX IF NOT EXISTS "salesInvoiceLine_rentalAgreementLineId_idx" ON "salesInvoiceLine" ("rentalAgreementLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_rentalBillingPeriodId_idx" ON "salesInvoiceLine" ("rentalBillingPeriodId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_rentalAgreementChargeId_idx" ON "salesInvoiceLine" ("rentalAgreementChargeId");

-- salesInvoiceLines is recreated with every new line column by
-- 20261004014728_sales-invoice-discount-and-ship-to.sql.

-- 7) Deposits: a receipt may reference the sales order or the agreement it secures ---------
ALTER TABLE "payment"
  ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT;

DO $paydep$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_rentalAgreementId_fkey') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_rentalAgreementId_fkey"
      FOREIGN KEY ("rentalAgreementId", "companyId") REFERENCES "rentalAgreement"("id", "companyId") ON DELETE SET NULL ("rentalAgreementId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_deposit_document_check') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_deposit_document_check"
      CHECK (num_nonnulls("salesOrderId", "rentalAgreementId") <= 1);
  END IF;
END $paydep$;

CREATE INDEX IF NOT EXISTS "payment_salesOrderId_idx" ON "payment" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "payment_rentalAgreementId_idx" ON "payment" ("rentalAgreementId", "companyId");

-- 8) Lease classification settings (annual %, defaults from ASC 842 practice) --------------
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "leaseMajorPartThresholdPercent" NUMERIC NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS "leaseSubstantiallyAllThresholdPercent" NUMERIC NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "leaseDefaultDiscountRate" NUMERIC NOT NULL DEFAULT 6;

-- 9) Sequence per company ------------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'rentalAgreement', 'Rental Agreement', 'RA', NULL, 0, 6, 1, c.id
FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'rentalAgreement');

-- 10) Views ------------------------------------------------------------------------------------
-- fleetAssets: the live agreement line (Pending / On Rent) drives Reserved / On Rent.
DROP VIEW IF EXISTS "fleetAssets";
CREATE VIEW "fleetAssets" WITH(SECURITY_INVOKER=true) AS
SELECT
  fa.*,
  i."readableIdWithRevision" AS "itemReadableId",
  i.name AS "itemName",
  i."thumbnailPath",
  te."readableId" AS "trackedEntityReadableId",
  fac.name AS "className",
  fac."isConstructionInProgress",
  wc.name AS "workCenterName",
  (COALESCE(fa."acquisitionCost", 0) - COALESCE(fa."accumulatedDepreciation", 0)) AS "netBookValue",
  live."rentalAgreementId",
  live."customerId",
  live."customerLocationId",
  CASE
    WHEN fa.status = 'Disposed' AND fa."disposalMethod" = 'Transfer to Inventory' THEN 'Returned to Stock'
    WHEN fa.status = 'Disposed' THEN 'Sold'
    WHEN fa.status = 'Under Construction' THEN 'Under Construction'
    WHEN live.status = 'On Rent' THEN 'On Rent'
    WHEN fa."outOfServiceSince" IS NOT NULL THEN 'In Maintenance'
    WHEN live.status = 'Pending' THEN 'Reserved'
    ELSE 'Available'
  END AS "fleetStatus"
FROM "fixedAsset" fa
INNER JOIN "item" i ON i.id = fa."itemId"
INNER JOIN "fixedAssetClass" fac ON fac.id = fa."fixedAssetClassId"
LEFT JOIN "trackedEntity" te ON te.id = fa."trackedEntityId"
LEFT JOIN "workCenter" wc ON wc.id = fa."workCenterId"
LEFT JOIN LATERAL (
  SELECT ral.status, ral."rentalAgreementId", ra."customerId", ra."customerLocationId"
  FROM "rentalAgreementLine" ral
  JOIN "rentalAgreement" ra ON ra.id = ral."rentalAgreementId" AND ra."companyId" = ral."companyId"
  WHERE ral."fixedAssetId" = fa.id
    AND ral."companyId" = fa."companyId"
    AND ral.status IN ('Pending', 'On Rent')
  ORDER BY ral."createdAt" DESC
  LIMIT 1
) live ON TRUE
WHERE fa."itemId" IS NOT NULL;

-- 11) Customer rental rates: a day / week / month ladder agreed with one customer or
--     with every customer of a type, for one item in one currency. A line defaults to
--     the customer's ladder, then the customer type's, then the item's own
--     (itemRentalRate). One row per scope, item and currency; validFrom / validTo gate
--     it on the agreement's start date.
CREATE TABLE IF NOT EXISTS "customerItemRentalRate" (
  "id" TEXT NOT NULL DEFAULT id('cirr'),
  "companyId" TEXT NOT NULL,
  "customerId" TEXT REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "customerTypeId" TEXT REFERENCES "customerType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "currencyCode" TEXT NOT NULL,
  "dayRate" NUMERIC,
  "weekRate" NUMERIC,
  "monthRate" NUMERIC,
  "validFrom" DATE,
  "validTo" DATE,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerItemRentalRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerItemRentalRate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemRentalRate_scope_check"
    CHECK (num_nonnulls("customerId", "customerTypeId") = 1),
  CONSTRAINT "customerItemRentalRate_tier_check"
    CHECK (num_nonnulls("dayRate", "weekRate", "monthRate") >= 1),
  CONSTRAINT "customerItemRentalRate_validity_check"
    CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customerItemRentalRate_customer_key"
  ON "customerItemRentalRate" ("companyId", "customerId", "itemId", "currencyCode")
  WHERE "customerId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "customerItemRentalRate_customerType_key"
  ON "customerItemRentalRate" ("companyId", "customerTypeId", "itemId", "currencyCode")
  WHERE "customerTypeId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_companyId_idx"
  ON "customerItemRentalRate" ("companyId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_itemId_idx"
  ON "customerItemRentalRate" ("itemId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_customerId_idx"
  ON "customerItemRentalRate" ("customerId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_customerTypeId_idx"
  ON "customerItemRentalRate" ("customerTypeId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_createdBy_idx"
  ON "customerItemRentalRate" ("createdBy");

-- 12) Sales-type lease schedule (§4): one effective-interest row per period of a Sale
--     rental line; each spawns one Interest revenue recognition row.
CREATE TABLE IF NOT EXISTS "rentalLeaseScheduleLine" (
  "id" TEXT NOT NULL DEFAULT id('rlsl'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementLineId" TEXT NOT NULL,
  "periodDate" DATE NOT NULL,
  "openingNetInvestment" NUMERIC NOT NULL,
  "paymentAmount" NUMERIC NOT NULL,
  "interestAmount" NUMERIC NOT NULL,
  "principalAmount" NUMERIC NOT NULL,
  "closingNetInvestment" NUMERIC NOT NULL,
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalLeaseScheduleLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalLeaseScheduleLine_line_fkey" FOREIGN KEY ("rentalAgreementLineId", "companyId")
    REFERENCES "rentalAgreementLine"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalLeaseScheduleLine_unique" UNIQUE ("companyId", "rentalAgreementLineId", "periodDate"),
  CONSTRAINT "rentalLeaseScheduleLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "rentalLeaseScheduleLine_companyId_idx" ON "rentalLeaseScheduleLine" ("companyId");
CREATE INDEX IF NOT EXISTS "rentalLeaseScheduleLine_line_idx" ON "rentalLeaseScheduleLine" ("rentalAgreementLineId", "companyId");
CREATE INDEX IF NOT EXISTS "rentalLeaseScheduleLine_journalId_idx" ON "rentalLeaseScheduleLine" ("journalId");
CREATE INDEX IF NOT EXISTS "rentalLeaseScheduleLine_createdBy_idx" ON "rentalLeaseScheduleLine" ("createdBy");

-- An Interest schedule row points at the lease schedule line it recognizes.
DO $leaseschedfk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revenueRecognitionSchedule_rentalLeaseScheduleLineId_fkey') THEN
    ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_rentalLeaseScheduleLineId_fkey"
      FOREIGN KEY ("rentalLeaseScheduleLineId", "companyId")
      REFERENCES "rentalLeaseScheduleLine"("id", "companyId") ON DELETE SET NULL ("rentalLeaseScheduleLineId");
  END IF;
END $leaseschedfk$;
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_leaseLine_idx"
  ON "revenueRecognitionSchedule" ("rentalLeaseScheduleLineId", "companyId");

NOTIFY pgrst, 'reload schema';
