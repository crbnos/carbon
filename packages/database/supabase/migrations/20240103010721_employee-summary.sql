CREATE OR REPLACE VIEW "employeeSummary" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    u.id,
    u."fullName" AS "name",
    u."avatarUrl",
    e."companyId",
    ej.title,
    ej."startDate",
    d.name AS "departmentName",
    l.name AS "locationName",
    m."fullName" AS "managerName"
  FROM "employee" e
  INNER JOIN "user" u
    ON u.id = e.id
  LEFT JOIN "employeeJob" ej
    ON e.id = ej.id AND e."companyId" = ej."companyId"
  LEFT OUTER JOIN "location" l
    ON l.id = ej."locationId"
  LEFT OUTER JOIN "user" m
    ON m.id = ej."managerId"
  LEFT OUTER JOIN "department" d
    ON d.id = ej."departmentId";