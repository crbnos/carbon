DROP VIEW "companies";
COMMIT;

ALTER TABLE "company" 
  ADD COLUMN IF NOT EXISTS "digitalQuoteNotificationGroup" text[] NOT NULL DEFAULT '{}';

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

ALTER TABLE "quote"
  ADD COLUMN "digitalQuoteAcceptedBy" text;