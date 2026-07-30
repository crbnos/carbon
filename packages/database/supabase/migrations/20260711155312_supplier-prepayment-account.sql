-- Add account 1150 "Supplier Prepayments" as a current-asset account and
-- wire it to accountDefault as supplierPrepaymentAccount.
--
-- Customer prepayments (2110) = liability (money owed back to customers).
-- Supplier prepayments (1150) = asset (goods owed to us by suppliers).

-- Step 1: Insert the account for every existing companyGroup that doesn't
-- already have account number 1150.
INSERT INTO "account" (
  "number", "name", "isGroup", "accountType", "incomeBalance", "class",
  "parentId", "isSystem", "companyGroupId", "createdBy"
)
SELECT
  '1150',
  'Supplier Prepayments',
  false,
  'Other Current Asset'::"accountType",
  'Balance Sheet'::"glIncomeBalance",
  'Asset'::"glAccountClass",
  parent."id",
  false,
  cg."id",
  'system'
FROM "companyGroup" cg
JOIN "account" parent
  ON parent."companyGroupId" = cg."id"
  AND parent."isGroup" = true
  AND parent."name" = 'Receivables'
WHERE NOT EXISTS (
  SELECT 1 FROM "account" a
  WHERE a."companyGroupId" = cg."id"
    AND a."number" = '1150'
);

-- Step 2: Add the column.
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "supplierPrepaymentAccount" TEXT;

ALTER TABLE "accountDefault"
  DROP CONSTRAINT IF EXISTS "accountDefault_supplierPrepaymentAccount_fkey";
ALTER TABLE "accountDefault"
  ADD CONSTRAINT "accountDefault_supplierPrepaymentAccount_fkey"
  FOREIGN KEY ("supplierPrepaymentAccount") REFERENCES "account"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Step 3: Backfill from the newly inserted account. A group with a customized
-- COA (renamed/deleted 'Receivables' group) never got an 1150 inserted above,
-- so COALESCE to an existing, always-NOT-NULL default of the same nature
-- (supplier prepayments are a receivable-like current asset) so no NULL
-- survives and SET NOT NULL below can never fail — the deploy runner retries
-- a failed file over committed partial state. Admins override in settings.
UPDATE "accountDefault" ad
SET "supplierPrepaymentAccount" = COALESCE(
  (SELECT a."id" FROM "account" a
    INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
    WHERE c."id" = ad."companyId"
      AND a."number" = '1150'
      AND a."isGroup" = false
    LIMIT 1),
  ad."receivablesAccount"
)
WHERE ad."supplierPrepaymentAccount" IS NULL;

-- Step 4: Enforce NOT NULL now that every row is populated.
ALTER TABLE "accountDefault"
  ALTER COLUMN "supplierPrepaymentAccount" SET NOT NULL;
