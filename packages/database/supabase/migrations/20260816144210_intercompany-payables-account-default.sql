-- Mirror of intercompanyReceivablesAccount (migration 20260702181547): the buyer
-- side of an intercompany invoice must book its payable to the Inter-Company
-- Payables control account (number 2020) instead of regular Accounts Payable, so
-- the group's IC receivable (seller) and IC payable (buyer) sit in matching
-- control accounts and the elimination can clear them against each other.
--
-- Store the account id on accountDefault (authoritative by id, resolved once from
-- the seeded number). post-purchase-invoice swaps payablesAccount ->
-- intercompanyPayablesAccount when the supplier is an intercompany partner,
-- exactly as post-sales-invoice swaps receivablesAccount ->
-- intercompanyReceivablesAccount.

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "intercompanyPayablesAccount" TEXT;

ALTER TABLE "accountDefault"
  DROP CONSTRAINT IF EXISTS "accountDefault_intercompanyPayablesAccount_fkey";
ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_intercompanyPayablesAccount_fkey"
  FOREIGN KEY ("intercompanyPayablesAccount") REFERENCES "account"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Backfill existing companies from the seeded Inter-Company Payables account
-- (number 2020 within the company's group). One-time resolution: from here the
-- stored id survives number/name changes. Nullable — companies that don't use
-- intercompany simply leave it unset and fall back to regular payables.
UPDATE "accountDefault" ad
SET "intercompanyPayablesAccount" = a."id"
FROM "account" a
JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
WHERE c."id" = ad."companyId"
  AND a."number" = '2020'
  AND ad."intercompanyPayablesAccount" IS NULL;
