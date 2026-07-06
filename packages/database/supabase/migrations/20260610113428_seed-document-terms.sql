-- Seed the per-document Terms & Conditions from the company-level `terms`
-- setting. The Terms block now carries its own rich-text `content`; this
-- backfills that content for existing `documentTemplate` rows whose terms block
-- is still empty, so previously-saved templates keep their terms after the
-- switch from a global setting.
--
-- The `terms` table is intentionally NOT dropped — it remains the seed (editor)
-- and render fallback for documents without a stored template, so companies
-- that never open the editor are unaffected.
--
-- Idempotent: only fills terms blocks that are empty, and only when the company
-- actually has terms content. Re-running is a no-op.

UPDATE "documentTemplate" AS dt
SET
  "blocks" = sub.new_blocks,
  "updatedAt" = NOW()
FROM (
  SELECT
    dt2."id",
    dt2."companyId",
    jsonb_agg(
      CASE
        WHEN block->>'type' = 'terms'
          -- terms block has no usable content yet
          AND COALESCE(
            jsonb_array_length(COALESCE(block #> '{content,content}', '[]'::jsonb)),
            0
          ) = 0
          -- and the company has terms content to copy in
          AND COALESCE(
            jsonb_array_length(COALESCE(seed.value #> '{content}', '[]'::jsonb)),
            0
          ) > 0
        THEN block || jsonb_build_object('content', seed.value)
        ELSE block
      END
      ORDER BY ord
    ) AS new_blocks
  FROM "documentTemplate" AS dt2
  JOIN "terms" AS t ON t."id" = dt2."companyId"
  CROSS JOIN LATERAL (
    -- The `terms` columns are JSON; cast to jsonb so the operators below match.
    SELECT
      (
        CASE
          WHEN dt2."documentType" = 'purchaseOrder' THEN t."purchasingTerms"
          ELSE t."salesTerms"
        END
      )::jsonb AS value
  ) AS seed
  CROSS JOIN LATERAL jsonb_array_elements(dt2."blocks")
    WITH ORDINALITY AS arr(block, ord)
  WHERE dt2."documentType" IN (
      'salesInvoice', 'salesOrder', 'quote', 'packingSlip', 'purchaseOrder'
    )
  GROUP BY dt2."id", dt2."companyId"
) AS sub
WHERE dt."id" = sub."id"
  AND dt."companyId" = sub."companyId"
  AND dt."blocks" IS DISTINCT FROM sub.new_blocks;
