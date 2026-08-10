-- ============================================================
-- Purchases analytics pivot — sourced from the purchase invoice
-- subledger, NOT the GL journal.
--
-- "Spend by supplier / biggest cost drivers by part" is a purchasing
-- question: gross invoiced amount per line, which never nets against
-- payments (unlike an AP/GL balance) and captures inventory, expense,
-- and service purchases uniformly. The GL journalDimensionPivot cannot
-- answer it (AP nets on payment; item tags don't live on AP lines).
--
-- Both functions mirror journalDimensionPivot's output contract so the
-- existing PivotTree / pivotData UI renders them unchanged:
--   * rowValue*/columnKey NULL = the Unassigned bucket.
--   * amount = SUM of purchaseInvoiceLine."extendedPrice" (base currency,
--     net of tax & shipping — the goods cost, comparable per part).
--   * Row groups capped at p_group_limit by ABS(SUM(amount)); the app
--     re-sorts, so callers must not rely on ordering.
--
-- Grouping fields (p_row_field_*/p_column_field), one of:
--   supplier | supplierType | item | itemPostingGroup | costCenter
-- resolved to a value id via CASE (no dynamic SQL). Only non-Draft,
-- non-Voided invoices count.
-- ============================================================

DROP FUNCTION IF EXISTS "purchaseLineDimensionPivot";
CREATE OR REPLACE FUNCTION "purchaseLineDimensionPivot" (
  p_company_id TEXT,
  p_start DATE,
  p_end DATE,
  p_row_field_1 TEXT DEFAULT NULL,
  p_row_field_2 TEXT DEFAULT NULL,
  p_column_field TEXT DEFAULT NULL,
  p_period_ends DATE[] DEFAULT NULL,
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
    RAISE EXCEPTION 'purchaseLineDimensionPivot requires p_company_id';
  END IF;
  IF p_column_field IS NOT NULL AND p_period_ends IS NOT NULL THEN
    RAISE EXCEPTION 'purchaseLineDimensionPivot: column axis is a field OR period ends, not both';
  END IF;

  RETURN QUERY
  WITH "scopedLines" AS (
    SELECT
      jl."id" AS "lineId",
      jl."extendedPrice" AS "lineAmount",
      COALESCE(jl."quantity", 0) AS "lineQuantity",
      pi."postingDate" AS "postingDate",
      pi."supplierId" AS "supplierId",
      s."supplierTypeId" AS "supplierTypeId",
      jl."itemId" AS "itemId",
      ic."itemPostingGroupId" AS "itemPostingGroupId",
      jl."costCenterId" AS "costCenterId"
    FROM "purchaseInvoiceLine" jl
    INNER JOIN "purchaseInvoice" pi ON pi."id" = jl."invoiceId"
    LEFT JOIN "supplier" s ON s."id" = pi."supplierId"
    LEFT JOIN "itemCost" ic
      ON ic."itemId" = jl."itemId" AND ic."companyId" = pi."companyId"
    WHERE pi."companyId" = p_company_id
      AND jl."companyId" = p_company_id
      AND pi."status" NOT IN ('Draft', 'Voided')
      AND pi."postingDate" >= p_start
      AND pi."postingDate" <= p_end
      AND jl."extendedPrice" IS NOT NULL
  ),
  "taggedLines" AS (
    SELECT
      sl."lineId", sl."lineAmount", sl."lineQuantity",
      CASE p_row_field_1
        WHEN 'supplier' THEN sl."supplierId"
        WHEN 'supplierType' THEN sl."supplierTypeId"
        WHEN 'item' THEN sl."itemId"
        WHEN 'itemPostingGroup' THEN sl."itemPostingGroupId"
        WHEN 'costCenter' THEN sl."costCenterId"
        ELSE NULL
      END AS "r1",
      CASE p_row_field_2
        WHEN 'supplier' THEN sl."supplierId"
        WHEN 'supplierType' THEN sl."supplierTypeId"
        WHEN 'item' THEN sl."itemId"
        WHEN 'itemPostingGroup' THEN sl."itemPostingGroupId"
        WHEN 'costCenter' THEN sl."costCenterId"
        ELSE NULL
      END AS "r2",
      CASE
        WHEN p_column_field IS NOT NULL THEN (
          CASE p_column_field
            WHEN 'supplier' THEN sl."supplierId"
            WHEN 'supplierType' THEN sl."supplierTypeId"
            WHEN 'item' THEN sl."itemId"
            WHEN 'itemPostingGroup' THEN sl."itemPostingGroupId"
            WHEN 'costCenter' THEN sl."costCenterId"
            ELSE NULL
          END
        )
        WHEN p_period_ends IS NOT NULL THEN (
          SELECT MIN(pe)::TEXT FROM unnest(p_period_ends) pe
          WHERE pe >= sl."postingDate"
        )
        ELSE 'total'
      END AS "colKey"
    FROM "scopedLines" sl
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
-- purchaseLinePivotLines: the invoice lines behind one pivot cell.
-- Field-match semantics per axis (row 1 / row 2 / column):
--   * field param NULL              -> no constraint
--   * field set, value param NULL   -> Unassigned (field value IS NULL)
--   * field set, value param set    -> field value equals the value
-- A period column narrows postingDate via p_column_period_start/end.
-- ============================================================

DROP FUNCTION IF EXISTS "purchaseLinePivotLines";
CREATE OR REPLACE FUNCTION "purchaseLinePivotLines" (
  p_company_id TEXT,
  p_start DATE,
  p_end DATE,
  p_row_field_1 TEXT DEFAULT NULL,
  p_row_value_1 TEXT DEFAULT NULL,
  p_row_field_2 TEXT DEFAULT NULL,
  p_row_value_2 TEXT DEFAULT NULL,
  p_column_field TEXT DEFAULT NULL,
  p_column_value TEXT DEFAULT NULL,
  p_column_period_start DATE DEFAULT NULL,
  p_column_period_end DATE DEFAULT NULL,
  p_line_limit INT DEFAULT 500
)
RETURNS TABLE (
  "id" TEXT,
  "postingDate" DATE,
  "invoiceReadableId" TEXT,
  "supplierName" TEXT,
  "itemReadableId" TEXT,
  "description" TEXT,
  "amount" NUMERIC,
  "quantity" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH l AS (
    SELECT
      jl."id",
      pi."postingDate",
      pi."invoiceId" AS "invoiceReadableId",
      s."name" AS "supplierName",
      i."readableIdWithRevision" AS "itemReadableId",
      jl."description",
      jl."extendedPrice" AS "amount",
      COALESCE(jl."quantity", 0) AS "quantity",
      pi."supplierId",
      s."supplierTypeId",
      jl."itemId",
      ic."itemPostingGroupId",
      jl."costCenterId"
    FROM "purchaseInvoiceLine" jl
    INNER JOIN "purchaseInvoice" pi ON pi."id" = jl."invoiceId"
    LEFT JOIN "supplier" s ON s."id" = pi."supplierId"
    LEFT JOIN "item" i ON i."id" = jl."itemId"
    LEFT JOIN "itemCost" ic
      ON ic."itemId" = jl."itemId" AND ic."companyId" = pi."companyId"
    WHERE pi."companyId" = p_company_id
      AND jl."companyId" = p_company_id
      AND pi."status" NOT IN ('Draft', 'Voided')
      AND pi."postingDate" >= COALESCE(p_column_period_start, p_start)
      AND pi."postingDate" <= COALESCE(p_column_period_end, p_end)
      AND jl."extendedPrice" IS NOT NULL
  )
  SELECT
    l."id", l."postingDate", l."invoiceReadableId", l."supplierName",
    l."itemReadableId", l."description", l."amount", l."quantity"
  FROM l
  WHERE
    (
      p_row_field_1 IS NULL
      OR (CASE p_row_field_1
            WHEN 'supplier' THEN l."supplierId"
            WHEN 'supplierType' THEN l."supplierTypeId"
            WHEN 'item' THEN l."itemId"
            WHEN 'itemPostingGroup' THEN l."itemPostingGroupId"
            WHEN 'costCenter' THEN l."costCenterId"
          END) IS NOT DISTINCT FROM p_row_value_1
    )
    AND (
      p_row_field_2 IS NULL
      OR (CASE p_row_field_2
            WHEN 'supplier' THEN l."supplierId"
            WHEN 'supplierType' THEN l."supplierTypeId"
            WHEN 'item' THEN l."itemId"
            WHEN 'itemPostingGroup' THEN l."itemPostingGroupId"
            WHEN 'costCenter' THEN l."costCenterId"
          END) IS NOT DISTINCT FROM p_row_value_2
    )
    AND (
      p_column_field IS NULL
      OR (CASE p_column_field
            WHEN 'supplier' THEN l."supplierId"
            WHEN 'supplierType' THEN l."supplierTypeId"
            WHEN 'item' THEN l."itemId"
            WHEN 'itemPostingGroup' THEN l."itemPostingGroupId"
            WHEN 'costCenter' THEN l."costCenterId"
          END) IS NOT DISTINCT FROM p_column_value
    )
  ORDER BY l."postingDate", l."id"
  LIMIT p_line_limit;
END;
$$;
