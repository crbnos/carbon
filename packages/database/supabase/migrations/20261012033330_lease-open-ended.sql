-- An open-ended lease and a lease with no name (spec 2026-10-11-lessee-leases →
-- Addendum A10, A11). An open-ended lease has no end date: it can be ended on
-- notice, so every asset is short-term and its payment rows roll forward. A
-- lease is named by its number and its supplier; the name is optional.

ALTER TABLE "lease" ALTER COLUMN "endDate" DROP NOT NULL;
ALTER TABLE "lease" ALTER COLUMN "name" DROP NOT NULL;

ALTER TABLE "lease" DROP CONSTRAINT IF EXISTS "lease_dates_check";
ALTER TABLE "lease" ADD CONSTRAINT "lease_dates_check"
  CHECK ("endDate" IS NULL OR "endDate" >= "commencementDate");
