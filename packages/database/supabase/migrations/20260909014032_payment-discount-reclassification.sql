-- Reclassify AND renumber the payment-discount accounts to their correct GL homes.
-- A customer early-payment discount is a reduction of the transaction price
-- (contra-revenue, per ASC 606 / IFRS 15), and a supplier discount taken is a
-- reduction of the cost of goods (contra-COGS) — neither is an operating expense.
-- Both were originally seeded as class = Expense / Other Expense in the 7000
-- "Other Expenses" block (7030 customer, 7020 supplier). This moves them to:
--   * 7030 -> 4040 "Customer Payment Discounts": class Revenue, under "Revenue"
--   * 7020 -> 5080 "Supplier Payment Discounts": class Expense / Cost of Goods
--            Sold, under "Cost of Goods Sold"
-- matching functions/lib/seed.data.ts (fresh companies seed 4040 / 5080 directly)
-- and the contra-revenue customer credit-memo account 4020 "Sales Discounts".
--
-- Going-forward only: already-posted journalLine history is intentionally NOT
-- rewritten. accountDefault is untouched — the rows keep their ids, so the
-- customerPaymentDiscountAccount / supplierPaymentDiscountAccount FKs travel with
-- the renumber automatically. The account table is scoped by "companyGroupId" (it
-- has no "companyId"), and "number" is unique per companyGroupId.
--
-- Collision safety: "number" is UNIQUE per companyGroupId, and a company group
-- could already hold a custom 4040 / 5080 account. So the reclassification (class,
-- accountType, incomeBalance, parent — none unique-constrained) is applied
-- UNCONDITIONALLY by the old number, and the RENUMBER is applied only where the
-- target number is still free in that group. A group with a conflicting custom
-- account therefore keeps its 7030 / 7020 number but is still correctly
-- reclassified, rather than the whole migration aborting on the unique constraint
-- and leaving every tenant unmigrated (the deploy runner would retry-fail forever).
--
-- Idempotent: reclassification re-applies the same fixed values; the renumber is
-- matched by the old number, so once renumbered its WHERE no longer matches.

-- Customer Payment Discounts (7030): reclassify to contra-revenue, parent "Revenue".
UPDATE "account" a SET
  "class" = 'Revenue',
  "accountType" = 'Income',
  "incomeBalance" = 'Income Statement',
  "parentId" = COALESCE(
    (SELECT g."id" FROM "account" g
     WHERE g."companyGroupId" = a."companyGroupId"
       AND g."isGroup" = TRUE
       AND g."name" = 'Revenue'
     LIMIT 1),
    a."parentId"
  )
WHERE a."number" = '7030';

-- ...then renumber 7030 -> 4040 only where 4040 is free in that company group.
UPDATE "account" a SET "number" = '4040'
WHERE a."number" = '7030'
  AND NOT EXISTS (
    SELECT 1 FROM "account" b
    WHERE b."companyGroupId" = a."companyGroupId"
      AND b."number" = '4040'
  );

-- Supplier Payment Discounts (7020): reclassify to contra-COGS, parent "Cost of Goods Sold".
UPDATE "account" a SET
  "class" = 'Expense',
  "accountType" = 'Cost of Goods Sold',
  "incomeBalance" = 'Income Statement',
  "parentId" = COALESCE(
    (SELECT g."id" FROM "account" g
     WHERE g."companyGroupId" = a."companyGroupId"
       AND g."isGroup" = TRUE
       AND g."name" = 'Cost of Goods Sold'
     LIMIT 1),
    a."parentId"
  )
WHERE a."number" = '7020';

-- ...then renumber 7020 -> 5080 only where 5080 is free in that company group.
UPDATE "account" a SET "number" = '5080'
WHERE a."number" = '7020'
  AND NOT EXISTS (
    SELECT 1 FROM "account" b
    WHERE b."companyGroupId" = a."companyGroupId"
      AND b."number" = '5080'
  );
