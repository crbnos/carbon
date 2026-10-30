-- Inventory count for tracked units (.ai/specs/2026-10-30-inventory-count-tracked-units.md).
--
-- "foundDuringCount": the line was added while counting (a scan, Add unit or
-- an import), not by the snapshot. Its unit is Unexpected in that bin.
-- "assignedReadableId": a serial number the counter gave a unit that had none.
-- The post writes it to "trackedEntity"."readableId".

ALTER TABLE "inventoryCountLine"
  ADD COLUMN IF NOT EXISTS "foundDuringCount" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "assignedReadableId" TEXT;

-- One line per unit per bin in a count. The snapshot already writes one line
-- per (item, bin, tracked entity), so existing counts satisfy it.
CREATE UNIQUE INDEX IF NOT EXISTS "inventoryCountLine_unit_key"
  ON "inventoryCountLine" ("inventoryCountId", "storageUnitId", "trackedEntityId")
  NULLS NOT DISTINCT
  WHERE "trackedEntityId" IS NOT NULL;

-- One line per new serial or batch number per item in a count.
CREATE UNIQUE INDEX IF NOT EXISTS "inventoryCountLine_newUnit_key"
  ON "inventoryCountLine" ("inventoryCountId", "itemId", "readableId")
  WHERE "trackedEntityId" IS NULL AND "readableId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "inventoryCountLine_group_idx"
  ON "inventoryCountLine" ("inventoryCountId", "itemId", "storageUnitId");

-- "icl".* is expanded when the view is created, and the new columns land in the
-- middle of it, which CREATE OR REPLACE refuses. Drop and create it again.
DROP VIEW IF EXISTS "inventoryCountLines";

CREATE VIEW "inventoryCountLines" WITH (SECURITY_INVOKER = true) AS
SELECT
  icl.*,
  i."name" AS "itemName",
  i."readableIdWithRevision" AS "itemReadableIdWithRevision",
  i."type" AS "type",
  i."itemTrackingType" AS "itemTrackingType",
  i."thumbnailPath" AS "itemThumbnailPath",
  i."unitOfMeasureCode" AS "unitOfMeasureCode",
  m."materialSubstanceId",
  m."materialFormId",
  m."dimensionId",
  md."name" AS "dimension",
  m."finishId",
  mf."name" AS "finish",
  m."gradeId",
  mg."name" AS "grade",
  m."materialTypeId",
  mt."name" AS "materialType",
  COALESCE(m."tags", p."tags", t."tags", c."tags") AS "tags",
  COALESCE(su."storageTypeIds", ARRAY[]::TEXT[]) AS "storageTypeIds",
  (icl."trackedEntityId" IS NOT NULL AND te."readableId" IS NULL) AS "isUnnumbered",
  te."createdAt" AS "trackedEntityCreatedAt"
FROM "inventoryCountLine" icl
  INNER JOIN "item" i
    ON i."id" = icl."itemId" AND i."companyId" = icl."companyId"
  LEFT JOIN "trackedEntity" te
    ON te."id" = icl."trackedEntityId" AND te."companyId" = icl."companyId"
  LEFT JOIN "material" m
    ON m."id" = i."readableId" AND m."companyId" = icl."companyId"
  LEFT JOIN "part" p
    ON p."id" = i."readableId" AND p."companyId" = icl."companyId"
  LEFT JOIN "tool" t
    ON t."id" = i."readableId" AND t."companyId" = icl."companyId"
  LEFT JOIN "consumable" c
    ON c."id" = i."readableId" AND c."companyId" = icl."companyId"
  LEFT JOIN "storageUnit" su
    ON su."id" = icl."storageUnitId" AND su."companyId" = icl."companyId"
  LEFT JOIN "materialDimension" md ON md."id" = m."dimensionId"
  LEFT JOIN "materialFinish" mf ON mf."id" = m."finishId"
  LEFT JOIN "materialGrade" mg ON mg."id" = m."gradeId"
  LEFT JOIN "materialType" mt ON mt."id" = m."materialTypeId";

-- One row per (count, item, storage unit): what the count sheet shows. The
-- item, material and storage-unit columns match "inventoryCountLines", so the
-- group table keeps the same column filters.
DROP VIEW IF EXISTS "inventoryCountGroups";

CREATE VIEW "inventoryCountGroups" WITH (SECURITY_INVOKER = true) AS
WITH g AS (
  SELECT
    icl."inventoryCountId",
    icl."companyId",
    icl."itemId",
    icl."storageUnitId",
    SUM(icl."systemQuantity") AS "expectedQuantity",
    SUM(icl."countedQuantity") AS "countedQuantity",
    SUM(icl."countedQuantity") - SUM(icl."systemQuantity") AS "variance",
    COUNT(*) AS "lineCount",
    COUNT(*) FILTER (WHERE NOT icl."foundDuringCount" AND icl."countedQuantity" > 0) AS "foundCount",
    COUNT(*) FILTER (WHERE NOT icl."foundDuringCount" AND icl."countedQuantity" = 0) AS "missingCount",
    COUNT(*) FILTER (WHERE icl."foundDuringCount") AS "unexpectedCount",
    COUNT(*) FILTER (WHERE icl."countedQuantity" IS NULL) AS "notCountedCount",
    COUNT(*) FILTER (WHERE icl."trackedEntityId" IS NOT NULL AND te."readableId" IS NULL) AS "unnumberedCount",
    -- every unit number in the group, so a search for a serial finds its group
    string_agg(COALESCE(icl."assignedReadableId", icl."readableId"), ' ') AS "unitNumbers",
    -- the line of a group that has only one (an untracked item), so its count
    -- can be typed on the group row
    CASE WHEN COUNT(*) = 1 THEN MIN(icl."id") END AS "lineId"
  FROM "inventoryCountLine" icl
    LEFT JOIN "trackedEntity" te
      ON te."id" = icl."trackedEntityId" AND te."companyId" = icl."companyId"
  GROUP BY icl."inventoryCountId", icl."companyId", icl."itemId", icl."storageUnitId"
)
SELECT
  g."inventoryCountId" || ':' || g."itemId" || ':' || COALESCE(g."storageUnitId", '') AS "id",
  g.*,
  i."name" AS "itemName",
  i."readableIdWithRevision" AS "itemReadableIdWithRevision",
  i."type" AS "type",
  i."itemTrackingType" AS "itemTrackingType",
  i."thumbnailPath" AS "itemThumbnailPath",
  i."unitOfMeasureCode" AS "unitOfMeasureCode",
  m."materialSubstanceId",
  m."materialFormId",
  m."dimensionId",
  md."name" AS "dimension",
  m."finishId",
  mf."name" AS "finish",
  m."gradeId",
  mg."name" AS "grade",
  m."materialTypeId",
  mt."name" AS "materialType",
  COALESCE(m."tags", p."tags", t."tags", c."tags") AS "tags",
  COALESCE(su."storageTypeIds", ARRAY[]::TEXT[]) AS "storageTypeIds"
FROM g
  INNER JOIN "item" i
    ON i."id" = g."itemId" AND i."companyId" = g."companyId"
  LEFT JOIN "material" m
    ON m."id" = i."readableId" AND m."companyId" = g."companyId"
  LEFT JOIN "part" p
    ON p."id" = i."readableId" AND p."companyId" = g."companyId"
  LEFT JOIN "tool" t
    ON t."id" = i."readableId" AND t."companyId" = g."companyId"
  LEFT JOIN "consumable" c
    ON c."id" = i."readableId" AND c."companyId" = g."companyId"
  LEFT JOIN "storageUnit" su
    ON su."id" = g."storageUnitId" AND su."companyId" = g."companyId"
  LEFT JOIN "materialDimension" md ON md."id" = m."dimensionId"
  LEFT JOIN "materialFinish" mf ON mf."id" = m."finishId"
  LEFT JOIN "materialGrade" mg ON mg."id" = m."gradeId"
  LEFT JOIN "materialType" mt ON mt."id" = m."materialTypeId";
