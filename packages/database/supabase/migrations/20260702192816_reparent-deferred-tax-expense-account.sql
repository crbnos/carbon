-- 20260524143827_fixed-assets.sql seeded the "Deferred Tax Expense" (7090)
-- account for existing company groups with its parent resolved by
-- `number = '7000' AND "isGroup" = true`. Group header accounts carry NO
-- number (number IS NULL; they are keyed by name, e.g. 'Other Expenses'), so
-- that lookup returned NULL and 7090 was inserted orphaned — hanging at the
-- root of the chart of accounts instead of under Other Expenses. New
-- companies are unaffected (seed.data.ts parents it via parentKey).
--
-- Re-parent the orphaned rows to their group's "Other Expenses" header, the
-- same parent seed.data.ts assigns. No-op where already parented or where a
-- custom chart has no such group.

UPDATE "account" a
SET "parentId" = g."id"
FROM "account" g
WHERE a."parentId" IS NULL
  AND a."isGroup" = FALSE
  AND (
    a."number" = '7090'
    OR (a."name" = 'Deferred Tax Expense' AND a."createdBy" = 'system')
  )
  AND g."companyGroupId" = a."companyGroupId"
  AND g."isGroup" = TRUE
  AND g."name" = 'Other Expenses'
  AND g."class" = 'Expense';
