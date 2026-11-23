-- Prototype CLINs (.ai/specs/2026-10-21-project-contracts.md, section 10).
-- A project contract line can name a part. Build makes the job for it, and a
-- delivery records the part's custody with no stock movement.

-- The CLIN a job builds (Build on the CLIN, or Create Job on a plan line).
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "customerContractLineId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_customerContractLine_fkey'
  ) THEN
    ALTER TABLE "job" ADD CONSTRAINT "job_customerContractLine_fkey"
      FOREIGN KEY ("customerContractLineId", "companyId")
      REFERENCES "customerContractLine"("id", "companyId")
      ON DELETE SET NULL ("customerContractLineId");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "job_customerContractLineId_idx"
  ON "job" ("customerContractLineId", "companyId");
COMMENT ON COLUMN "job"."customerContractLineId" IS
  'The project contract line (CLIN) whose part this job builds.';

-- A contract delivery line: the serial typed for the part, and the Fixed Price
-- billing row the delivery wrote or moved (D34), so a void can put it back.
ALTER TABLE "shipmentLine" ADD COLUMN IF NOT EXISTS "serialNumber" TEXT;
ALTER TABLE "shipmentLine" ADD COLUMN IF NOT EXISTS "customerContractInvoiceLineId" TEXT;
ALTER TABLE "shipmentLine" ADD COLUMN IF NOT EXISTS "previousInvoiceDate" DATE;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shipmentLine_customerContractInvoiceLine_fkey'
  ) THEN
    ALTER TABLE "shipmentLine" ADD CONSTRAINT "shipmentLine_customerContractInvoiceLine_fkey"
      FOREIGN KEY ("customerContractInvoiceLineId", "companyId")
      REFERENCES "customerContractInvoiceLine"("id", "companyId")
      ON DELETE SET NULL ("customerContractInvoiceLineId");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "shipmentLine_customerContractInvoiceLineId_idx"
  ON "shipmentLine" ("customerContractInvoiceLineId", "companyId");
COMMENT ON COLUMN "shipmentLine"."serialNumber" IS
  'The serial number typed on a contract delivery line; the part moves no stock, so no tracked entity holds it.';
COMMENT ON COLUMN "shipmentLine"."customerContractInvoiceLineId" IS
  'The Fixed Price billing row a contract delivery wrote or moved to its delivery date.';
COMMENT ON COLUMN "shipmentLine"."previousInvoiceDate" IS
  'The date a contract delivery moved a whole billing row from; NULL when the delivery split the row.';

-- Shop time under DCAA timekeeping becomes a Draft timesheet entry with its job
-- (D38), as a service visit's time carries serviceVisitId.
ALTER TABLE "timesheetEntry" ADD COLUMN IF NOT EXISTS "jobId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'timesheetEntry_job_fkey'
  ) THEN
    ALTER TABLE "timesheetEntry" ADD CONSTRAINT "timesheetEntry_job_fkey"
      FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "timesheetEntry_jobId_idx"
  ON "timesheetEntry" ("jobId", "companyId");
COMMENT ON COLUMN "timesheetEntry"."jobId" IS
  'The job whose shop time wrote this entry (DCAA timekeeping); NULL for time logged by hand.';

-- A part line carries its units to deliver: a T&M or Cost Plus line keeps
-- rate 0 (billable items price it), but its quantity may be above 1.
ALTER TABLE "customerContractLine" DROP CONSTRAINT IF EXISTS "customerContractLine_billing_check";
ALTER TABLE "customerContractLine" ADD CONSTRAINT "customerContractLine_billing_check" CHECK (
  "billingMethod" = 'Fixed'
  OR ("projectId" IS NOT NULL AND "projectElementId" IS NOT NULL AND "quantity" > 0 AND "rate" = 0
      AND "revenueType" = 'One-time')
);

-- One open Draft delivery per contract, as a rental agreement has.
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_oneOpenDraftPerCustomerContract_idx"
  ON "shipment" ("sourceDocumentId", "companyId")
  WHERE "status" = 'Draft' AND "sourceDocument" = 'Customer Contract';
