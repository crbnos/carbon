ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "overheadAbsorptionAccount" TEXT;

-- RESTRICT (not SET NULL): deleting the account must not silently disable
-- overhead absorption. Drop-and-recreate so DBs that already applied the
-- earlier SET NULL version of this migration get corrected.
ALTER TABLE "accountDefault"
  DROP CONSTRAINT IF EXISTS "accountDefault_overheadAbsorptionAccount_fkey";
ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_overheadAbsorptionAccount_fkey"
  FOREIGN KEY ("overheadAbsorptionAccount") REFERENCES "account"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
