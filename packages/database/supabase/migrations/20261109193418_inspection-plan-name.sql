-- An inspection plan's name was stored as "drawingNumber", but it names the
-- plan ("R1234 Receipt"), not a drawing. The column says so now.

ALTER TABLE "inspectionDocument" RENAME COLUMN "drawingNumber" TO "name";

-- `d.*` fixes a view's column names when it is created, so the view would keep
-- answering "drawingNumber" until it is made again.
DROP VIEW IF EXISTS "inspectionDocuments";
CREATE VIEW "inspectionDocuments" WITH (SECURITY_INVOKER=true) AS
  SELECT
    d.*,
    i."readableIdWithRevision" AS "partReadableId"
  FROM "inspectionDocument" d
  LEFT JOIN "item" i ON i."id" = d."partId";

DROP VIEW IF EXISTS "inspectionPlanParts";
CREATE VIEW "inspectionPlanParts" WITH (SECURITY_INVOKER=true) AS
  SELECT
    d."partId" AS "id",
    d."companyId",
    i."readableIdWithRevision" AS "partReadableId",
    i."name" AS "partName",
    COUNT(*)::INTEGER AS "planCount",
    -- The search reads the plans' names too.
    string_agg(COALESCE(d."name", d."fileName"), ' ') AS "planNames",
    jsonb_agg(
      jsonb_build_object(
        'id', d."id",
        'name', COALESCE(d."name", d."fileName"),
        'modelUploadId', d."modelUploadId",
        'createdBy', d."createdBy",
        'createdAt', d."createdAt"
      )
      ORDER BY COALESCE(d."name", d."fileName"), d."id"
    ) AS "plans",
    MIN(d."createdAt") AS "createdAt",
    MAX(COALESCE(d."updatedAt", d."createdAt")) AS "updatedAt",
    ic."itemPostingGroupId",
    p."tags"
  FROM "inspectionDocument" d
  JOIN "item" i ON i."id" = d."partId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i."id"
  LEFT JOIN "part" p ON p."id" = i."readableId" AND p."companyId" = i."companyId"
  GROUP BY
    d."partId",
    d."companyId",
    i."readableIdWithRevision",
    i."name",
    ic."itemPostingGroupId",
    p."tags";
