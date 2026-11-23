-- The Inspection Plans list shows one row per part, its plans in the expanded
-- row (as the Change Notices list shows a notice's affected items).

DROP VIEW IF EXISTS "inspectionPlanParts";
CREATE VIEW "inspectionPlanParts" WITH (SECURITY_INVOKER=true) AS
  SELECT
    d."partId" AS "id",
    d."companyId",
    i."readableIdWithRevision" AS "partReadableId",
    i."name" AS "partName",
    COUNT(*)::INTEGER AS "planCount",
    -- The search reads the plans' names too.
    string_agg(COALESCE(d."drawingNumber", d."fileName"), ' ') AS "planNames",
    jsonb_agg(
      jsonb_build_object(
        'id', d."id",
        'name', COALESCE(d."drawingNumber", d."fileName"),
        'modelUploadId', d."modelUploadId",
        'createdBy', d."createdBy",
        'createdAt', d."createdAt"
      )
      ORDER BY COALESCE(d."drawingNumber", d."fileName"), d."id"
    ) AS "plans",
    MIN(d."createdAt") AS "createdAt",
    MAX(COALESCE(d."updatedAt", d."createdAt")) AS "updatedAt"
  FROM "inspectionDocument" d
  JOIN "item" i ON i."id" = d."partId"
  GROUP BY d."partId", d."companyId", i."readableIdWithRevision", i."name";
