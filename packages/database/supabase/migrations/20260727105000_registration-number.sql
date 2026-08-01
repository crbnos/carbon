-- Company registration number (e.g. UK Companies House number). Shown in
-- company settings for countries that issue one, and used as the default
-- document footer registration number.
ALTER TABLE "company"
  ADD COLUMN "registrationNumber" TEXT;

-- Postgres views freeze their column manifest at CREATE time, so adding
-- columns to "company" does not propagate to the "companies" view unless we
-- recreate it. Drop + recreate to refresh the column list.
DROP VIEW IF EXISTS "companies";
CREATE OR REPLACE VIEW "companies" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    c.*,
    uc.*,
    et.name AS "employeeType",
    cg.name AS "companyGroupName",
    cg."ownerId"
  FROM "userToCompany" uc
  INNER JOIN "company" c
    ON c.id = uc."companyId"
  LEFT JOIN "employee" e
    ON e.id = uc."userId" AND e."companyId" = uc."companyId"
  LEFT JOIN "employeeType" et
    ON et.id = e."employeeTypeId"
  LEFT JOIN "companyGroup" cg
    ON cg.id = c."companyGroupId";
