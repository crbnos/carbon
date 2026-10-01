-- The two rental pointer FKs are composite ("…Id", "companyId") with a bare
-- ON DELETE SET NULL, which nulls companyId too and fails on its NOT NULL
-- (lesson: "ON DELETE SET NULL on a composite FK nulls every referencing
-- column"). Name the pointer column so only it is cleared. Postgres 15+.

ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_rentalAgreementId_fkey";
ALTER TABLE "payment" ADD CONSTRAINT "payment_rentalAgreementId_fkey"
  FOREIGN KEY ("rentalAgreementId", "companyId")
  REFERENCES "rentalAgreement"("id", "companyId")
  ON DELETE SET NULL ("rentalAgreementId");

ALTER TABLE "revenueRecognitionSchedule" DROP CONSTRAINT IF EXISTS "revenueRecognitionSchedule_rentalLeaseScheduleLineId_fkey";
ALTER TABLE "revenueRecognitionSchedule" ADD CONSTRAINT "revenueRecognitionSchedule_rentalLeaseScheduleLineId_fkey"
  FOREIGN KEY ("rentalLeaseScheduleLineId", "companyId")
  REFERENCES "rentalLeaseScheduleLine"("id", "companyId")
  ON DELETE SET NULL ("rentalLeaseScheduleLineId");
