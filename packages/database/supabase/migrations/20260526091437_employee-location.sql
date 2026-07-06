DROP VIEW IF EXISTS "employeesAcrossCompanies";
DROP VIEW IF EXISTS "employees";

CREATE OR REPLACE VIEW "employees" WITH(SECURITY_INVOKER=true) AS
  SELECT
    u.id,
    u."email",
    u."firstName",
    u."lastName",
    u."fullName" AS "name",
    u."avatarUrl",
    e."employeeTypeId",
    e."companyId",
    e."active",
    ej."locationId",
    l."name" AS "locationName"
  FROM "user" u
  INNER JOIN "employee" e
    ON e.id = u.id
  LEFT JOIN "employeeJob" ej
    ON e.id = ej.id AND e."companyId" = ej."companyId"
  LEFT JOIN "location" l
    ON l.id = ej."locationId"
  WHERE u.active = TRUE;

CREATE OR REPLACE VIEW "employeesAcrossCompanies" WITH(SECURITY_INVOKER=true) AS
  SELECT
    u.id,
    u.email,
    u."firstName",
    u."lastName",
    u."fullName" AS "name",
    u."avatarUrl",
    u.active,
    array_agg(e."companyId") as "companyId"
  FROM "user" u
  INNER JOIN "employee" e
    ON e.id = u.id
  WHERE u.active = TRUE
  GROUP BY u.id, u.email, u."firstName", u."lastName", u."fullName", u."avatarUrl", u.active;
