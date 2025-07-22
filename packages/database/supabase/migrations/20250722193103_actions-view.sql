DROP VIEW IF EXISTS "qualityActions";
CREATE OR REPLACE VIEW "qualityActions" WITH(SECURITY_INVOKER=true) AS
  SELECT
    "nonConformanceActionTask".*,
    "nonConformance"."nonConformanceId" AS "readableNonConformanceId",
    "nonConformance"."name" AS "nonConformanceName",
    "nonConformance"."status" AS "nonConformanceStatus",
    "nonConformance"."openDate" AS "nonConformanceOpenDate",
    "nonConformance"."dueDate" AS "nonConformanceDueDate",
    "nonConformance"."closeDate" AS "nonConformanceCloseDate",
    "nonConformance"."itemId" AS "nonConformanceItemId",
    "nonConformanceType"."name" AS "nonConformanceTypeName"
  FROM "nonConformanceActionTask"
  INNER JOIN "nonConformance" ON "nonConformanceActionTask"."nonConformanceId" = "nonConformance"."id"
  LEFT JOIN "nonConformanceType" ON "nonConformance"."nonConformanceTypeId" = "nonConformanceType"."id";