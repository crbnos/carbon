-- Sampling configuration moves entirely into the inspection plan:
--   feature rule -> document default -> All
-- The inspection document gains a default sampling rule (the fallback for
-- features without their own rule, and the lot-level plan base), replacing the
-- per-item itemSamplingPlan tier. Existing item plans are preserved by copying
-- them onto the item's documents' default slots before the table is dropped;
-- items with a plan but no document fall back to All (100% inspection), which
-- is the intended behavior for document-less inspections.

-- 1) Document-level default sampling rule (same column set/types as the
--    per-feature rule columns on inspectionFeature).
ALTER TABLE "inspectionDocument"
  ADD COLUMN IF NOT EXISTS "samplingPlanType" "samplingPlanType",
  ADD COLUMN IF NOT EXISTS "samplingSampleSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "samplingPercentage" NUMERIC,
  ADD COLUMN IF NOT EXISTS "samplingAql" NUMERIC,
  ADD COLUMN IF NOT EXISTS "samplingInspectionLevel" "inspectionLevel",
  ADD COLUMN IF NOT EXISTS "samplingSeverity" "inspectionSeverity";

-- 2) Backfill: each item plan becomes the default rule on that item's
--    documents (inspectionDocument.partId = itemSamplingPlan.itemId). Guarded
--    so a retry over committed partial state is safe (the table may already be
--    gone; already-backfilled documents are skipped via samplingPlanType IS NULL).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'itemSamplingPlan'
  ) THEN
    UPDATE "inspectionDocument" d
    SET
      "samplingPlanType" = p."type",
      "samplingSampleSize" = p."sampleSize",
      "samplingPercentage" = p."percentage",
      "samplingAql" = p."aql",
      "samplingInspectionLevel" = p."inspectionLevel",
      "samplingSeverity" = p."severity"
    FROM "itemSamplingPlan" p
    WHERE d."partId" = p."itemId"
      AND d."companyId" = p."companyId"
      AND d."samplingPlanType" IS NULL;
  END IF;
END $$;

-- 3) Retire the per-item tier.
DROP TABLE IF EXISTS "itemSamplingPlan";
