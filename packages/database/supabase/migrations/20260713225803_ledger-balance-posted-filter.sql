-- ============================================================
-- 1. Exclude Draft journals from financial statement balances.
--
-- accountTreeBalancesByCompany / accountTreeBalances /
-- journalLinesByAccountNumber summed every journalLine regardless of
-- journal.status, so unposted Draft journal entries leaked into the trial
-- balance, balance sheet, and income statement. Reversed journals still
-- count: a reversal keeps the original entry on the books and offsets it
-- with the reversing entry, so excluding them would unbalance the ledger.
--
-- Forked from the latest definitions:
--   accountTreeBalancesByCompany / trialBalance → 20260315000001_per-company-balance-rpc.sql
--   accountTreeBalances / journalLinesByAccountNumber → 20260229000003_chart-of-accounts-tree.sql
-- Signatures and return types are unchanged (CREATE OR REPLACE is safe);
-- only the SUM expressions gained the status gate.
--
-- 2. getConsolidationRates: rate lookups for currency translation, extracted
-- from translateTrialBalance so the app can translate already-computed
-- balances in one pass instead of re-scanning journalLine per company.
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
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' THEN jl."amount" ELSE 0 END), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
        AND (p_company_id IS NULL OR jl."companyId" = p_company_id)
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."companyGroupId" = p_company_group_id
        AND a."isGroup" = false
        AND a."active" = true
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
      -- Base case: all accounts in the company group
      SELECT
        a."id",
        a."id" AS "rootId",
        a."isGroup"
      FROM "account" a
      WHERE a."companyGroupId" = p_company_group_id AND a."active" = true

      UNION ALL

      -- Recursive case: for group accounts, include all descendants
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
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' THEN jl."amount" ELSE 0 END), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."companyGroupId" = p_company_group_id
        AND a."isGroup" = false
        AND a."active" = true
      GROUP BY a."id"
    )
    -- For each account, sum up all descendant leaf balances
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
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' THEN jl."amount" ELSE 0 END), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."isGroup" = false
      GROUP BY a."number", a."companyGroupId";
  END;
$$;

-- Rate lookups for currency translation, extracted verbatim from
-- translateTrialBalance (20260315000002_exchange-rate-history.sql). Returns a
-- single row; no ledger access. The app multiplies already-computed
-- balanceAtDate values by the rate matching each account's consolidatedRate,
-- which replaces the translateTrialBalance call (and its second full
-- journalLine scan per company) in the statement/consolidation loaders.
CREATE OR REPLACE FUNCTION "getConsolidationRates" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_period_end DATE,
  p_period_start DATE DEFAULT NULL
)
RETURNS TABLE (
  "sourceCurrency" TEXT,
  "closingRate" NUMERIC,
  "averageRate" NUMERIC,
  "historicalRate" NUMERIC
)
LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_source_currency TEXT;
  v_closing_rate NUMERIC;
  v_average_rate NUMERIC;
  v_historical_rate NUMERIC;
BEGIN
  SELECT "baseCurrencyCode" INTO v_source_currency
  FROM "company" WHERE "id" = p_company_id;

  -- Closing rate: latest daily rate on or before period end
  SELECT "rate" INTO v_closing_rate
  FROM "exchangeRateHistory"
  WHERE "currencyCode" = v_source_currency
    AND "companyGroupId" = p_company_group_id
    AND "effectiveDate" <= p_period_end
  ORDER BY "effectiveDate" DESC LIMIT 1;

  -- Average rate: mean of daily rates over the period
  SELECT AVG("rate") INTO v_average_rate
  FROM "exchangeRateHistory"
  WHERE "currencyCode" = v_source_currency
    AND "companyGroupId" = p_company_group_id
    AND "effectiveDate" >= COALESCE(p_period_start, p_period_end - INTERVAL '1 year')
    AND "effectiveDate" <= p_period_end;

  -- Historical rate: from currency table (manually set for equity)
  SELECT "historicalExchangeRate" INTO v_historical_rate
  FROM "currency"
  WHERE "code" = v_source_currency
    AND "companyGroupId" = p_company_group_id;

  -- Defaults: average falls back to closing, historical falls back to closing, all fall back to 1
  v_average_rate := COALESCE(v_average_rate, v_closing_rate, 1);
  v_historical_rate := COALESCE(v_historical_rate, v_closing_rate, 1);
  v_closing_rate := COALESCE(v_closing_rate, 1);

  RETURN QUERY
  SELECT v_source_currency, v_closing_rate, v_average_rate, v_historical_rate;
END;
$$;
