-- The watermark moved from a document setting (settings.showWatermark) to a
-- configurable built-in block. Existing transactional templates don't have the
-- block yet — without it, resolveTemplate would add it hidden and the watermark
-- would disappear. Prepend a watermark block, visible per the old setting
-- (default true, matching the old behaviour), then drop the stale setting key.
UPDATE "documentTemplate"
SET blocks =
  jsonb_build_array(
    jsonb_build_object(
      'id', 'watermark',
      'type', 'watermark',
      'visible', COALESCE((settings->>'showWatermark')::boolean, true),
      'opacity', 0.07::numeric
    )
  ) || blocks
WHERE "documentType" IN ('quote', 'salesOrder', 'salesInvoice', 'purchaseOrder')
  AND NOT (blocks @> '[{"type":"watermark"}]');

UPDATE "documentTemplate"
SET settings = settings - 'showWatermark'
WHERE settings ? 'showWatermark';
