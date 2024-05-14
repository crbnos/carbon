CREATE OR REPLACE VIEW "userDefaults" AS
  SELECT
    u.id as "userId",
    l."companyId" as "companyId",
    ej."locationId"
  FROM "user" u 
  LEFT JOIN "employeeJob" ej ON ej.id = u.id
  LEFT JOIN "location" l ON l.id = ej."locationId" AND l."companyId" = ej."companyId";