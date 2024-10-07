DROP VIEW IF EXISTS "integrations";

ALTER TABLE "integration" 
  DROP COLUMN "title",
  DROP COLUMN "description",
  DROP COLUMN "logoPath",
  DROP COLUMN "visible";


CREATE OR REPLACE VIEW "integrations" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    i.*, 
    c.id AS "companyId",
    coalesce(ci.metadata, '{}') AS "metadata",
    coalesce(ci."active", FALSE) AS "active"
  FROM "integration" i 
  CROSS JOIN "company" c 
  LEFT JOIN (
    SELECT * FROM "companyIntegration"
  ) ci
    ON i.id = ci.id AND c.id = ci."companyId";