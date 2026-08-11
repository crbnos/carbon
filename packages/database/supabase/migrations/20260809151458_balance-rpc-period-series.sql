-- ============================================================
-- accountTreeBalancePeriodSeries: multi-period balances in one scan.
--
-- Powers the /x/reports balance sheet + income statement comparison
-- columns (Monthly / Quarterly / Yearly). For each bucket end date it
-- returns the cumulative balance through that date and the net change
-- since the previous bucket (the first bucket's baseline is the day
-- before p_start), rolled up to every account via the same recursive
-- accountTree CTE as accountTreeBalancesByCompany.
--
-- Builds on the accountingPeriodBalance snapshots (20260713232634):
-- the base is the newest snapshot strictly BEFORE p_start, and the only
-- journal scan is the bounded window (base, max(p_period_ends)]. Unlike
-- accountTreeBalancesByCompany there is a single uniform branch — with
-- no snapshots the base COALESCEs to zero at DATE '0001-01-01' and the
-- scan degrades to full history, which is exactly the pre-snapshot
-- behavior. Draft journals are excluded, matching the sibling RPCs.
--
-- CONTRACT (enforced by computeReportPeriodBuckets in @carbon/utils,
-- the only producer of p_period_ends):
--   * p_period_ends is sorted ascending, distinct, and every element
--     is >= p_start. Lines are bucketed to the FIRST period end >= their
--     postingDate, so unsorted/overlapping inputs would misassign.
--   * p_company_id is required — consolidation callers loop companies.
--
-- ⚠ KEEP IN SYNC: the "accountTree" recursive CTE below is copied
-- verbatim from accountTreeBalancesByCompany
-- (20260713233919_balance-rpc-snapshot-delta.sql). If account-tree
-- construction or the root rollup changes there, change it here too.
--
-- Perf note: the per-line bucket assignment is a correlated MIN(ord)
-- against the unnested p_period_ends (≤ 60 elements, capped by the TS
-- helper); delta lines are snapshot-bounded, so this stays cheap.
-- ============================================================

CREATE OR REPLACE FUNCTION "accountTreeBalancePeriodSeries" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_start DATE,
  p_period_ends DATE[]
)
RETURNS TABLE (
  "accountId" TEXT,
  "periodEnd" DATE,
  "balanceAtDate" NUMERIC,
  "netChange" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_base_date DATE;   -- newest snapshot strictly before p_start (NULL => no snapshots)
  v_last_end DATE;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'accountTreeBalancePeriodSeries requires p_company_id';
  END IF;
  IF p_period_ends IS NULL OR array_length(p_period_ends, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT MAX(pe) INTO v_last_end FROM unnest(p_period_ends) pe;

  SELECT MAX("endingBalanceDate") INTO v_base_date
  FROM "accountingPeriodBalance"
  WHERE "companyId" = p_company_id AND "endingBalanceDate" < p_start;

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
  "periods" AS (
    SELECT pe AS "periodEnd", ord
    FROM unnest(p_period_ends) WITH ORDINALITY AS u(pe, ord)
  ),
  -- The one bounded journal scan: (base snapshot, last bucket end]
  "deltaLines" AS (
    SELECT jl."accountId", jl."amount", j."postingDate"
    FROM "journal" j
    INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
    WHERE j."companyId" = p_company_id
      AND jl."companyId" = p_company_id
      AND j."status" <> 'Draft'
      AND j."postingDate" > COALESCE(v_base_date, DATE '0001-01-01')
      AND j."postingDate" <= v_last_end
  ),
  -- ord 0 = the pre-range sliver (base snapshot .. day before p_start):
  -- the opening anchor that the first bucket's netChange subtracts.
  "bucketSums" AS (
    SELECT
      dl."accountId",
      CASE WHEN dl."postingDate" < p_start THEN 0::BIGINT
           ELSE (SELECT MIN(p.ord) FROM "periods" p WHERE p."periodEnd" >= dl."postingDate")
      END AS ord,
      SUM(dl."amount") AS "delta"
    FROM "deltaLines" dl
    GROUP BY dl."accountId", 2
  ),
  "base" AS (
    SELECT s."accountId", s."endingBalance"
    FROM "accountingPeriodBalance" s
    WHERE s."companyId" = p_company_id AND s."endingBalanceDate" = v_base_date
  ),
  "leafGrid" AS (
    SELECT a."id" AS "accountId", g.ord, g."periodEnd"
    FROM "account" a
    CROSS JOIN (
      SELECT 0::BIGINT AS ord, NULL::DATE AS "periodEnd"
      UNION ALL
      -- qualify: "periodEnd" is also a RETURNS TABLE out-param name
      SELECT p2.ord, p2."periodEnd" FROM "periods" p2
    ) g
    WHERE a."companyGroupId" = p_company_group_id
      AND a."isGroup" = false
      AND a."active" = true
  ),
  "leafSeries" AS (
    SELECT
      lg."accountId", lg.ord, lg."periodEnd",
      COALESCE(b."endingBalance", 0)
        + SUM(COALESCE(bs."delta", 0))
            OVER (PARTITION BY lg."accountId" ORDER BY lg.ord) AS "balanceAtDate"
    FROM "leafGrid" lg
    LEFT JOIN "bucketSums" bs ON bs."accountId" = lg."accountId" AND bs.ord = lg.ord
    LEFT JOIN "base" b ON b."accountId" = lg."accountId"
  ),
  -- Filter ord 0 AFTER the window so LAG sees the opening row.
  "leafWithChange" AS (
    SELECT * FROM (
      SELECT
        ls."accountId", ls.ord, ls."periodEnd", ls."balanceAtDate",
        ls."balanceAtDate"
          - LAG(ls."balanceAtDate") OVER (PARTITION BY ls."accountId" ORDER BY ls.ord)
          AS "netChange"
      FROM "leafSeries" ls
    ) x
    WHERE x.ord > 0
  )
  SELECT
    t."rootId" AS "accountId",
    p."periodEnd",
    COALESCE(SUM(lw."balanceAtDate"), 0)::NUMERIC AS "balanceAtDate",
    COALESCE(SUM(lw."netChange"), 0)::NUMERIC AS "netChange"
  FROM "accountTree" t
  CROSS JOIN "periods" p
  LEFT JOIN "leafWithChange" lw
    ON lw."accountId" = t."id"
   AND lw."periodEnd" = p."periodEnd"
   AND t."isGroup" = false
  GROUP BY t."rootId", p."periodEnd";
END;
$$;
