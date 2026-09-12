-- Backfill trackedEntity."itemId" for adjustment-created entities:
-- post-inventory-adjustment set sourceDocumentId to the item but left the
-- itemId column null, hiding this stock from every by-item consumer — the
-- sales-return picker found no candidates, so return receipts minted a
-- duplicate entity instead of reactivating the shipped one. The insert now
-- sets itemId; this repairs rows already written. Scoped to
-- sourceDocument = 'Item' (there sourceDocumentId IS the item id) and joined
-- to "item" so only ids that still resolve are written.

UPDATE "trackedEntity" te
SET "itemId" = i."id"
FROM "item" i
WHERE te."itemId" IS NULL
  AND te."sourceDocument" = 'Item'
  AND te."sourceDocumentId" = i."id"
  AND te."companyId" = i."companyId";
