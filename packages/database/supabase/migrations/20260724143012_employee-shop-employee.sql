-- Adds a "shop employee" flag to an employee's job record. Only shop employees
-- can execute production/MES work, so the operation-assignee picker filters on
-- this flag. Defaults to TRUE so existing employees stay assignable; admins
-- uncheck office staff (e.g. bookkeepers) who never run operations.
ALTER TABLE "employeeJob"
  ADD COLUMN "shopEmployee" BOOLEAN NOT NULL DEFAULT TRUE;

-- Surface the flag on the employees view (the source for the people store that
-- backs the assignee dropdown). CREATE OR REPLACE (no DROP) keeps the existing
-- column order and appends "shopEmployee" at the end, preserving the view's
-- grants and any dependents. COALESCE keeps employees without a job record
-- assignable by default.
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
    END AS "status",
    COALESCE(ej."shopEmployee", TRUE) AS "shopEmployee"
  FROM "user" u
  INNER JOIN "employee" e
    ON e.id = u.id
  LEFT JOIN "employeeJob" ej
    ON e.id = ej.id AND e."companyId" = ej."companyId"
  LEFT JOIN "location" l
    ON l.id = ej."locationId"
  WHERE u.active = TRUE;
