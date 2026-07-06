-- The PDF thumbnail toggle is now per-document-template (Line Items block
-- "Show thumbnails" option). The company flag used to be authoritative at
-- render (the template's own option was ignored), so bake each company's
-- actual flag value into its existing templates' Line Items block before
-- dropping the columns — true OR false — so documents render identically.
-- (Companies with no stored template fall back to the template default of
-- thumbnails ON, matching the old column default of true.)

-- Sales documents: quote / sales order / sales invoice / packing slip.
UPDATE "documentTemplate" dt
SET blocks = (
  SELECT jsonb_agg(
    CASE
      WHEN block->>'type' = 'lineItems' THEN jsonb_set(
        block,
        '{options}',
        COALESCE(block->'options', '{}'::jsonb)
          || jsonb_build_object(
               'showThumbnails', cs."includeThumbnailsOnSalesPdfs"
             )
      )
      ELSE block
    END
  )
  FROM jsonb_array_elements(dt.blocks) AS block
)
FROM "companySettings" cs
WHERE cs.id = dt."companyId"
  AND dt."documentType" IN ('quote', 'salesOrder', 'salesInvoice', 'packingSlip')
  AND dt.blocks @> '[{"type":"lineItems"}]';

-- Purchasing documents: purchase order.
UPDATE "documentTemplate" dt
SET blocks = (
  SELECT jsonb_agg(
    CASE
      WHEN block->>'type' = 'lineItems' THEN jsonb_set(
        block,
        '{options}',
        COALESCE(block->'options', '{}'::jsonb)
          || jsonb_build_object(
               'showThumbnails', cs."includeThumbnailsOnPurchasingPdfs"
             )
      )
      ELSE block
    END
  )
  FROM jsonb_array_elements(dt.blocks) AS block
)
FROM "companySettings" cs
WHERE cs.id = dt."companyId"
  AND dt."documentType" = 'purchaseOrder'
  AND dt.blocks @> '[{"type":"lineItems"}]';

ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "includeThumbnailsOnSalesPdfs";
ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "includeThumbnailsOnPurchasingPdfs";
