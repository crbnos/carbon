-- ============================================================
-- Supplier payments by credit card, and a payment's failed post
-- ============================================================

-- 1. A "Credit Cards" group under Current Liabilities in every chart. A
--    ledger account takes its group's type, so this is where card accounts
--    live. Idempotent: re-running finds the group already there.
INSERT INTO "account" (
  number, name, "isGroup", "accountType", "incomeBalance", class,
  "parentId", "isSystem", "companyGroupId", "createdBy"
)
SELECT
  NULL, 'Credit Cards', TRUE, 'Credit Card'::"accountType",
  'Balance Sheet'::"glIncomeBalance", 'Liability'::"glAccountClass",
  parent.id, FALSE, parent."companyGroupId", 'system'
FROM "account" parent
WHERE parent."isGroup" = TRUE
  AND parent.name = 'Current Liabilities'
  AND parent.class = 'Liability'
  AND NOT EXISTS (
    SELECT 1 FROM "account" existing
    WHERE existing."companyGroupId" = parent."companyGroupId"
      AND existing."accountType" = 'Credit Card'
      AND existing."isGroup" = TRUE
  );

-- 2. An account a card charge already posts to is a card account. Move the
--    generic current liabilities among them into the group.
UPDATE "account" a
SET "accountType" = 'Credit Card',
    "parentId" = cards.id,
    "updatedBy" = 'system',
    "updatedAt" = NOW()
FROM "account" cards
WHERE cards."companyGroupId" = a."companyGroupId"
  AND cards."isGroup" = TRUE
  AND cards."accountType" = 'Credit Card'
  AND a."isGroup" = FALSE
  AND a.class = 'Liability'
  AND a."accountType" = 'Other Current Liability'
  AND a.id IN (SELECT DISTINCT "cardAccountId" FROM "charge");

-- 3. Why the payment's last post failed. Cleared when it posts.
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "postError" TEXT;

-- 4. A company's Draft payments, for what they will pay once posted. Few
--    rows per company, so a partial index keeps the read off the full table.
CREATE INDEX IF NOT EXISTS "payment_companyId_draft_idx"
  ON "payment" ("companyId") WHERE "status" = 'Draft';
