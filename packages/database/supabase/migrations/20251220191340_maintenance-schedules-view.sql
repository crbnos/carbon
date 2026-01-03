DROP VIEW IF EXISTS "maintenanceSchedules";
CREATE OR REPLACE VIEW "maintenanceSchedules" WITH (security_invoker = true) AS
SELECT 
  ms.*,
  wc."locationId",
  wc."name" AS "workCenterName",
  l."name" AS "locationName"
FROM "maintenanceSchedule" ms
LEFT JOIN "workCenter" wc ON ms."workCenterId" = wc.id
LEFT JOIN "location" l ON wc."locationId" = l.id;
