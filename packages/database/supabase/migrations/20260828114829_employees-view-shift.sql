-- Expose the employee's shift on the "employees" view so the People table can
-- show and filter by it. employeeJob.shiftId is the authoritative assignment
-- (kept in sync with employeeShift by updateEmployeeJob).
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
    l."name" AS "locationName",
    ej."shiftId",
    s."name" AS "shiftName",
    CASE
      WHEN e."active" = TRUE THEN 'Active'
      WHEN EXISTS (
        SELECT 1
        FROM "invite" i
        WHERE i."email" = u."email"
          AND i."companyId" = e."companyId"
          AND i."acceptedAt" IS NULL
          AND i."revokedAt" IS NULL
      ) THEN 'Invited'
      ELSE 'Inactive'
    END AS "status"
  FROM "user" u
  INNER JOIN "employee" e
    ON e.id = u.id
  LEFT JOIN "employeeJob" ej
    ON e.id = ej.id AND e."companyId" = ej."companyId"
  LEFT JOIN "location" l
    ON l.id = ej."locationId"
  LEFT JOIN "shift" s
    ON s.id = ej."shiftId"
  WHERE u.active = TRUE;
