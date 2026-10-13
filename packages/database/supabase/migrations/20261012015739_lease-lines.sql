-- Several assets per lease (spec 2026-10-11-lessee-leases → Addendum). Each leased asset
-- is a separate lease component under ASC 842 (842-10-15-28): it has its own payment,
-- classification inputs, classification, measurement, payment rows and schedule. The
-- lease keeps the term, the payment frequency and timing, the escalation and the rate,
-- as the rental agreement keeps its term and billing on the header.

-- 1) Line status ---------------------------------------------------------------------------
DO $leaselineenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leaseLineStatus') THEN
    CREATE TYPE "leaseLineStatus" AS ENUM ('Active', 'Terminated', 'Purchased', 'Expired');
  END IF;
END $leaselineenums$;

-- 2) The leased assets -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "leaseLine" (
  "id" TEXT NOT NULL DEFAULT id('lsln'),
  "companyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "serialNumber" TEXT,
  "locationId" TEXT REFERENCES "location"("id"),
  "paymentAmount" NUMERIC NOT NULL DEFAULT 0,
  "fairValue" NUMERIC,
  "economicLifeMonths" INTEGER,
  "ownershipTransfers" BOOLEAN NOT NULL DEFAULT FALSE,
  "specializedAsset" BOOLEAN NOT NULL DEFAULT FALSE,
  "purchaseOptionAmount" NUMERIC,
  "purchaseOptionReasonablyCertain" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "leaseLineStatus" NOT NULL DEFAULT 'Active',
  "lesseeClassification" "lesseeClassification",
  "classificationInputs" JSONB,
  "classificationOverride" "lesseeClassification",
  "classificationOverrideReason" TEXT,
  "initialLiability" NUMERIC,
  "initialRouAsset" NUMERIC,
  "rouAssetCost" NUMERIC,
  "fixedAssetId" TEXT REFERENCES "fixedAsset"("id") ON DELETE SET NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "leaseLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "leaseLine_lease_fkey" FOREIGN KEY ("leaseId", "companyId")
    REFERENCES "lease"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "leaseLine_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leaseLine_paymentAmount_check" CHECK ("paymentAmount" >= 0),
  CONSTRAINT "leaseLine_override_reason_check"
    CHECK ("classificationOverride" IS NULL OR "classificationOverrideReason" IS NOT NULL),
  CONSTRAINT "leaseLine_purchase_option_check"
    CHECK (NOT "purchaseOptionReasonablyCertain" OR COALESCE("purchaseOptionAmount", 0) > 0)
);
CREATE INDEX IF NOT EXISTS "leaseLine_companyId_idx" ON "leaseLine" ("companyId");
CREATE INDEX IF NOT EXISTS "leaseLine_lease_idx" ON "leaseLine" ("leaseId", "companyId");
CREATE INDEX IF NOT EXISTS "leaseLine_locationId_idx" ON "leaseLine" ("locationId");
CREATE INDEX IF NOT EXISTS "leaseLine_fixedAssetId_idx" ON "leaseLine" ("fixedAssetId");
CREATE INDEX IF NOT EXISTS "leaseLine_createdBy_idx" ON "leaseLine" ("createdBy");

-- 3) Every existing lease becomes a lease with one asset ----------------------------------
INSERT INTO "leaseLine" (
  "companyId", "leaseId", "description", "locationId", "paymentAmount", "fairValue",
  "economicLifeMonths", "ownershipTransfers", "specializedAsset", "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain", "status", "lesseeClassification", "classificationInputs",
  "classificationOverride", "classificationOverrideReason", "initialLiability",
  "initialRouAsset", "rouAssetCost", "fixedAssetId", "createdBy", "createdAt"
)
SELECT
  l."companyId", l."id", l."name", l."locationId", l."paymentAmount", l."fairValue",
  l."economicLifeMonths", l."ownershipTransfers", l."specializedAsset", l."purchaseOptionAmount",
  l."purchaseOptionReasonablyCertain",
  CASE l."status"
    WHEN 'Terminated' THEN 'Terminated'::"leaseLineStatus"
    WHEN 'Purchased' THEN 'Purchased'::"leaseLineStatus"
    WHEN 'Expired' THEN 'Expired'::"leaseLineStatus"
    ELSE 'Active'::"leaseLineStatus"
  END,
  l."lesseeClassification", l."classificationInputs", l."classificationOverride",
  l."classificationOverrideReason", l."initialLiability", l."initialRouAsset",
  l."rouAssetCost",
  (SELECT fa."id" FROM "fixedAsset" fa WHERE fa."id" = l."fixedAssetId" AND fa."companyId" = l."companyId"),
  l."createdBy", l."createdAt"
FROM "lease" l
WHERE NOT EXISTS (
  SELECT 1 FROM "leaseLine" ll WHERE ll."leaseId" = l."id" AND ll."companyId" = l."companyId"
);

-- 4) Payment rows, schedule lines and events belong to an asset ---------------------------
ALTER TABLE "leasePayment" ADD COLUMN IF NOT EXISTS "leaseLineId" TEXT;
ALTER TABLE "leaseScheduleLine" ADD COLUMN IF NOT EXISTS "leaseLineId" TEXT;
ALTER TABLE "leaseEvent" ADD COLUMN IF NOT EXISTS "leaseLineId" TEXT;

UPDATE "leasePayment" p SET "leaseLineId" = ll."id"
FROM "leaseLine" ll
WHERE p."leaseLineId" IS NULL AND ll."leaseId" = p."leaseId" AND ll."companyId" = p."companyId";
UPDATE "leaseScheduleLine" sl SET "leaseLineId" = ll."id"
FROM "leaseLine" ll
WHERE sl."leaseLineId" IS NULL AND ll."leaseId" = sl."leaseId" AND ll."companyId" = sl."companyId";
-- Every event names the asset it changed (a Modification writes one per asset).
UPDATE "leaseEvent" e SET "leaseLineId" = ll."id"
FROM "leaseLine" ll
WHERE e."leaseLineId" IS NULL
  AND ll."leaseId" = e."leaseId" AND ll."companyId" = e."companyId";

ALTER TABLE "leasePayment" ALTER COLUMN "leaseLineId" SET NOT NULL;
ALTER TABLE "leaseScheduleLine" ALTER COLUMN "leaseLineId" SET NOT NULL;
ALTER TABLE "leaseEvent" ALTER COLUMN "leaseLineId" SET NOT NULL;

DO $leaselinefks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leasePayment_leaseLine_fkey') THEN
    ALTER TABLE "leasePayment" ADD CONSTRAINT "leasePayment_leaseLine_fkey"
      FOREIGN KEY ("leaseLineId", "companyId") REFERENCES "leaseLine"("id", "companyId") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leaseScheduleLine_leaseLine_fkey') THEN
    ALTER TABLE "leaseScheduleLine" ADD CONSTRAINT "leaseScheduleLine_leaseLine_fkey"
      FOREIGN KEY ("leaseLineId", "companyId") REFERENCES "leaseLine"("id", "companyId") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leaseEvent_leaseLine_fkey') THEN
    ALTER TABLE "leaseEvent" ADD CONSTRAINT "leaseEvent_leaseLine_fkey"
      FOREIGN KEY ("leaseLineId", "companyId") REFERENCES "leaseLine"("id", "companyId") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lease_discountRate_check') THEN
    ALTER TABLE "lease" ADD CONSTRAINT "lease_discountRate_check" CHECK ("discountRate" >= 0);
  END IF;
END $leaselinefks$;

CREATE INDEX IF NOT EXISTS "leasePayment_leaseLine_idx" ON "leasePayment" ("leaseLineId", "companyId");
CREATE INDEX IF NOT EXISTS "leaseScheduleLine_leaseLine_idx" ON "leaseScheduleLine" ("leaseLineId", "companyId");
CREATE INDEX IF NOT EXISTS "leaseEvent_leaseLine_idx" ON "leaseEvent" ("leaseLineId", "companyId");

DROP INDEX IF EXISTS "leasePayment_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "leasePayment_unique"
  ON "leasePayment" ("companyId", "leaseLineId", "dueDate", "paymentType");
ALTER TABLE "leaseScheduleLine" DROP CONSTRAINT IF EXISTS "leaseScheduleLine_unique";
ALTER TABLE "leaseScheduleLine" ADD CONSTRAINT "leaseScheduleLine_unique"
  UNIQUE ("companyId", "leaseLineId", "periodDate");

-- 5) The asset columns leave the header ------------------------------------------------------
DROP VIEW IF EXISTS "leases";

ALTER TABLE "lease"
  DROP CONSTRAINT IF EXISTS "lease_paymentAmount_check",
  DROP CONSTRAINT IF EXISTS "lease_override_reason_check",
  DROP COLUMN IF EXISTS "paymentAmount",
  DROP COLUMN IF EXISTS "fairValue",
  DROP COLUMN IF EXISTS "economicLifeMonths",
  DROP COLUMN IF EXISTS "ownershipTransfers",
  DROP COLUMN IF EXISTS "specializedAsset",
  DROP COLUMN IF EXISTS "purchaseOptionAmount",
  DROP COLUMN IF EXISTS "purchaseOptionReasonablyCertain",
  DROP COLUMN IF EXISTS "lesseeClassification",
  DROP COLUMN IF EXISTS "classificationInputs",
  DROP COLUMN IF EXISTS "classificationOverride",
  DROP COLUMN IF EXISTS "classificationOverrideReason",
  DROP COLUMN IF EXISTS "initialLiability",
  DROP COLUMN IF EXISTS "initialRouAsset",
  DROP COLUMN IF EXISTS "rouAssetCost",
  DROP COLUMN IF EXISTS "fixedAssetId";

-- 6) The lease list ------------------------------------------------------------------------
-- `currentLiability` sums, over the lease's Active assets, the closing liability of the
-- last schedule line a lease run (or an opening balance) has put on the books, else the
-- asset's initial liability. A Draft or Cancelled lease and an ended asset owe nothing.
-- It reads `leaseScheduleLine.postedAt`, not the run rows, which need accounting_view.
CREATE OR REPLACE VIEW "leases" WITH(SECURITY_INVOKER=true) AS
SELECT
  l.*,
  s."name" AS "supplierName",
  (SELECT COUNT(*)::INTEGER FROM "leaseLine" ll
    WHERE ll."leaseId" = l."id" AND ll."companyId" = l."companyId") AS "assetCount",
  (SELECT COALESCE(SUM(ll."paymentAmount"), 0) FROM "leaseLine" ll
    WHERE ll."leaseId" = l."id" AND ll."companyId" = l."companyId") AS "paymentAmount",
  (SELECT CASE
      WHEN COUNT(DISTINCT ll."lesseeClassification") = 1 THEN MIN(ll."lesseeClassification"::TEXT)
      WHEN COUNT(DISTINCT ll."lesseeClassification") > 1 THEN 'Mixed'
    END
    FROM "leaseLine" ll
    WHERE ll."leaseId" = l."id" AND ll."companyId" = l."companyId") AS "classification",
  (
    SELECT p."dueDate" FROM "leasePayment" p
    WHERE p."leaseId" = l."id" AND p."companyId" = l."companyId" AND p."status" = 'Pending'
    ORDER BY p."dueDate"
    LIMIT 1
  ) AS "nextDueDate",
  CASE WHEN l."status" IN ('Draft', 'Cancelled') THEN 0 ELSE (
    SELECT COALESCE(SUM(COALESCE(
      (
        SELECT sl."closingLiability" FROM "leaseScheduleLine" sl
        WHERE sl."leaseLineId" = ll."id" AND sl."companyId" = ll."companyId"
          AND sl."postedAt" IS NOT NULL
        ORDER BY sl."periodDate" DESC
        LIMIT 1
      ),
      ll."initialLiability",
      0
    )), 0)
    FROM "leaseLine" ll
    WHERE ll."leaseId" = l."id" AND ll."companyId" = l."companyId" AND ll."status" = 'Active'
  ) END AS "currentLiability"
FROM "lease" l
JOIN "supplier" s ON s."id" = l."supplierId";

NOTIFY pgrst, 'reload schema';
