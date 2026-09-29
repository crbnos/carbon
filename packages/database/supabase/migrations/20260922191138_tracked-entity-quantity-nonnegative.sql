-- A tracked entity must never hold a negative quantity: the pick/adjust/count/
-- correction paths now round at the persist boundary and refuse over-draws, so
-- a negative quantity can only be corruption. Added NOT VALID so existing bad
-- prod rows (the ZeroFarms −20 husk) do not fail the deploy; a later migration
-- VALIDATEs it once the historical rows are repaired (same convention as
-- 20260805152353_timezone-validity-check.sql / the 20260827115500 VALIDATE step).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'trackedEntity_quantity_nonnegative'
  ) THEN
    ALTER TABLE "trackedEntity"
      ADD CONSTRAINT "trackedEntity_quantity_nonnegative"
      CHECK ("quantity" >= 0) NOT VALID;
  END IF;
END $$;
