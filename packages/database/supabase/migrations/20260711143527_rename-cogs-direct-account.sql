-- Rename "Cost of Goods Sold - Direct" (5010) to "Cost of Goods Sold"
-- and update the account_name_key uniqueness constraint to allow a group account
-- and a leaf account to share the same name (e.g. the "Cost of Goods Sold" section
-- header group and the "Cost of Goods Sold" posting account 5010).

-- Step 1: Modify the uniqueness constraint to include isGroup so that group
-- accounts and leaf accounts are independently unique per company group.
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_name_key";
ALTER TABLE "account" ADD CONSTRAINT "account_name_key"
  UNIQUE ("name", "companyGroupId", "isGroup");

-- Step 2: Rename the "Cost of Goods Sold - Direct" leaf account to
-- "Cost of Goods Sold" across all company groups.
UPDATE "account"
SET "name" = 'Cost of Goods Sold'
WHERE "name" = 'Cost of Goods Sold - Direct'
  AND "isGroup" = false;
