-- ============================================================
-- Dimensional pivot reporting (spec: .ai/specs/2026-08-09-dimensional-pivot-reporting.md)
--
-- 1. reportView: named, shareable saved pivot views for the generic
--    analytics reports (revenue / expenses / cogs / inventory-change /
--    scrap). Visibility 'Company' shares read-only with every employee
--    of the company; writes stay owner-only.
-- 2. journalDimensionPivot: the aggregation path the account-only
--    balance RPCs never had — GROUP BY up to two row dimensions plus a
--    column axis (a dimension OR period buckets) over the dimension
--    tags in journalLineDimension.
-- 3. journalDimensionPivotLines: the drill-through behind a pivot cell.
-- 4. reportPin key migration for the two hardcoded analytics reports
--    replaced by generic-report presets.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reportViewVisibility') THEN
    CREATE TYPE "reportViewVisibility" AS ENUM ('Private', 'Company');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "reportView" (
    "id" TEXT NOT NULL DEFAULT id('rv'),
    "companyId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "visibility" "reportViewVisibility" NOT NULL DEFAULT 'Private',
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "reportView_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "reportView_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reportView_name_unique" UNIQUE ("companyId", "reportKey", "name")
);

CREATE INDEX IF NOT EXISTS "reportView_companyId_idx" ON "reportView" ("companyId");
CREATE INDEX IF NOT EXISTS "reportView_createdBy_idx" ON "reportView" ("createdBy");

ALTER TABLE "reportView" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "reportView";
CREATE POLICY "SELECT" ON "reportView" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND ("visibility" = 'Company' OR "createdBy" = (SELECT auth.uid())::text)
);
DROP POLICY IF EXISTS "INSERT" ON "reportView";
CREATE POLICY "INSERT" ON "reportView" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
DROP POLICY IF EXISTS "UPDATE" ON "reportView";
CREATE POLICY "UPDATE" ON "reportView" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);
DROP POLICY IF EXISTS "DELETE" ON "reportView";
CREATE POLICY "DELETE" ON "reportView" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  AND "createdBy" = (SELECT auth.uid())::text
);

-- Aggregation indexes: the per-line dimension joins want
-- (journalLineId, dimensionId); the filter-side EXISTS probes and any
-- future value-first scans want the company-scoped composite.
CREATE INDEX IF NOT EXISTS "journalLineDimension_line_dimension_idx"
  ON "journalLineDimension" ("journalLineId", "dimensionId");
CREATE INDEX IF NOT EXISTS "journalLineDimension_company_dimension_value_idx"
  ON "journalLineDimension" ("companyId", "dimensionId", "valueId", "journalLineId");

-- ============================================================
-- journalDimensionPivot: GROUP BY dimension tags over a scoped slice
-- of the posted journal.
--
-- CONTRACT (enforced by getDimensionPivot in accounting.service.ts,
-- the only caller):
--   * Exactly one account-scope param (classes / types / ids) is
--     non-null; classes and types are enum values passed as TEXT.
--   * p_period_ends comes from computeReportPeriodBuckets (@carbon/utils):
--     sorted ascending, distinct, max(p_period_ends) == p_end. Lines
--     bucket to the FIRST period end >= postingDate.
--   * p_column_dimension and p_period_ends are mutually exclusive;
--     with neither, columnKey is the literal 'total'.
--   * p_filters: [{"dimensionId": text, "valueIds": [text]}] — every
--     entry must match (AND across filters, OR within valueIds).
--   * NULL rowValue1Id/rowValue2Id/columnKey = the Unassigned bucket
--     (line carries no tag for that dimension).
--   * Row groups are capped at p_group_limit by ABS(SUM(amount)) DESC;
--     hasMore reports whether groups were dropped. The app re-sorts —
--     callers must never rely on result ordering (plpgsql, not sql,
--     for exactly that lesson).
--   * amount is SUM of the stored natural-signed journalLine.amount:
--     within a single-class scope, positive = increase toward the
--     account's natural balance (positive revenue = more revenue).
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
  p_group_limit INT DEFAULT 1000
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

-- ============================================================
-- journalDimensionPivotLines: the journal lines behind one pivot cell.
--
-- Dimension-match semantics per axis (row 1 / row 2 / column):
--   * dimension param NULL              -> no constraint
--   * dimension set, value param NULL   -> Unassigned (line has NO tag
--                                          for that dimension)
--   * dimension set, value param set    -> tag equals the value
-- A period column narrows postingDate via p_column_period_start/end
-- instead of a dimension match. Same scope/filter params as the pivot.
-- Capped at p_line_limit; the app re-sorts authoritatively.
-- ============================================================

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
  p_line_limit INT DEFAULT 500
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

-- ============================================================
-- reportPin key migration: the hardcoded analytics reports become
-- presets of the generic reports; carry pins over (dedupe-safe).
-- ============================================================

UPDATE "reportPin" rp SET "reportKey" = 'revenue'
WHERE rp."reportKey" = 'revenue-by-customer'
  AND NOT EXISTS (
    SELECT 1 FROM "reportPin" x
    WHERE x."reportKey" = 'revenue'
      AND x."userId" = rp."userId" AND x."companyId" = rp."companyId");

UPDATE "reportPin" rp SET "reportKey" = 'expenses'
WHERE rp."reportKey" = 'expenses-by-supplier'
  AND NOT EXISTS (
    SELECT 1 FROM "reportPin" x
    WHERE x."reportKey" = 'expenses'
      AND x."userId" = rp."userId" AND x."companyId" = rp."companyId");

DELETE FROM "reportPin"
WHERE "reportKey" IN ('revenue-by-customer', 'expenses-by-supplier');
