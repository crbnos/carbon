-- GL readers count only Posted and Reversed journals
-- (.ai/specs/2026-10-08-accounting-cutover.md section 2).
--
-- Each of these read `status <> 'Draft'`, which counted every non-Draft
-- journal. With Provisional (before the cutover) and Superseded (after it)
-- that would put journals that never count into balances, snapshots,
-- analytics and the inventory tie-out. IN ('Posted', 'Reversed') is the same
-- set as before for the 3 statuses that existed. Each function is copied
-- from its latest definition with only that filter changed; each keeps its
-- security mode (snapshotAccountingPeriodBalances was made SECURITY INVOKER
-- by 20260925121735).

-- accountTreeBalances
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
        COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') THEN jl."amount" ELSE 0 END), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') AND j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
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

-- accountTreeBalancesByCompany
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
          COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') THEN jl."amount" ELSE 0 END), 0) AS "balance",
          COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
          COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') AND j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
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
        AND j."status" IN ('Posted', 'Reversed')
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

-- accountTreeBalancePeriodSeries
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
      AND j."status" IN ('Posted', 'Reversed')
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

-- snapshotAccountingPeriodBalances
CREATE OR REPLACE FUNCTION "snapshotAccountingPeriodBalances" (
  p_company_id TEXT,
  p_period_id TEXT,
  p_user_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
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
    COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') AND j."postingDate" <= v_end_date
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

-- journalLinesByAccountNumber
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
        COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') THEN jl."amount" ELSE 0 END), 0) AS "balance",
        COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        COALESCE(SUM(CASE WHEN j."status" IN ('Posted', 'Reversed') AND j."postingDate" >= from_date AND j."postingDate" <= to_date THEN jl."amount" ELSE 0 END), 0) AS "netChange"
      FROM "account" a
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."isGroup" = false
      GROUP BY a."number", a."companyGroupId";
  END;
$$;

-- journalDimensionPivot
CREATE OR REPLACE FUNCTION "journalDimensionPivot" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_start DATE,
  p_end DATE,
  p_account_classes TEXT[] DEFAULT NULL,
  p_account_types TEXT[] DEFAULT NULL,
  p_account_ids TEXT[] DEFAULT NULL,
  p_row_dimension_1 TEXT DEFAULT NULL,
  p_row_dimension_2 TEXT DEFAULT NULL,
  p_column_dimension TEXT DEFAULT NULL,
  p_period_ends DATE[] DEFAULT NULL,
  p_filters JSONB DEFAULT NULL,
  p_group_limit INT DEFAULT 1000,
  p_filter_account_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  "rowValue1Id" TEXT,
  "rowValue2Id" TEXT,
  "columnKey" TEXT,
  "amount" NUMERIC,
  "quantity" NUMERIC,
  "lineCount" BIGINT,
  "hasMore" BOOLEAN
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'journalDimensionPivot requires p_company_id';
  END IF;
  IF p_account_classes IS NULL AND p_account_types IS NULL AND p_account_ids IS NULL THEN
    RAISE EXCEPTION 'journalDimensionPivot requires an account scope';
  END IF;
  IF p_column_dimension IS NOT NULL AND p_period_ends IS NOT NULL THEN
    RAISE EXCEPTION 'journalDimensionPivot: column axis is a dimension OR period ends, not both';
  END IF;

  RETURN QUERY
  WITH "scopedLines" AS (
    SELECT jl."id" AS "lineId", jl."amount" AS "lineAmount",
           COALESCE(jl."quantity", 0) AS "lineQuantity", j."postingDate"
    FROM "journal" j
    INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
    INNER JOIN "account" a
      ON a."id" = jl."accountId" AND a."companyGroupId" = p_company_group_id
    WHERE j."companyId" = p_company_id
      AND jl."companyId" = p_company_id
      AND j."status" IN ('Posted', 'Reversed')
      AND j."postingDate" >= p_start
      AND j."postingDate" <= p_end
      AND (
        (p_account_ids IS NOT NULL AND jl."accountId" = ANY(p_account_ids))
        OR (p_account_types IS NOT NULL AND a."accountType"::TEXT = ANY(p_account_types))
        OR (p_account_classes IS NOT NULL AND a."class"::TEXT = ANY(p_account_classes))
      )
      AND (p_filter_account_ids IS NULL OR jl."accountId" = ANY(p_filter_account_ids))
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb)) AS f
        WHERE NOT EXISTS (
          SELECT 1 FROM "journalLineDimension" fd
          WHERE fd."journalLineId" = jl."id"
            AND fd."companyId" = p_company_id
            AND fd."dimensionId" = f->>'dimensionId'
            AND fd."valueId" IN (SELECT jsonb_array_elements_text(f->'valueIds'))
        )
      )
  ),
  "taggedLines" AS (
    SELECT
      sl."lineId", sl."lineAmount", sl."lineQuantity",
      d1."valueId" AS "r1",
      d2."valueId" AS "r2",
      CASE
        WHEN p_column_dimension IS NOT NULL THEN dc."valueId"
        WHEN p_period_ends IS NOT NULL THEN (
          SELECT MIN(pe)::TEXT FROM unnest(p_period_ends) pe
          WHERE pe >= sl."postingDate"
        )
        ELSE 'total'
      END AS "colKey"
    FROM "scopedLines" sl
    LEFT JOIN "journalLineDimension" d1
      ON p_row_dimension_1 IS NOT NULL
      AND d1."journalLineId" = sl."lineId"
      AND d1."companyId" = p_company_id
      AND d1."dimensionId" = p_row_dimension_1
    LEFT JOIN "journalLineDimension" d2
      ON p_row_dimension_2 IS NOT NULL
      AND d2."journalLineId" = sl."lineId"
      AND d2."companyId" = p_company_id
      AND d2."dimensionId" = p_row_dimension_2
    LEFT JOIN "journalLineDimension" dc
      ON p_column_dimension IS NOT NULL
      AND dc."journalLineId" = sl."lineId"
      AND dc."companyId" = p_company_id
      AND dc."dimensionId" = p_column_dimension
  ),
  "rowGroups" AS (
    SELECT tl."r1", tl."r2",
           ROW_NUMBER() OVER (ORDER BY ABS(SUM(tl."lineAmount")) DESC NULLS LAST) AS rn,
           COUNT(*) OVER () AS "totalGroups"
    FROM "taggedLines" tl
    GROUP BY tl."r1", tl."r2"
  ),
  "keptGroups" AS (
    SELECT rg."r1", rg."r2", rg."totalGroups"
    FROM "rowGroups" rg
    WHERE rg.rn <= p_group_limit
  )
  SELECT
    tl."r1" AS "rowValue1Id",
    tl."r2" AS "rowValue2Id",
    tl."colKey" AS "columnKey",
    SUM(tl."lineAmount") AS "amount",
    SUM(tl."lineQuantity") AS "quantity",
    COUNT(*)::BIGINT AS "lineCount",
    (SELECT COALESCE(MAX(kg2."totalGroups"), 0) FROM "keptGroups" kg2) > p_group_limit AS "hasMore"
  FROM "taggedLines" tl
  INNER JOIN "keptGroups" kg
    ON kg."r1" IS NOT DISTINCT FROM tl."r1"
    AND kg."r2" IS NOT DISTINCT FROM tl."r2"
  GROUP BY tl."r1", tl."r2", tl."colKey";
END;
$$;

-- journalDimensionPivotLines
CREATE OR REPLACE FUNCTION "journalDimensionPivotLines" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_start DATE,
  p_end DATE,
  p_account_classes TEXT[] DEFAULT NULL,
  p_account_types TEXT[] DEFAULT NULL,
  p_account_ids TEXT[] DEFAULT NULL,
  p_filters JSONB DEFAULT NULL,
  p_row_dimension_1 TEXT DEFAULT NULL,
  p_row_value_1 TEXT DEFAULT NULL,
  p_row_dimension_2 TEXT DEFAULT NULL,
  p_row_value_2 TEXT DEFAULT NULL,
  p_column_dimension TEXT DEFAULT NULL,
  p_column_value TEXT DEFAULT NULL,
  p_column_period_start DATE DEFAULT NULL,
  p_column_period_end DATE DEFAULT NULL,
  p_line_limit INT DEFAULT 500,
  p_filter_account_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  "id" TEXT,
  "postingDate" DATE,
  "journalEntryId" TEXT,
  "accountId" TEXT,
  "accountName" TEXT,
  "accountNumber" TEXT,
  "description" TEXT,
  "documentType" TEXT,
  "documentId" TEXT,
  "amount" NUMERIC,
  "quantity" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jl."id",
    j."postingDate",
    j."journalEntryId"::TEXT,
    jl."accountId",
    a."name" AS "accountName",
    a."number" AS "accountNumber",
    jl."description",
    jl."documentType"::TEXT,
    jl."documentId",
    jl."amount",
    COALESCE(jl."quantity", 0) AS "quantity"
  FROM "journal" j
  INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
  INNER JOIN "account" a
    ON a."id" = jl."accountId" AND a."companyGroupId" = p_company_group_id
  WHERE j."companyId" = p_company_id
    AND jl."companyId" = p_company_id
    AND j."status" IN ('Posted', 'Reversed')
    AND j."postingDate" >= COALESCE(p_column_period_start, p_start)
    AND j."postingDate" <= COALESCE(p_column_period_end, p_end)
    AND (
      (p_account_ids IS NOT NULL AND jl."accountId" = ANY(p_account_ids))
      OR (p_account_types IS NOT NULL AND a."accountType"::TEXT = ANY(p_account_types))
      OR (p_account_classes IS NOT NULL AND a."class"::TEXT = ANY(p_account_classes))
    )
    AND (p_filter_account_ids IS NULL OR jl."accountId" = ANY(p_filter_account_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb)) AS f
      WHERE NOT EXISTS (
        SELECT 1 FROM "journalLineDimension" fd
        WHERE fd."journalLineId" = jl."id"
          AND fd."companyId" = p_company_id
          AND fd."dimensionId" = f->>'dimensionId'
          AND fd."valueId" IN (SELECT jsonb_array_elements_text(f->'valueIds'))
      )
    )
    AND (
      p_row_dimension_1 IS NULL
      OR (p_row_value_1 IS NULL AND NOT EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_1))
      OR (p_row_value_1 IS NOT NULL AND EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_1 AND d."valueId" = p_row_value_1))
    )
    AND (
      p_row_dimension_2 IS NULL
      OR (p_row_value_2 IS NULL AND NOT EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_2))
      OR (p_row_value_2 IS NOT NULL AND EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_row_dimension_2 AND d."valueId" = p_row_value_2))
    )
    AND (
      p_column_dimension IS NULL
      OR (p_column_value IS NULL AND NOT EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_column_dimension))
      OR (p_column_value IS NOT NULL AND EXISTS (
            SELECT 1 FROM "journalLineDimension" d
            WHERE d."journalLineId" = jl."id" AND d."companyId" = p_company_id
              AND d."dimensionId" = p_column_dimension AND d."valueId" = p_column_value))
    )
  ORDER BY j."postingDate", jl."id"
  LIMIT p_line_limit;
END;
$$;

-- get_inventory_tie_out
CREATE OR REPLACE FUNCTION public.get_inventory_tie_out(company_id text, as_of_date date DEFAULT NULL::date)
 RETURNS TABLE("accountKind" text, "accountId" text, "accountName" text, "subledgerValue" numeric, "glBalance" numeric, variance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_as_of DATE := COALESCE(as_of_date, CURRENT_DATE);
  v_rm_account TEXT;
  v_fg_account TEXT;
BEGIN
  PERFORM assert_company_access(company_id);

  SELECT ad."rawMaterialsAccount", ad."finishedGoodsAccount"
  INTO v_rm_account, v_fg_account
  FROM "accountDefault" ad
  WHERE ad."companyId" = company_id;

  IF v_rm_account IS NULL OR v_fg_account IS NULL THEN
    RETURN; -- company has no account defaults (accounting never configured)
  END IF;

  RETURN QUERY
  WITH subledger AS (
    SELECT
      CASE WHEN v."replenishmentSystem" IN ('Make', 'Buy and Make')
           THEN 'finishedGoods' ELSE 'rawMaterials' END AS "kind",
      SUM(v."totalValue") AS "value"
    FROM get_inventory_valuation(company_id, as_of_date, NULL) v
    GROUP BY 1
  ),
  gl AS (
    SELECT jl."accountId" AS "account", SUM(jl."amount") AS "balance"
    FROM "journal" j
    INNER JOIN "journalLine" jl
      ON jl."journalId" = j."id" AND jl."companyId" = j."companyId"
    WHERE j."companyId" = company_id
      AND j."status" IN ('Posted', 'Reversed')
      AND j."postingDate" <= v_as_of
      AND jl."accountId" IN (v_rm_account, v_fg_account)
    GROUP BY jl."accountId"
  ),
  accounts AS (
    SELECT 'rawMaterials' AS "kind", v_rm_account AS "account"
    UNION ALL
    SELECT 'finishedGoods' AS "kind", v_fg_account AS "account"
  )
  SELECT
    a."kind" AS "accountKind",
    a."account" AS "accountId",
    acc."name" AS "accountName",
    COALESCE(s."value", 0) AS "subledgerValue",
    COALESCE(g."balance", 0) AS "glBalance",
    COALESCE(s."value", 0) - COALESCE(g."balance", 0) AS "variance"
  -- account is companyGroup-scoped (no companyId); the ids come from the
  -- company-scoped accountDefault row, so joining by id alone is correct.
  FROM accounts a
  LEFT JOIN "account" acc ON acc."id" = a."account"
  LEFT JOIN subledger s ON s."kind" = a."kind"
  LEFT JOIN gl g ON g."account" = a."account"
  ORDER BY a."kind" DESC; -- rawMaterials first
END;
$function$;

-- journalLines: the same filter. A plain view, so drop and recreate it.
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
WHERE j."status" IN ('Posted', 'Reversed');
