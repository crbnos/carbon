-- The *MaterialWithMakeMethodId views expand jm.*/qm.* at CREATE time, so they
-- were frozen before the per-line itemTrackingType columns existed
-- (20260722101327 jobMaterial, 20260723084405 quoteMaterial). Recreate both so
-- selectAll() through the view stays column-par with the base table — today's
-- consumers don't read tracking through the views, but a frozen view that
-- silently lacks a base-table column is a landmine. DROP + CREATE because the
-- new column lands mid-list (CREATE OR REPLACE only appends).

DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";
CREATE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT
    jm.*,
    s."name" AS "storageUnitName",
    jmm."id" AS "jobMaterialMakeMethodId",
    jmm.version AS "version",
    i."readableIdWithRevision" as "itemReadableId",
    i."readableId" as "itemReadableIdWithoutRevision"
  FROM "jobMaterial" jm
  LEFT JOIN "jobMakeMethod" jmm
    ON jmm."parentMaterialId" = jm."id"
  LEFT JOIN "storageUnit" s ON s.id = jm."storageUnitId"
  INNER JOIN "item" i ON i.id = jm."itemId";

DROP VIEW IF EXISTS "quoteMaterialWithMakeMethodId";
CREATE VIEW "quoteMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT
    qm.*,
    qmm."id" AS "quoteMaterialMakeMethodId",
    qmm.version AS "version"
  FROM "quoteMaterial" qm
  LEFT JOIN "quoteMakeMethod" qmm
    ON qmm."parentMaterialId" = qm."id";
