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
-- Matched by the OLD number, so re-running is a no-op once renumbered (idempotent).
-- COALESCE on the parent subquery leaves the current parent in place for any
-- company group that lacks the target group rather than orphaning the account.

-- Customer Payment Discounts: 7030 -> 4040, contra-revenue, parent "Revenue".
UPDATE "account" a SET
  "number" = '4040',
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

-- Supplier Payment Discounts: 7020 -> 5080, contra-COGS, parent "Cost of Goods Sold".
UPDATE "account" a SET
  "number" = '5080',
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
