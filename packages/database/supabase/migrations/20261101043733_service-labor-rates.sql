-- Service labor as plain rates, time posted as it happens, and ASC 606 revenue.
-- Spec: .ai/specs/2026-10-31-service-labor-rates-and-time-posting.md
-- No data is migrated: the labor item columns are dropped with their values.

-- 1) Company rates: the cost rate posts time, the bill rate defaults each job.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "serviceLaborCostRate" NUMERIC,
  ADD COLUMN IF NOT EXISTS "serviceLaborBillRate" NUMERIC;
DROP INDEX IF EXISTS "companySettings_serviceLaborItemId_idx";
ALTER TABLE "companySettings" DROP COLUMN IF EXISTS "serviceLaborItemId";

-- 2) The job's bill rate. Time no longer posts at completion.
ALTER TABLE "serviceJob" ADD COLUMN IF NOT EXISTS "laborBillRate" NUMERIC;
ALTER TABLE "serviceJob" DROP COLUMN IF EXISTS "completionJournalId";

-- 3) A time entry names no labor item; "unitCost" is the rate it posted at.
ALTER TABLE "serviceJobTime" DROP COLUMN IF EXISTS "laborItemId";

-- 4) An estimate line with no item is a Labor line.
ALTER TABLE "serviceJobEstimateLine" ALTER COLUMN "itemId" DROP NOT NULL;

-- 5) Account default: Service Revenue. Nullable; posting falls back to Sales.
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "serviceRevenueAccount" TEXT;
DO $srfk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"accountDefault"'::regclass AND conname = 'accountDefault_serviceRevenueAccount_fkey'
  ) THEN
    ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_serviceRevenueAccount_fkey"
      FOREIGN KEY ("serviceRevenueAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $srfk$;
CREATE INDEX IF NOT EXISTS "accountDefault_serviceRevenueAccount_idx" ON "accountDefault" ("serviceRevenueAccount");

-- 6) Service job provenance on recognition schedule rows (the revenue accrual).
ALTER TABLE "revenueRecognitionSchedule" ADD COLUMN IF NOT EXISTS "serviceJobId" TEXT;
DO $$ BEGIN
  ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_serviceJob_fkey"
    FOREIGN KEY ("serviceJobId", "companyId") REFERENCES "serviceJob"("id", "companyId")
    ON DELETE SET NULL ("serviceJobId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_serviceJobId_idx"
  ON "revenueRecognitionSchedule" ("companyId", "serviceJobId");
