-- Financial reporting: cash flow classification + four-column trial balance
-- Spec: .ai/specs/2026-07-02-financial-reporting.md
--
-- NOTE ON POSTED-ONLY BALANCES (spec §11): 20260711011724_exclude-draft-journals.sql
-- already excludes Draft journals from accountTreeBalancesByCompany and the
-- journalLines view UNCONDITIONALLY (repo evolved past the spec's proposed
-- p_include_drafts toggle). We keep that behavior: the four-column trialBalance
-- below excludes Draft journals in its movements CTE so period debits/credits
-- tie out with the opening/closing balances it joins from accountTreeBalancesByCompany.

-- 1. Cash flow activity override (QuickBooks Desktop "Classify Cash" pattern).
--    NULL = derive from accountType at read time.
DO $$ BEGIN
  CREATE TYPE "cashFlowActivity" AS ENUM ('Operating', 'Investing', 'Financing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "account"
  ADD COLUMN IF NOT EXISTS "cashFlowActivity" "cashFlowActivity";

-- 2. Recreate the accounts view so the new column is exposed
--    (view is a plain SELECT *; see 20260229000003_chart-of-accounts-tree.sql)
DROP VIEW IF EXISTS "accounts";
CREATE VIEW "accounts" WITH(SECURITY_INVOKER=true) AS
SELECT * FROM "account";

-- 3. Saved report views — personal-preference table mirroring
--    userModulePreference (20260512174538_menu-customization.sql):
--    simple PK, owner-scoped RLS, (userId, companyId, report, name) unique.
--    No createdBy/updatedBy: ownership IS userId (matches precedent).
CREATE TABLE IF NOT EXISTS "reportView" (
  "id" TEXT NOT NULL DEFAULT id('rpv'),
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "report" TEXT NOT NULL CHECK ("report" IN
    ('balance-sheet', 'income-statement', 'cash-flow', 'trial-balance', 'general-ledger')),
  "name" TEXT NOT NULL,
  "params" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "reportView_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reportView_userId_companyId_report_name_key"
    UNIQUE ("userId", "companyId", "report", "name")
);

CREATE INDEX IF NOT EXISTS "reportView_userId_companyId_idx"
  ON "reportView" ("userId", "companyId");

ALTER TABLE "reportView" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "SELECT" ON "reportView"
    FOR SELECT USING ("userId" = auth.uid()::text);
  CREATE POLICY "INSERT" ON "reportView"
    FOR INSERT WITH CHECK ("userId" = auth.uid()::text);
  CREATE POLICY "UPDATE" ON "reportView"
    FOR UPDATE USING ("userId" = auth.uid()::text);
  CREATE POLICY "DELETE" ON "reportView"
    FOR DELETE USING ("userId" = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Four-column trial balance. Return shape changes, so DROP first
--    (CREATE OR REPLACE cannot change an OUT row type).
DROP FUNCTION IF EXISTS "trialBalance"(TEXT, TEXT, DATE, DATE);

CREATE FUNCTION "trialBalance" (
  p_company_group_id TEXT,
  p_company_id TEXT DEFAULT NULL,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "accountNumber" TEXT,
  "accountName" TEXT,
  "accountClass" "glAccountClass",
  "incomeBalance" "glIncomeBalance",
  "openingDebit" NUMERIC(19, 4),
  "openingCredit" NUMERIC(19, 4),
  "periodDebits" NUMERIC(19, 4),
  "periodCredits" NUMERIC(19, 4),
  "debitBalance" NUMERIC(19, 4),
  "creditBalance" NUMERIC(19, 4),
  "netChange" NUMERIC(19, 4)
)
LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH "movements" AS (
    -- Per-leaf period debit/credit sums. A line is a debit when its sign
    -- matches the account's natural-debit direction (class-normal signing).
    -- Draft journals are excluded (consistent with accountTreeBalancesByCompany
    -- per 20260711011724_exclude-draft-journals.sql).
    SELECT
      a."id" AS "mAccountId",
      COALESCE(SUM(
        CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date
          AND ((a."class" IN ('Asset', 'Expense') AND jl."amount" > 0)
            OR (a."class" IN ('Liability', 'Equity', 'Revenue') AND jl."amount" < 0))
        THEN ABS(jl."amount") ELSE 0 END), 0) AS "periodDebits",
      COALESCE(SUM(
        CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date
          AND ((a."class" IN ('Asset', 'Expense') AND jl."amount" < 0)
            OR (a."class" IN ('Liability', 'Equity', 'Revenue') AND jl."amount" > 0))
        THEN ABS(jl."amount") ELSE 0 END), 0) AS "periodCredits"
    FROM "account" a
    LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      AND (p_company_id IS NULL OR jl."companyId" = p_company_id)
    LEFT JOIN "journal" j ON j."id" = jl."journalId"
    WHERE a."companyGroupId" = p_company_group_id
      AND a."isGroup" = false
      AND a."active" = true
      AND (jl."id" IS NULL OR j."status" != 'Draft')
    GROUP BY a."id"
  )
  SELECT
    a."id" AS "accountId",
    a."number" AS "accountNumber",
    a."name" AS "accountName",
    a."class" AS "accountClass",
    a."incomeBalance",
    -- Opening = balanceAtDate − netChange, split by class direction
    CASE
      WHEN a."class" IN ('Asset', 'Expense') AND (b."balanceAtDate" - b."netChange") > 0 THEN (b."balanceAtDate" - b."netChange")
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND (b."balanceAtDate" - b."netChange") < 0 THEN ABS(b."balanceAtDate" - b."netChange")
      ELSE 0::NUMERIC(19, 4)
    END AS "openingDebit",
    CASE
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND (b."balanceAtDate" - b."netChange") >= 0 THEN (b."balanceAtDate" - b."netChange")
      WHEN a."class" IN ('Asset', 'Expense') AND (b."balanceAtDate" - b."netChange") < 0 THEN ABS(b."balanceAtDate" - b."netChange")
      ELSE 0::NUMERIC(19, 4)
    END AS "openingCredit",
    COALESCE(m."periodDebits", 0)::NUMERIC(19, 4) AS "periodDebits",
    COALESCE(m."periodCredits", 0)::NUMERIC(19, 4) AS "periodCredits",
    -- Closing (existing semantics, unchanged)
    CASE
      WHEN a."class" IN ('Asset', 'Expense') AND b."balanceAtDate" > 0 THEN b."balanceAtDate"
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND b."balanceAtDate" < 0 THEN ABS(b."balanceAtDate")
      ELSE 0::NUMERIC(19, 4)
    END AS "debitBalance",
    CASE
      WHEN a."class" IN ('Liability', 'Equity', 'Revenue') AND b."balanceAtDate" >= 0 THEN b."balanceAtDate"
      WHEN a."class" IN ('Asset', 'Expense') AND b."balanceAtDate" < 0 THEN ABS(b."balanceAtDate")
      ELSE 0::NUMERIC(19, 4)
    END AS "creditBalance",
    b."netChange"
  FROM "account" a
  INNER JOIN "accountTreeBalancesByCompany"(p_company_group_id, p_company_id, from_date, to_date) b
    ON b."accountId" = a."id"
  LEFT JOIN "movements" m ON m."mAccountId" = a."id"
  WHERE a."isGroup" = false
    AND a."companyGroupId" = p_company_group_id
    AND a."active" = true
    AND (b."balanceAtDate" != 0 OR b."netChange" != 0)
  ORDER BY a."number";
END;
$$;
