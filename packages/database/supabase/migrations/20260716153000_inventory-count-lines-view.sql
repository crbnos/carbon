-- ============================================================
-- inventoryCountLines view: count lines with item + material + storage-unit
-- attributes flattened as top-level columns, so the count detail table can
-- offer the same generic column filters the inventory quantities screen does
-- (item type, storage type, tags, material substance/shape/finish/grade/
-- dimension/type).
--
-- The base inventoryCountLine only carries itemId / storageUnitId / readableId /
-- quantities. Material attributes live on the item SUBTYPE tables
-- (material/part/tool/consumable), keyed by item."readableId" - the same join
-- get_inventory_quantities uses (NOT material.itemId) - and storage types live
-- on storageUnit. Every attribute join is LEFT: Parts/Tools/Consumables have no
-- material row, and a line's storageUnit may be null.
--
-- SECURITY_INVOKER so the querying user's RLS on each underlying table applies.
-- ============================================================

CREATE OR REPLACE VIEW "inventoryCountLines" WITH (SECURITY_INVOKER = true) AS
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
  COALESCE(su."storageTypeIds", ARRAY[]::TEXT[]) AS "storageTypeIds"
FROM "inventoryCountLine" icl
  INNER JOIN "item" i
    ON i."id" = icl."itemId" AND i."companyId" = icl."companyId"
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
