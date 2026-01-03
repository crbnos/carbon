ALTER TABLE "nonConformanceItem" ENABLE ROW LEVEL SECURITY;

DROP VIEW IF EXISTS "suggestions";
CREATE OR REPLACE VIEW "suggestions" 
WITH (security_invoker = true) AS
  SELECT
    s."id",
    s."suggestion",
    s."emoji",
    s."path",
    s."attachmentPath",
    s."tags",
    s."userId",
    s."companyId",
    s."createdAt",
    u."fullName" AS "employeeName",
    u."avatarUrl" AS "employeeAvatarUrl"
  FROM "suggestion" s
  LEFT JOIN "user" u ON s."userId" = u."id";


DROP VIEW IF EXISTS "stockTransferLines";
CREATE VIEW "stockTransferLines" 
WITH (security_invoker = true) AS
SELECT 
  stl.*,
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath",
  i."readableIdWithRevision" as "itemReadableId",
  i."name" as "itemDescription",
  uom."name" AS "unitOfMeasure",
  sf."name" AS "fromShelfName",
  st."name" AS "toShelfName"
FROM "stockTransferLine" stl
LEFT JOIN "item" i ON i."id" = stl."itemId"
LEFT JOIN "modelUpload" mu ON mu."id" = i."modelUploadId"
LEFT JOIN "unitOfMeasure" uom ON uom."code" = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
LEFT JOIN "shelf" sf ON sf."id" = stl."fromShelfId"
LEFT JOIN "shelf" st ON st."id" = stl."toShelfId"
ORDER BY "itemReadableId" ASC, "toShelfName" ASC;


DROP VIEW IF EXISTS "maintenanceSchedules";
CREATE OR REPLACE VIEW "maintenanceSchedules" 
WITH (security_invoker = true) AS
SELECT
  ms.*,
  wc."locationId",
  wc."name" AS "workCenterName",
  l."name" AS "locationName"
FROM "maintenanceSchedule" ms
LEFT JOIN "workCenter" wc ON ms."workCenterId" = wc."id"
LEFT JOIN "location" l ON wc."locationId" = l."id";
