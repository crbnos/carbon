-- Account deactivation prevents future selection; posted history and period-close
-- snapshots must retain inactive leaves and ancestors. Preserve RPC permissions.


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
      WHERE a."companyGroupId" = p_company_group_id

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
        WHERE a."companyGroupId" = p_company_group_id

        UNION ALL

        SELECT
          child."id",
          t."rootId",
          child."isGroup"
        FROM "accountTree" t
        INNER JOIN "account" child ON child."parentId" = t."id"
        WHERE t."isGroup" = true
          AND child."companyGroupId" = p_company_group_id
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
      WHERE a."companyGroupId" = p_company_group_id

      UNION ALL

      SELECT
        child."id",
        t."rootId",
        child."isGroup"
      FROM "accountTree" t
      INNER JOIN "account" child ON child."parentId" = t."id"
      WHERE t."isGroup" = true
        AND child."companyGroupId" = p_company_group_id
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
    WHERE a."companyGroupId" = p_company_group_id

    UNION ALL

    SELECT
      child."id",
      t."rootId",
      child."isGroup"
    FROM "accountTree" t
    INNER JOIN "account" child ON child."parentId" = t."id"
    WHERE t."isGroup" = true
      AND child."companyGroupId" = p_company_group_id
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

CREATE OR REPLACE FUNCTION "snapshotAccountingPeriodBalances" (
  p_company_id TEXT,
  p_period_id TEXT,
  p_user_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_end_date DATE;
  v_close_status "periodCloseStatus";
BEGIN
  SELECT "endDate", "closeStatus" INTO v_end_date, v_close_status
  FROM "accountingPeriod"
  WHERE "id" = p_period_id AND "companyId" = p_company_id;

  IF v_end_date IS NULL THEN
    RAISE EXCEPTION 'Accounting period % not found for company %', p_period_id, p_company_id;
  END IF;

  -- Only Closed periods may hold a snapshot. A Closed period cannot receive new
  -- postings (the journal_check_period_open trigger from the period-close
  -- lifecycle blocks any journal whose postingDate lands in a closed period), so
  -- its cumulative balance is frozen and the snapshot can never go stale.
  -- closeAccountingPeriod flips the period to Closed inside its transaction
  -- before calling this, so the check passes for the intended caller; refusing
  -- anything else is defense-in-depth against writing a snapshot a later posting
  -- could invalidate.
  IF v_close_status IS DISTINCT FROM 'Closed' THEN
    RAISE EXCEPTION 'Cannot snapshot accounting period %: period is not Closed (closeStatus=%)',
      p_period_id, v_close_status;
  END IF;

  INSERT INTO "accountingPeriodBalance"
    ("companyId", "accountingPeriodId", "accountId", "endingBalance", "endingBalanceDate", "createdBy")
  SELECT
    p_company_id,
    p_period_id,
    a."id",
    COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" <= v_end_date
                      THEN jl."amount" ELSE 0 END), 0),
    v_end_date,
    p_user_id
  FROM "account" a
  LEFT JOIN "journalLine" jl ON jl."accountId" = a."id" AND jl."companyId" = p_company_id
  LEFT JOIN "journal" j ON j."id" = jl."journalId"
  WHERE a."isGroup" = false
    AND a."companyGroupId" = (SELECT "companyGroupId" FROM "company" WHERE "id" = p_company_id)
  GROUP BY a."id"
  ON CONFLICT ("accountId", "accountingPeriodId", "companyId")
  DO UPDATE SET
    "endingBalance" = EXCLUDED."endingBalance",
    "endingBalanceDate" = EXCLUDED."endingBalanceDate",
    "updatedBy" = p_user_id,
    "updatedAt" = NOW();
END;
$$;
