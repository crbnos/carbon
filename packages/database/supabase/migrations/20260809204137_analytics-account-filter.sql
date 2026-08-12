-- ============================================================
-- Analytics pivot: optional per-report account filter.
--
-- Adds p_filter_account_ids to journalDimensionPivot and
-- journalDimensionPivotLines. It is ANDed on top of the base account
-- scope (classes / types / ids): the base scope defines the account
-- universe of a report, and p_filter_account_ids narrows WITHIN it to a
-- user-picked subset. NULL/empty leaves the report unfiltered.
--
-- Also retires the 'cogs' analytics report (folded into the generic
-- reports): drop any saved views / pins that referenced it.
--
-- Fork of 20260809184714_dimensional-pivot-reporting.sql — the two
-- function bodies are unchanged except for the new parameter and the
-- single AND clause in each account-scope predicate.
-- ============================================================

DROP FUNCTION IF EXISTS "journalDimensionPivot";
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
      AND j."status" <> 'Draft'
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

DROP FUNCTION IF EXISTS "journalDimensionPivotLines";
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
    AND j."status" <> 'Draft'
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

-- Retire the 'cogs' analytics report: remove its saved views and pins.
DELETE FROM "reportView" WHERE "reportKey" = 'cogs';
DELETE FROM "reportPin" WHERE "reportKey" = 'cogs';
