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
  WHERE u.active = TRUE;
