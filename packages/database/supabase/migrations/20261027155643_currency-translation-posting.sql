-- Posted CTA: the offset account default and the close-checklist task.
-- The consolidated CTA posts on the root company's elimination entity as
-- Dr/Cr currencyTranslationAccount, Cr/Dr currencyTranslationOffsetAccount;
-- consolidated reports hide the offset account.
-- Spec: .ai/specs/2026-10-26-fx-revaluation-and-cta-posting.md (Phase 3)
-- Plan: .ai/plans/2026-10-26-fx-revaluation-and-cta-posting.md (Task 19)

-- 1) Account default -------------------------------------------------------------------
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "currencyTranslationOffsetAccount" TEXT;

DO $ctafk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"accountDefault"'::regclass
      AND conname = 'accountDefault_currencyTranslationOffsetAccount_fkey'
  ) THEN
    ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_currencyTranslationOffsetAccount_fkey"
      FOREIGN KEY ("currencyTranslationOffsetAccount") REFERENCES "account"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $ctafk$;

-- 2) Account, one per company group that has a chart -----------------------------------
-- Never isSystem: report trees treat isSystem rows as chart roots.
DO $ctaaccount$
DECLARE
  grp TEXT;
  parent_id TEXT;
BEGIN
  FOR grp IN SELECT DISTINCT a."companyGroupId" FROM "account" a LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM "account" a
      WHERE a."companyGroupId" = grp
        AND (a.number = '3210' OR a.name = 'Currency Translation Offset')
    );

    SELECT g.id INTO parent_id
    FROM "account" g
    WHERE g."companyGroupId" = grp AND g."isGroup" = TRUE AND g.name = 'Equity'
    LIMIT 1;

    IF parent_id IS NULL THEN
      SELECT p.id INTO parent_id
      FROM "account" a
      JOIN "account" p ON p.id = a."parentId" AND p."isGroup" = TRUE
      WHERE a."companyGroupId" = grp AND a.number = '3200'
      LIMIT 1;
    END IF;

    IF parent_id IS NULL THEN
      RAISE NOTICE 'currency-translation-posting: company group % has no "Equity" group; account 3210 is at the chart root', grp;
    END IF;

    INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
    VALUES (
      id('acct'), '3210', 'Currency Translation Offset', 'Equity'::"glAccountClass",
      'Equity - Close'::"accountType", 'Balance Sheet'::"glIncomeBalance",
      'Historical'::"glConsolidatedRate", parent_id, false, true, false, grp, 'system'
    );
  END LOOP;
END $ctaaccount$;

-- 3) Backfill the default by id: by number and name, then by leaf name -----------------
UPDATE "accountDefault" ad SET "currencyTranslationOffsetAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = '3210'
  AND a.name = 'Currency Translation Offset' AND a."isGroup" = FALSE
WHERE ad."companyId" = c.id AND ad."currencyTranslationOffsetAccount" IS NULL;

UPDATE "accountDefault" ad SET "currencyTranslationOffsetAccount" = a.id, "updatedBy" = 'system'
FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId"
  AND a.name = 'Currency Translation Offset' AND a."isGroup" = FALSE
WHERE ad."companyId" = c.id AND ad."currencyTranslationOffsetAccount" IS NULL;

-- 4) Close-checklist task ---------------------------------------------------------------
INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Post currency translation adjustment', 'Auto', 'cta-posted', 6, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Post currency translation adjustment'
  );

-- 5) List (do not change) balance-sheet leaves translated at the average rate. The
--    account form submitted 'Average' for every account it saved until this change, so
--    an edited asset or liability may now translate wrongly into the posted CTA.
DO $ctaaudit$
DECLARE
  row RECORD;
BEGIN
  FOR row IN
    SELECT a."companyGroupId", string_agg(COALESCE(a.number, a.name), ', ' ORDER BY a.number) AS accounts
    FROM "account" a
    WHERE a."isGroup" = FALSE
      AND a.class IN ('Asset', 'Liability')
      AND a."consolidatedRate" = 'Average'
    GROUP BY a."companyGroupId"
  LOOP
    RAISE NOTICE 'currency-translation-posting: company group % has balance-sheet accounts at the Average rate: %',
      row."companyGroupId", row.accounts;
  END LOOP;
END $ctaaudit$;

NOTIFY pgrst, 'reload schema';
