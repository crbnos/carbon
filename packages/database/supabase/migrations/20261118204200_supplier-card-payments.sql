-- ============================================================
-- Supplier payments by credit card, and a payment's failed post
-- ============================================================

-- 0. A chart may already have a "Credit Cards" group someone made by hand,
--    typed as a generic liability. Make that group the card group rather
--    than add a second one: "account_name_key" is UNIQUE (name,
--    companyGroupId, isGroup), so the insert below would fail on it.
UPDATE "account" g
SET "accountType" = 'Credit Card',
    "updatedBy" = 'system',
    "updatedAt" = NOW()
WHERE g."isGroup" = TRUE
  AND g.name = 'Credit Cards'
  AND g.class = 'Liability'
  AND NOT EXISTS (
    SELECT 1 FROM "account" existing
    WHERE existing."companyGroupId" = g."companyGroupId"
      AND existing."accountType" = 'Credit Card'
      AND existing."isGroup" = TRUE
  );

-- 1. A "Credit Cards" group under Current Liabilities in every chart. A
--    ledger account takes its group's type, so this is where card accounts
--    live. Idempotent: re-running finds the group already there.
INSERT INTO "account" (
  number, name, "isGroup", "accountType", "incomeBalance", class,
  "parentId", "isSystem", "companyGroupId", "createdBy"
)
-- One per chart, even one with two groups of that name.
SELECT DISTINCT ON (parent."companyGroupId")
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
  )
ORDER BY parent."companyGroupId", parent."createdAt", parent.id
-- A "Credit Cards" group of another class holds the name; that chart gets
-- no card group rather than failing the deploy.
ON CONFLICT ON CONSTRAINT "account_name_key" DO NOTHING;

-- 2. An account a card charge already posts to is a card account, and so is
--    a generic current liability already in the group. Move them into the
--    group as Credit Card accounts.
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
  AND (
    a."parentId" = cards.id
    OR a.id IN (SELECT DISTINCT "cardAccountId" FROM "charge")
  );

-- 3. Why the payment's last post failed. Cleared when it posts.
ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "postError" TEXT;

-- 4. A company's Draft payments, for what they will pay once posted. Few
--    rows per company, so a partial index keeps the read off the full table.
CREATE INDEX IF NOT EXISTS "payment_companyId_draft_idx"
  ON "payment" ("companyId") WHERE "status" = 'Draft';
