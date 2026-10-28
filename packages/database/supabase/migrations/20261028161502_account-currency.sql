-- The currency an account's balance is held in (a foreign-currency bank, cash
-- or loan account). The currency revaluation run revalues such an account at
-- the period end from the statement balance the accountant enters.
-- Spec: .ai/specs/2026-10-26-fx-revaluation-and-cta-posting.md (Phase 2)
-- Plan: .ai/plans/2026-10-26-fx-revaluation-and-cta-posting.md (Task 16)

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "currencyCode" TEXT;

DO $acctccy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"account"'::regclass AND conname = 'account_currencyCode_fkey'
  ) THEN
    ALTER TABLE "account" ADD CONSTRAINT "account_currencyCode_fkey"
      FOREIGN KEY ("currencyCode") REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $acctccy$;

CREATE INDEX IF NOT EXISTS "account_currencyCode_idx" ON "account" ("currencyCode");

-- "accounts" is SELECT account.*: its column list froze when it was created.
-- The new column is the table's last, so CREATE OR REPLACE can append it.
CREATE OR REPLACE VIEW "accounts" WITH(SECURITY_INVOKER=true) AS SELECT "account".* FROM "account";

NOTIFY pgrst, 'reload schema';
