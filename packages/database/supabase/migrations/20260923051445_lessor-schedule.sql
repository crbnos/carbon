-- Sales-type lease schedule: one effective-interest row per period of a
-- Sales-Type rental line; each spawns one Interest revenue recognition row.
-- Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §4, Data Model §5

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

-- RLS: the schedule belongs to the rental agreement, a sales document. Rows are
-- written by service-role posting paths; the policies gate the app's reads.
ALTER TABLE "public"."rentalLeaseScheduleLine" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."rentalLeaseScheduleLine";
CREATE POLICY "SELECT" ON "public"."rentalLeaseScheduleLine" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."rentalLeaseScheduleLine";
CREATE POLICY "INSERT" ON "public"."rentalLeaseScheduleLine" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."rentalLeaseScheduleLine";
CREATE POLICY "UPDATE" ON "public"."rentalLeaseScheduleLine" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."rentalLeaseScheduleLine";
CREATE POLICY "DELETE" ON "public"."rentalLeaseScheduleLine" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

-- An Interest schedule row points at the lease schedule line it recognizes.
DO $leaseschedfk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'revenueRecognitionSchedule_rentalLeaseScheduleLineId_fkey') THEN
    ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_rentalLeaseScheduleLineId_fkey"
      FOREIGN KEY ("rentalLeaseScheduleLineId", "companyId")
      REFERENCES "rentalLeaseScheduleLine"("id", "companyId") ON DELETE SET NULL;
  END IF;
END $leaseschedfk$;
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_leaseLine_idx"
  ON "revenueRecognitionSchedule" ("rentalLeaseScheduleLineId", "companyId");

NOTIFY pgrst, 'reload schema';
