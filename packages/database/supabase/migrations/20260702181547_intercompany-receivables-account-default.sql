-- Intercompany invoices are booked to (and their payments must relieve) the
-- Inter-Company Receivables control account. That account was resolved by
-- looking it up by number ("1130") at posting time, which is fragile: account
-- numbers and names are user-editable, so a rename silently mis-posts.
--
-- Store the account id on accountDefault instead (the same pattern used for
-- receivablesAccount / payablesAccount), resolved once here from the seeded
-- number and authoritative by id thereafter.

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "intercompanyReceivablesAccount" TEXT;

ALTER TABLE "accountDefault"
  DROP CONSTRAINT IF EXISTS "accountDefault_intercompanyReceivablesAccount_fkey";
ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_intercompanyReceivablesAccount_fkey"
  FOREIGN KEY ("intercompanyReceivablesAccount") REFERENCES "account"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Backfill existing companies from the seeded Inter-Company Receivables account
-- (number 1130 within the company's group). One-time resolution: from here the
-- stored id survives number/name changes. Nullable — companies that don't use
-- intercompany simply leave it unset and fall back to regular receivables.
UPDATE "accountDefault" ad
SET "intercompanyReceivablesAccount" = a."id"
FROM "account" a
JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
WHERE c."id" = ad."companyId"
  AND a."number" = '1130'
  AND ad."intercompanyReceivablesAccount" IS NULL;
