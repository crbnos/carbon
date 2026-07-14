-- Exclude Draft journal entries from all financial report aggregates.
-- Previously the balance RPCs and journalLines view included all journal
-- statuses (Draft, Posted, Reversed). Draft entries should not affect
-- the balance sheet, income statement, trial balance, or chart of accounts.

-- ============================================================
-- accountTreeBalances (chart of accounts)
-- Forked from 20260229000003_chart-of-accounts-tree.sql
-- ============================================================

CREATE OR REPLACE FUNCTION "accountTreeBalances" (
  p_company_group_id TEXT,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "balance" NUMERIC,
  "balanceAtDate" NUMERIC,
  "netChange" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    WITH RECURSIVE "accountTree" AS (
      SELECT
        a."id",
        a."id" AS "rootId",
        a."isGroup"
      FROM "account" a
      WHERE a."companyGroupId" = p_company_group_id AND a."active" = true

      UNION ALL

      SELECT
        child."id",
        t."rootId",
        child."isGroup"
      FROM "accountTree" t
      INNER JOIN "account" child ON child."parentId" = t."id"
      WHERE t."isGroup" = true
        AND child."companyGroupId" = p_company_group_id
        AND child."active" = true
    ),
    "leafBalances" AS (
      SELECT
        a."id" AS "accountId",
        COALESCE(SUM(jl."amount"), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."companyGroupId" = p_company_group_id
        AND a."isGroup" = false
        AND a."active" = true
        AND (jl."id" IS NULL OR j."status" != 'Draft')
      GROUP BY a."id"
    )
    SELECT
      t."rootId" AS "accountId",
      COALESCE(SUM(lb."balance"), 0)::NUMERIC AS "balance",
      COALESCE(SUM(lb."balanceAtDate"), 0)::NUMERIC AS "balanceAtDate",
      COALESCE(SUM(lb."netChange"), 0)::NUMERIC AS "netChange"
    FROM "accountTree" t
    LEFT JOIN "leafBalances" lb ON lb."accountId" = t."id" AND t."isGroup" = false
    GROUP BY t."rootId";
END;
$$;

-- ============================================================
-- accountTreeBalancesByCompany (balance sheet, income statement, trial balance)
-- Forked from 20260315000001_per-company-balance-rpc.sql
-- ============================================================

CREATE OR REPLACE FUNCTION "accountTreeBalancesByCompany" (
  p_company_group_id TEXT,
  p_company_id TEXT DEFAULT NULL,
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "accountId" TEXT,
  "balance" NUMERIC,
  "balanceAtDate" NUMERIC,
  "netChange" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    WITH RECURSIVE "accountTree" AS (
      SELECT
        a."id",
        a."id" AS "rootId",
        a."isGroup"
      FROM "account" a
      WHERE a."companyGroupId" = p_company_group_id AND a."active" = true

      UNION ALL

      SELECT
        child."id",
        t."rootId",
        child."isGroup"
      FROM "accountTree" t
      INNER JOIN "account" child ON child."parentId" = t."id"
      WHERE t."isGroup" = true
        AND child."companyGroupId" = p_company_group_id
        AND child."active" = true
    ),
    "leafBalances" AS (
      SELECT
        a."id" AS "accountId",
        COALESCE(SUM(jl."amount"), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
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
      t."rootId" AS "accountId",
      COALESCE(SUM(lb."balance"), 0)::NUMERIC AS "balance",
      COALESCE(SUM(lb."balanceAtDate"), 0)::NUMERIC AS "balanceAtDate",
      COALESCE(SUM(lb."netChange"), 0)::NUMERIC AS "netChange"
    FROM "accountTree" t
    LEFT JOIN "leafBalances" lb ON lb."accountId" = t."id" AND t."isGroup" = false
    GROUP BY t."rootId";
END;
$$;

-- ============================================================
-- journalLinesByAccountNumber (same fix for consistency)
-- Forked from 20260229000003_chart-of-accounts-tree.sql
-- ============================================================

DROP FUNCTION IF EXISTS "journalLinesByAccountNumber"(DATE, DATE);

CREATE OR REPLACE FUNCTION "journalLinesByAccountNumber" (
  from_date DATE DEFAULT (now() - INTERVAL '100 year'),
  to_date DATE DEFAULT now()
)
RETURNS TABLE (
  "number" TEXT,
  "companyGroupId" TEXT,
  "balance" NUMERIC,
  "balanceAtDate" NUMERIC,
  "netChange" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
  BEGIN
    RETURN QUERY
      SELECT
        a."number",
        a."companyGroupId",
        COALESCE(SUM(jl."amount"), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."isGroup" = false
        AND (jl."id" IS NULL OR j."status" != 'Draft')
      GROUP BY a."number", a."companyGroupId";
  END;
$$;

-- ============================================================
-- journalLines view (account ledger drill-down)
-- Forked from 20260702122210_journal-lines-view.sql
-- Exclude Draft entries so the drill-down ties out with the reports.
-- ============================================================

DROP VIEW IF EXISTS "journalLines";

CREATE VIEW "journalLines" WITH(SECURITY_INVOKER=true) AS
SELECT
  jl.*,
  j."postingDate",
  j."journalEntryId",
  j."status",
  j."sourceType",
  j."description" AS "journalDescription"
FROM "journalLine" jl
JOIN "journal" j ON j."id" = jl."journalId"
WHERE j."status" != 'Draft';
