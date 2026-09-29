-- A rental unit bills ONE rate: a frequency (`rateUnit`: Day / Week / Month)
-- and its value (`rate`). The value starts from the customer's, customer
-- type's or item's rate card for that frequency and is the unit's own from
-- then on, so it is what billing and lease classification read. Replaces the
-- Best Rate / Fixed mode and the three snapshotted tiers.

ALTER TABLE "rentalAgreementLine" ADD COLUMN IF NOT EXISTS "rate" NUMERIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rentalAgreementLine'
      AND column_name = 'rateMode'
  ) THEN
    -- A Fixed line keeps its tier; a Best Rate line takes its largest tier.
    UPDATE "rentalAgreementLine"
    SET "rateUnit" = COALESCE(
      "rateUnit",
      CASE
        WHEN "monthRate" IS NOT NULL THEN 'Month'
        WHEN "weekRate" IS NOT NULL THEN 'Week'
        WHEN "dayRate" IS NOT NULL THEN 'Day'
        ELSE 'Month'
      END::"rentalRateUnit"
    );
    UPDATE "rentalAgreementLine"
    SET "rate" = CASE "rateUnit"
      WHEN 'Day' THEN "dayRate"
      WHEN 'Week' THEN "weekRate"
      ELSE "monthRate"
    END;
  END IF;
END
$$;

-- A Draft line never activated has no snapshot: start it from the item's
-- rate for its frequency, else zero, for the planner to correct.
UPDATE "rentalAgreementLine" l
SET "rate" = COALESCE(
  (
    SELECT CASE l."rateUnit"
      WHEN 'Day' THEN r."dayRate"
      WHEN 'Week' THEN r."weekRate"
      ELSE r."monthRate"
    END
    FROM "itemRentalRate" r
    JOIN "rentalAgreement" a
      ON a."id" = l."rentalAgreementId" AND a."companyId" = l."companyId"
    WHERE r."itemId" = l."itemId"
      AND r."companyId" = l."companyId"
      AND r."currencyCode" = a."currencyCode"
  ),
  0
)
WHERE l."rate" IS NULL;

ALTER TABLE "rentalAgreementLine" DROP CONSTRAINT IF EXISTS "rentalAgreementLine_rate_check";
ALTER TABLE "rentalAgreementLine"
  ALTER COLUMN "rateUnit" SET DEFAULT 'Month',
  ALTER COLUMN "rateUnit" SET NOT NULL,
  ALTER COLUMN "rate" SET NOT NULL;
ALTER TABLE "rentalAgreementLine" DROP CONSTRAINT IF EXISTS "rentalAgreementLine_rate_nonnegative";
ALTER TABLE "rentalAgreementLine"
  ADD CONSTRAINT "rentalAgreementLine_rate_nonnegative" CHECK ("rate" >= 0);

ALTER TABLE "rentalAgreementLine"
  DROP COLUMN IF EXISTS "rateMode",
  DROP COLUMN IF EXISTS "dayRate",
  DROP COLUMN IF EXISTS "weekRate",
  DROP COLUMN IF EXISTS "monthRate";

DROP TYPE IF EXISTS "rentalRateMode";
