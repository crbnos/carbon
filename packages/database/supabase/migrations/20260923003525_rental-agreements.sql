-- Rental agreements (operating): rate ladder, agreement header + lines + charges +
-- billing periods, the Rental invoice line, deposits on payments, lease settings,
-- the RA sequence, and the fleet / agreement views.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §3, Data Model §5
-- Plan decisions 4 (rentalAgreement.taxPercent) and 5 (rentalAgreementCharge.kind).

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
  "rateMode" "rentalRateMode" NOT NULL DEFAULT 'Best Rate',
  "rateUnit" "rentalRateUnit",
  "dayRate" NUMERIC,
  "weekRate" NUMERIC,
  "monthRate" NUMERIC,
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
  CONSTRAINT "rentalAgreementLine_rate_check" CHECK ("rateMode" = 'Best Rate' OR "rateUnit" IS NOT NULL),
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
  "kind" "rentalInvoiceLineKind" NOT NULL DEFAULT 'Charge',
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

-- 6) RLS: the agreement is a sales document ----------------------------------------------
DO $rentrls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['itemRentalRate', 'rentalAgreement', 'rentalAgreementLine', 'rentalAgreementCharge', 'rentalBillingPeriod'] LOOP
    EXECUTE format('ALTER TABLE "public".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "SELECT" ON "public".%I', t);
    EXECUTE format('CREATE POLICY "SELECT" ON "public".%I FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''sales_view''))::text[]))', t);
    EXECUTE format('DROP POLICY IF EXISTS "INSERT" ON "public".%I', t);
    EXECUTE format('CREATE POLICY "INSERT" ON "public".%I FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''sales_create''))::text[]))', t);
    EXECUTE format('DROP POLICY IF EXISTS "UPDATE" ON "public".%I', t);
    EXECUTE format('CREATE POLICY "UPDATE" ON "public".%I FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''sales_update''))::text[]))', t);
    EXECUTE format('DROP POLICY IF EXISTS "DELETE" ON "public".%I', t);
    EXECUTE format('CREATE POLICY "DELETE" ON "public".%I FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(''sales_delete''))::text[]))', t);
  END LOOP;
END $rentrls$;

-- 7) The Rental invoice line ---------------------------------------------------------------
ALTER TABLE "salesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalAgreementLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalBillingPeriodId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalAgreementChargeId" TEXT,
  ADD COLUMN IF NOT EXISTS "rentalInvoiceLineKind" "rentalInvoiceLineKind";

DO $rentcheck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salesInvoiceLine_rental_check') THEN
    ALTER TABLE "salesInvoiceLine" ADD CONSTRAINT "salesInvoiceLine_rental_check" CHECK (
      ("invoiceLineType" <> 'Rental' AND "rentalAgreementLineId" IS NULL) OR
      ("invoiceLineType" = 'Rental' AND "rentalAgreementLineId" IS NOT NULL AND "rentalInvoiceLineKind" IS NOT NULL)
    );
  END IF;
END $rentcheck$;

CREATE INDEX IF NOT EXISTS "salesInvoiceLine_rentalAgreementLineId_idx" ON "salesInvoiceLine" ("rentalAgreementLineId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_rentalBillingPeriodId_idx" ON "salesInvoiceLine" ("rentalBillingPeriodId");
CREATE INDEX IF NOT EXISTS "salesInvoiceLine_rentalAgreementChargeId_idx" ON "salesInvoiceLine" ("rentalAgreementChargeId");

-- DROP + CREATE so sl.* picks up the new columns (CREATE OR REPLACE cannot reorder columns).
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

-- 8) Deposits: a receipt may reference the sales order or the agreement it secures ---------
ALTER TABLE "payment"
  ADD COLUMN IF NOT EXISTS "salesOrderId" TEXT REFERENCES "salesOrder"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT;

DO $paydep$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_rentalAgreementId_fkey') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_rentalAgreementId_fkey"
      FOREIGN KEY ("rentalAgreementId", "companyId") REFERENCES "rentalAgreement"("id", "companyId") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_deposit_document_check') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_deposit_document_check"
      CHECK (num_nonnulls("salesOrderId", "rentalAgreementId") <= 1);
  END IF;
END $paydep$;

CREATE INDEX IF NOT EXISTS "payment_salesOrderId_idx" ON "payment" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "payment_rentalAgreementId_idx" ON "payment" ("rentalAgreementId", "companyId");

-- 9) Lease classification settings (annual %, defaults from ASC 842 practice) --------------
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "leaseMajorPartThresholdPercent" NUMERIC NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS "leaseSubstantiallyAllThresholdPercent" NUMERIC NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "leaseDefaultDiscountRate" NUMERIC NOT NULL DEFAULT 6;

-- 10) Sequence per company ------------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'rentalAgreement', 'Rental Agreement', 'RA', NULL, 0, 6, 1, c.id
FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'rentalAgreement');

-- 11) Views ------------------------------------------------------------------------------------
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

-- rentalAgreements: header with the customer name and line / period rollups.
DROP VIEW IF EXISTS "rentalAgreements";
CREATE VIEW "rentalAgreements" WITH(SECURITY_INVOKER=true) AS
SELECT
  ra.*,
  c.name AS "customerName",
  COALESCE(l."lineCount", 0) AS "lineCount",
  COALESCE(l."onRentCount", 0) AS "onRentCount",
  p."nextDueOn",
  COALESCE(p."unbilledAmount", 0) AS "unbilledAmount"
FROM "rentalAgreement" ra
INNER JOIN "customer" c ON c.id = ra."customerId"
LEFT JOIN LATERAL (
  SELECT
    count(*)::INTEGER AS "lineCount",
    count(*) FILTER (WHERE ral.status = 'On Rent')::INTEGER AS "onRentCount"
  FROM "rentalAgreementLine" ral
  WHERE ral."rentalAgreementId" = ra.id AND ral."companyId" = ra."companyId"
) l ON TRUE
LEFT JOIN LATERAL (
  SELECT
    min(rbp."dueOn") AS "nextDueOn",
    sum(rbp.amount) AS "unbilledAmount"
  FROM "rentalBillingPeriod" rbp
  JOIN "rentalAgreementLine" ral ON ral.id = rbp."rentalAgreementLineId" AND ral."companyId" = rbp."companyId"
  WHERE ral."rentalAgreementId" = ra.id
    AND ral."companyId" = ra."companyId"
    AND rbp.status = 'Pending'
) p ON TRUE;

NOTIFY pgrst, 'reload schema';
