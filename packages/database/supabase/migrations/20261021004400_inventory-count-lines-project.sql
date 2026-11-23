-- Projects Phase 2a: inventory counts give one line per stock stripe
-- (inventoryCountLine."projectId", null for common stock), so the count
-- detail table must show which owner each line counts. The view was created
-- with icl.*, which Postgres expands once at creation, so it never gained
-- "projectId". Recreated from 20260716153000_inventory-count-lines-view.sql
-- with the stripe's project identifier and name. Nothing depends on the view.
-- SECURITY_INVOKER as before, so the reader's RLS on "project" applies.

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
  pr."identifier" AS "projectIdentifier",
  pr."name" AS "projectName"
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
  LEFT JOIN "materialType" mt ON mt."id" = m."materialTypeId"
  LEFT JOIN "project" pr
    ON pr."id" = icl."projectId" AND pr."companyId" = icl."companyId";
