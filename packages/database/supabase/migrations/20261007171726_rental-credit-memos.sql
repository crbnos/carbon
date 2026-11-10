-- Early-return credits are credit memos, not negative invoice lines.
--
-- A negative Rent line netted an invoice below zero, and a negative invoice
-- can be neither applied to another invoice nor refunded (applications are
-- non-negative; refunds target memos). The invoice run now drafts one credit
-- memo per agreement for its due early-return adjustments, stamps the
-- adjustment periods with it, and post-memo books the rental legs
-- (Dr Deferred Revenue / Dr Rental Income, Cr AR) and the negative Deferral
-- rows the invoice line used to write.

-- The agreement a credit memo credits.
ALTER TABLE "memo" ADD COLUMN IF NOT EXISTS "rentalAgreementId" TEXT;
DO $$ BEGIN
  ALTER TABLE "memo" ADD CONSTRAINT "memo_rentalAgreement_fkey"
    FOREIGN KEY ("rentalAgreementId", "companyId") REFERENCES "rentalAgreement"("id", "companyId")
    ON DELETE SET NULL ("rentalAgreementId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "memo_rentalAgreementId_idx" ON "memo" ("rentalAgreementId");

-- The credit memo that bills an early-return adjustment. RESTRICT: a Draft
-- rental credit is deleted through the path that returns its periods to
-- Pending, so a plain delete cannot strand them as Invoiced with nothing
-- billing them.
ALTER TABLE "rentalBillingPeriod" ADD COLUMN IF NOT EXISTS "memoId" TEXT;
DO $$ BEGIN
  ALTER TABLE "rentalBillingPeriod" ADD CONSTRAINT "rentalBillingPeriod_memo_fkey"
    FOREIGN KEY ("memoId") REFERENCES "memo"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "rentalBillingPeriod" ADD CONSTRAINT "rentalBillingPeriod_memo_check"
    CHECK ("memoId" IS NULL OR ("isAdjustment" AND "salesInvoiceLineId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "rentalBillingPeriod_memoId_idx" ON "rentalBillingPeriod" ("memoId");

-- The negative Deferral rows a posted rental credit memo wrote, so its void
-- finds and removes exactly them.
ALTER TABLE "revenueRecognitionSchedule" ADD COLUMN IF NOT EXISTS "memoId" TEXT;
DO $$ BEGIN
  ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_memo_fkey"
    FOREIGN KEY ("memoId") REFERENCES "memo"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "revenueRecognitionSchedule_memoId_idx" ON "revenueRecognitionSchedule" ("memoId");
