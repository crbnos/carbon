-- Rectify an already-posted inventory count in place: reopening it (via Rectify)
-- and re-posting the changed lines writes new adjustment movements that point back
-- at the original movement they correct, so both the original adjustment and the
-- fix stay visible and linked in the stock-movements screens.

-- ============================================================================
-- itemLedger.correctionOfItemLedgerId — the movement->movement link: a "fix"
-- adjustment points at the original adjustment it corrects. Append-only self
-- reference (no FK, matching costLedger.appliesToCostLedgerId).
-- ============================================================================
ALTER TABLE "itemLedger"
  ADD COLUMN "correctionOfItemLedgerId" TEXT;

CREATE INDEX "itemLedger_correctionOfItemLedgerId_idx"
  ON "itemLedger" ("correctionOfItemLedgerId")
  WHERE "correctionOfItemLedgerId" IS NOT NULL;

-- ============================================================================
-- Recreate the itemLedgers view so its `il.*` expansion picks up the new
-- correctionOfItemLedgerId column (Postgres freezes `*` at definition time, and
-- the new column lands mid-list so CREATE OR REPLACE can't reorder — drop first).
-- ============================================================================
DROP VIEW IF EXISTS "itemLedgers";

CREATE VIEW "itemLedgers" WITH (security_invoker = true) AS
SELECT
  il.*,
  (il."correctionOfItemLedgerId" IS NOT NULL) AS "isCorrection",
  i."readableIdWithRevision" AS "itemReadableId",
  i."name"                   AS "itemDescription",
  i."type"                   AS "itemType",
  l."name"                   AS "locationName",
  su."name"                  AS "storageUnitName",
  te."readableId"            AS "trackedEntityReadableId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL
      THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END                        AS "thumbnailPath"
FROM "itemLedger" il
INNER JOIN "item" i ON i."id" = il."itemId" AND i."companyId" = il."companyId"
LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
LEFT JOIN "location" l ON l."id" = il."locationId"
LEFT JOIN "storageUnit" su ON su."id" = il."storageUnitId"
LEFT JOIN "trackedEntity" te ON te."id" = il."trackedEntityId";
