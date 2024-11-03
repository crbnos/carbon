ALTER TABLE "company"
  ADD COLUMN "logoDarkIcon" text,
  ADD COLUMN "logoLightIcon" text,
  ADD COLUMN "logoDark" text,
  ADD COLUMN "logoLight" text;

UPDATE "company"
SET "logoDarkIcon" = "logo",
    "logoLightIcon" = "logo", 
    "logoDark" = "logo",
    "logoLight" = "logo";

DROP VIEW "companies";
COMMIT;

ALTER TABLE "company"
  DROP COLUMN "logo";

DROP VIEW IF EXISTS "companies";
CREATE OR REPLACE VIEW "companies" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    c.*,
    uc.*,
    et.name AS "employeeType"
    FROM "userToCompany" uc
    INNER JOIN "company" c
      ON c.id = uc."companyId"
    LEFT JOIN "employee" e
      ON e.id = uc."userId" AND e."companyId" = uc."companyId"
    LEFT JOIN "employeeType" et
      ON et.id = e."employeeTypeId";