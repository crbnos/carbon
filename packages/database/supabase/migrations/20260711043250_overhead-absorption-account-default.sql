-- Seed "Overhead Absorption" (5070) for every company group that has a
-- Cost of Goods Sold group account, then wire it into accountDefault.
-- 5060 is already "Labor & Machine Absorption"; 5070 is the next slot.

-- ============================================================
-- Step 1: Insert the account for each company group
-- ============================================================

INSERT INTO "account" (
  "number", "name", "isGroup", "accountType", "incomeBalance", "class",
  "parentId", "isSystem", "companyGroupId", "createdBy"
)
SELECT
  '5070',
  'Overhead Absorption',
  FALSE,
  'Cost of Goods Sold'::"accountType",
  'Income Statement'::"glIncomeBalance",
  'Expense'::"glAccountClass",
  cogs."id",
  FALSE,
  cogs."companyGroupId",
  'system'
FROM "account" cogs
WHERE cogs."isGroup" = TRUE
  AND cogs."name" = 'Cost of Goods Sold'
  AND NOT EXISTS (
    SELECT 1 FROM "account" x
    WHERE x."companyGroupId" = cogs."companyGroupId"
      AND x."number" = '5070'
  );

-- ============================================================
-- Step 2: Backfill accountDefault for existing and new companies
-- ============================================================

UPDATE "accountDefault" ad
SET "overheadAbsorptionAccount" = a."id"
FROM "account" a
JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
WHERE c."id" = ad."companyId"
  AND a."number" = '5070'
  AND a."isGroup" = FALSE
  AND ad."overheadAbsorptionAccount" IS NULL;
