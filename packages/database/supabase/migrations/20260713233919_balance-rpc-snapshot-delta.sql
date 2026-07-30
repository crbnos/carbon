-- ============================================================
-- accountTreeBalancesByCompany: snapshot + delta.
--
-- Forked from 20260713225803_ledger-balance-posted-filter.sql. Same signature
-- and return type; trialBalance / translateTrialBalance inherit automatically.
--
-- When the company has accountingPeriodBalance snapshots, each balance is
-- "cumulative snapshot + SUM(journal lines after the snapshot date)", so the
-- journalLine scan is bounded by the open period(s) instead of all history:
--   balance        = latest snapshot        + lines after it
--   balanceAtDate  = latest snapshot <= to_date + lines in (snapshot, to_date]
--   netChange      = balanceAtDate(to_date)
--                  - (latest snapshot < from_date + lines in (snapshot, from_date))
--
-- Snapshot dates are per-company scalars (every account snapshots at the same
-- period endDate), so the delta join prunes on journal(companyId, postingDate)
-- with two bounded ranges. Companies with no snapshots (or group-wide calls
-- with p_company_id NULL) take the identical full-scan body as before — no
-- behavior change until a period-close flow writes snapshots.
--
-- accountTreeBalances (group-wide, chart of accounts) intentionally stays on
-- the full scan: snapshots are per company.
--
-- ⚠ KEEP IN SYNC: the two RETURN QUERY branches below (full-scan when there is
-- no snapshot; snapshot+delta otherwise) share an IDENTICAL "accountTree"
-- recursive CTE and an IDENTICAL final rollup (SUM by rootId). Only the
-- "leafBalances" CTE differs — full-scan sums all history, snapshot+delta reads
-- "snapshot + bounded delta". If you change account-tree construction or the
-- root aggregation, change BOTH branches or they will disagree. The two branches
-- MUST return identical results whenever snapshots are present (proven manually
-- via a seed-both-ways psql diff). Collapsing them into one query with
-- COALESCE-floored bounds is possible but is deferred until there is an
-- automated (pgTAP) equivalence gate — do not hand-merge money-path SQL blind.
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
DECLARE
  v_latest_date DATE;   -- newest snapshot (for `balance`, which is unbounded)
  v_at_date DATE;       -- newest snapshot <= to_date (for balanceAtDate)
  v_before_from DATE;   -- newest snapshot < from_date (for netChange's lower bound)
BEGIN
  IF p_company_id IS NOT NULL THEN
    SELECT MAX("endingBalanceDate") INTO v_latest_date
    FROM "accountingPeriodBalance"
    WHERE "companyId" = p_company_id;

    SELECT MAX("endingBalanceDate") INTO v_at_date
    FROM "accountingPeriodBalance"
    WHERE "companyId" = p_company_id AND "endingBalanceDate" <= to_date;

    SELECT MAX("endingBalanceDate") INTO v_before_from
    FROM "accountingPeriodBalance"
    WHERE "companyId" = p_company_id AND "endingBalanceDate" < from_date;
  END IF;

  IF v_latest_date IS NULL THEN
    -- No snapshots for this company (or group-wide call): full-history scan,
    -- identical to the 20260713225803 definition.
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
    RETURN;
  END IF;

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
    -- Only the lines the snapshots don't already cover: after the newest
    -- snapshot each term uses, plus (for netChange's lower bound) the sliver
    -- between its snapshot and from_date. Both are bounded postingDate ranges
    -- served by journal_companyId_postingDate_idx.
    "deltaLines" AS (
      SELECT jl."accountId", jl."amount", j."postingDate"
      FROM "journal" j
      INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
      WHERE j."companyId" = p_company_id
        AND jl."companyId" = p_company_id
        AND j."status" <> 'Draft'
        AND (
          j."postingDate" > LEAST(v_latest_date, COALESCE(v_at_date, DATE '0001-01-01'))
          OR (j."postingDate" < from_date
              AND j."postingDate" > COALESCE(v_before_from, DATE '0001-01-01'))
        )
    ),
    "leafBalances" AS (
      SELECT
        a."id" AS "accountId",
        COALESCE(sl."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN dl."postingDate" > v_latest_date
                              THEN dl."amount" ELSE 0 END), 0) AS "balance",
        COALESCE(sa."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN dl."postingDate" > COALESCE(v_at_date, DATE '0001-01-01')
                              AND dl."postingDate" <= to_date
                              THEN dl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        (COALESCE(sa."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN dl."postingDate" > COALESCE(v_at_date, DATE '0001-01-01')
                              AND dl."postingDate" <= to_date
                              THEN dl."amount" ELSE 0 END), 0))
        - (COALESCE(sb."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN dl."postingDate" > COALESCE(v_before_from, DATE '0001-01-01')
                              AND dl."postingDate" < from_date
                              THEN dl."amount" ELSE 0 END), 0)) AS "netChange"
      FROM "account" a
      LEFT JOIN "accountingPeriodBalance" sl ON sl."accountId" = a."id"
        AND sl."companyId" = p_company_id AND sl."endingBalanceDate" = v_latest_date
      LEFT JOIN "accountingPeriodBalance" sa ON sa."accountId" = a."id"
        AND sa."companyId" = p_company_id AND sa."endingBalanceDate" = v_at_date
      LEFT JOIN "accountingPeriodBalance" sb ON sb."accountId" = a."id"
        AND sb."companyId" = p_company_id AND sb."endingBalanceDate" = v_before_from
      LEFT JOIN "deltaLines" dl ON dl."accountId" = a."id"
      WHERE a."companyGroupId" = p_company_group_id
        AND a."isGroup" = false
        AND a."active" = true
      GROUP BY a."id", sl."endingBalance", sa."endingBalance", sb."endingBalance"
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
