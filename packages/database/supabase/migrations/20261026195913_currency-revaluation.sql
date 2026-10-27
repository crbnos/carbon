-- Period-end FX revaluation: account defaults, accounts, the Currency Revaluation run.
-- Spec: .ai/specs/2026-10-26-fx-revaluation-and-cta-posting.md
-- Plan: .ai/plans/2026-10-26-fx-revaluation-and-cta-posting.md (Task 2)

-- 1) Account defaults ------------------------------------------------------------------
-- Nullable, seeded and backfilled by id (lessee-lease precedent, 20261011163211).
-- ACCOUNT_DEFAULT_COLUMNS makes them required at accounting setup.
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "unrealizedExchangeGainAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "unrealizedExchangeLossAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "arRevaluationAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "apRevaluationAccount" TEXT;

DO $fxfk$
DECLARE
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'unrealizedExchangeGainAccount', 'unrealizedExchangeLossAccount',
    'arRevaluationAccount', 'apRevaluationAccount'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = '"accountDefault"'::regclass AND conname = 'accountDefault_' || col || '_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE "accountDefault" ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "account"(id) ON DELETE RESTRICT ON UPDATE CASCADE',
        'accountDefault_' || col || '_fkey', col
      );
    END IF;
  END LOOP;
END $fxfk$;

-- 2) Accounts, one per company group that has a chart ---------------------------------
-- A group that already holds the number OR the name keeps its account; the parent is
-- the seeded group by NAME, else the group of a seeded sibling, else the chart root
-- with a NOTICE.
DO $fxaccounts$
DECLARE
  spec RECORD;
  grp TEXT;
  parent_id TEXT;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('4160', 'Unrealized Exchange Gains', 'Revenue', 'Other Income', 'Income Statement', 'Average', 'Other Income', ARRAY['4120', '4110']),
      ('7030', 'Unrealized Exchange Losses', 'Expense', 'Other Expense', 'Income Statement', 'Average', 'Other Expenses', ARRAY['7060', '7010']),
      ('1170', 'AR Revaluation Adjustment', 'Asset', 'Other Current Asset', 'Balance Sheet', 'Current', 'Receivables', ARRAY['1110', '1130']),
      ('2030', 'AP Revaluation Adjustment', 'Liability', 'Other Current Liability', 'Balance Sheet', 'Current', 'Payables', ARRAY['2010', '2020'])
    ) AS s(number, name, class, account_type, income_balance, consolidated_rate, parent_name, sibling_numbers)
  LOOP
    FOR grp IN SELECT DISTINCT a."companyGroupId" FROM "account" a LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM "account" a
        WHERE a."companyGroupId" = grp AND (a.number = spec.number OR a.name = spec.name)
      );

      SELECT g.id INTO parent_id
      FROM "account" g
      WHERE g."companyGroupId" = grp AND g."isGroup" = TRUE AND g.name = spec.parent_name
      LIMIT 1;

      IF parent_id IS NULL THEN
        SELECT p.id INTO parent_id
        FROM "account" a
        JOIN "account" p ON p.id = a."parentId" AND p."isGroup" = TRUE
        WHERE a."companyGroupId" = grp AND a.number = ANY (spec.sibling_numbers)
        ORDER BY array_position(spec.sibling_numbers, a.number)
        LIMIT 1;
      END IF;

      IF parent_id IS NULL THEN
        RAISE NOTICE 'currency-revaluation: company group % has no "%" group; account % % is at the chart root',
          grp, spec.parent_name, spec.number, spec.name;
      END IF;

      INSERT INTO "account" ("id", "number", "name", "class", "accountType", "incomeBalance", "consolidatedRate", "parentId", "isGroup", "active", "isSystem", "companyGroupId", "createdBy")
      VALUES (
        id('acct'), spec.number, spec.name, spec.class::"glAccountClass", spec.account_type::"accountType",
        spec.income_balance::"glIncomeBalance", spec.consolidated_rate::"glConsolidatedRate",
        parent_id, false, true, false, grp, 'system'
      );
    END LOOP;
  END LOOP;
END $fxaccounts$;

-- 3) Backfill the four defaults by id: by number, then by leaf name --------------------
DO $fxdefaults$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('unrealizedExchangeGainAccount', '4160', 'Unrealized Exchange Gains'),
      ('unrealizedExchangeLossAccount', '7030', 'Unrealized Exchange Losses'),
      ('arRevaluationAccount', '1170', 'AR Revaluation Adjustment'),
      ('apRevaluationAccount', '2030', 'AP Revaluation Adjustment')
    ) AS s(col, number, name)
  LOOP
    EXECUTE format(
      'UPDATE "accountDefault" ad SET %1$I = a.id, "updatedBy" = ''system''
       FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId" AND a.number = %2$L
         AND a.name = %3$L AND a."isGroup" = FALSE
       WHERE ad."companyId" = c.id AND ad.%1$I IS NULL',
      spec.col, spec.number, spec.name
    );
    EXECUTE format(
      'UPDATE "accountDefault" ad SET %1$I = a.id, "updatedBy" = ''system''
       FROM "company" c JOIN "account" a ON a."companyGroupId" = c."companyGroupId"
         AND a.name = %2$L AND a."isGroup" = FALSE
       WHERE ad."companyId" = c.id AND ad.%1$I IS NULL',
      spec.col, spec.name
    );
  END LOOP;
END $fxdefaults$;

-- 4) Tables ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "currencyRevaluationRun" (
  "id" TEXT NOT NULL DEFAULT id('fxr'),
  "currencyRevaluationRunId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft' CHECK ("status" IN ('Draft', 'Posted')),
  "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "reversalJournalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "currencyRevaluationRun_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationRun_readable_key" UNIQUE ("currencyRevaluationRunId", "companyId"),
  CONSTRAINT "currencyRevaluationRun_period_key" UNIQUE ("companyId", "periodEnd"),
  CONSTRAINT "currencyRevaluationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "currencyRevaluationRun_companyId_idx" ON "currencyRevaluationRun" ("companyId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRun_journalId_idx" ON "currencyRevaluationRun" ("journalId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRun_reversalJournalId_idx" ON "currencyRevaluationRun" ("reversalJournalId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRun_postedBy_idx" ON "currencyRevaluationRun" ("postedBy");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRun_createdBy_idx" ON "currencyRevaluationRun" ("createdBy");

-- RLS: the policies are rendered from packages/database/src/authz/manifest.ts.

CREATE TABLE IF NOT EXISTS "currencyRevaluationRate" (
  "id" TEXT NOT NULL DEFAULT id('fxrr'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
  -- units of currencyCode per 1 unit of the company's base currency
  "rate" NUMERIC NOT NULL CHECK ("rate" > 0 AND "rate" <> 'NaN'::numeric),
  "rateSource" TEXT NOT NULL CHECK ("rateSource" IN ('Market', 'Override', 'Manual')),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "currencyRevaluationRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationRate_run_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "currencyRevaluationRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "currencyRevaluationRate_run_currency_key" UNIQUE ("runId", "currencyCode"),
  CONSTRAINT "currencyRevaluationRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "currencyRevaluationRate_companyId_idx" ON "currencyRevaluationRate" ("companyId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRate_runId_idx" ON "currencyRevaluationRate" ("runId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRate_currencyCode_idx" ON "currencyRevaluationRate" ("currencyCode");
CREATE INDEX IF NOT EXISTS "currencyRevaluationRate_createdBy_idx" ON "currencyRevaluationRate" ("createdBy");

-- RLS: the policies are rendered from packages/database/src/authz/manifest.ts.

CREATE TABLE IF NOT EXISTS "currencyRevaluationLine" (
  "id" TEXT NOT NULL DEFAULT id('fxrl'),
  "companyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "exposureType" TEXT NOT NULL CHECK ("exposureType" IN (
    'Receivable', 'Payable', 'Unapplied Receipt', 'Unapplied Disbursement', 'Account Balance')),
  "documentType" TEXT,
  "documentId" TEXT,
  "documentNumber" TEXT,
  -- the AR/AP revaluation adjustment account, or the balance account itself
  "accountId" TEXT NOT NULL REFERENCES "account"("id"),
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
  -- in currencyCode, natural sign; NULL until entered (Account Balance)
  "openAmount" NUMERIC,
  "openAmountEnteredBy" TEXT REFERENCES "user"("id"),
  "openAmountEnteredAt" TIMESTAMP WITH TIME ZONE,
  "bookedBaseAmount" NUMERIC NOT NULL,
  "revaluedBaseAmount" NUMERIC,
  -- positive = unrealized gain, negative = unrealized loss
  "differenceAmount" NUMERIC,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "currencyRevaluationLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "currencyRevaluationLine_run_fkey" FOREIGN KEY ("runId", "companyId") REFERENCES "currencyRevaluationRun"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "currencyRevaluationLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_companyId_idx" ON "currencyRevaluationLine" ("companyId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_runId_idx" ON "currencyRevaluationLine" ("runId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_accountId_idx" ON "currencyRevaluationLine" ("accountId");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_currencyCode_idx" ON "currencyRevaluationLine" ("currencyCode");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_openAmountEnteredBy_idx" ON "currencyRevaluationLine" ("openAmountEnteredBy");
CREATE INDEX IF NOT EXISTS "currencyRevaluationLine_createdBy_idx" ON "currencyRevaluationLine" ("createdBy");

-- RLS: the policies are rendered from packages/database/src/authz/manifest.ts.

-- 5) Sequence per company ----------------------------------------------------------------
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'currencyRevaluationRun', 'Currency Revaluation Run', 'FXR', NULL, 0, 6, 1, c.id
FROM "company" c
WHERE NOT EXISTS (SELECT 1 FROM "sequence" s WHERE s."companyId" = c.id AND s."table" = 'currencyRevaluationRun');

-- 6) Close-checklist task (its evaluator ships in the same change set) ------------------
INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Revalue foreign currency balances', 'Auto', 'fx-revaluation', 4, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Revalue foreign currency balances'
  );

NOTIFY pgrst, 'reload schema';
