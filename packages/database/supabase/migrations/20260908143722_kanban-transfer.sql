-- Kanban Transfer support.
--
-- A "Transfer" kanban creates a stock transfer from one storage unit to another
-- within a location. The existing "storageUnitId" is reused as the DESTINATION
-- (to) bin — consistent with Buy/Make, where it is the bin stock lands in — and
-- a new "fromStorageUnitId" holds the SOURCE bin.
--
-- The kanban replenishment system is retyped from "itemReplenishmentSystem"
-- (Buy | Make | Buy and Make) to a kanban-specific enum. "Transfer" is NOT added
-- to "itemReplenishmentSystem" on purpose: that enum drives item planning, MRP,
-- and demand, where Transfer is not a valid item-level replenishment method.

CREATE TYPE "kanbanReplenishmentSystem" AS ENUM ('Buy', 'Make', 'Transfer');

-- The "kanbans" view is SELECT k.*, so it must be dropped before the column
-- retype and recreated afterwards (also picks up the new column + join).
DROP VIEW IF EXISTS "kanbans";

ALTER TABLE "kanban" ALTER COLUMN "replenishmentSystem" DROP DEFAULT;
ALTER TABLE "kanban"
  ALTER COLUMN "replenishmentSystem" TYPE "kanbanReplenishmentSystem"
  USING "replenishmentSystem"::text::"kanbanReplenishmentSystem";
ALTER TABLE "kanban" ALTER COLUMN "replenishmentSystem" SET DEFAULT 'Buy';

ALTER TABLE "kanban" ADD COLUMN "fromStorageUnitId" TEXT
  REFERENCES "storageUnit"("id") ON DELETE CASCADE;

CREATE INDEX "kanban_fromStorageUnitId_idx" ON "kanban" ("fromStorageUnitId");

CREATE VIEW "kanbans" WITH(SECURITY_INVOKER=true) AS
SELECT
  k.*,
  i.name,
  i."readableIdWithRevision",
  j."jobId" as "jobReadableId",
  l.name as "locationName",
  s.name as "storageUnitName",
  fs.name as "fromStorageUnitName",
  su.name as "supplierName",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath"
FROM "kanban" k
JOIN "item" i ON k."itemId" = i."id"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
JOIN "location" l ON k."locationId" = l."id"
LEFT JOIN "storageUnit" s ON k."storageUnitId" = s."id"
LEFT JOIN "storageUnit" fs ON k."fromStorageUnitId" = fs."id"
LEFT JOIN "supplier" su ON k."supplierId" = su."id"
LEFT JOIN "job" j ON k."jobId" = j."id";
