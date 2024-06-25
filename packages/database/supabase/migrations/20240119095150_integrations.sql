-- Enable the "pg_jsonschema" extension
CREATE EXTENSION pg_jsonschema WITH SCHEMA extensions;

CREATE TABLE "integration" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "logoPath" TEXT,
  "visible" BOOLEAN NOT NULL DEFAULT TRUE,
  "jsonschema" JSON NOT NULL,
  

  CONSTRAINT integration_pkey PRIMARY KEY ("id")
);

INSERT INTO "integration" ("id", "title", "description", "logoPath", "jsonschema")
VALUES
  ('exchange-rates-v1', 'Exchange Rates', 'Pulls currency rates from exchange rates API', '/integrations/exchange-rates.png', '{"type": "object", "properties": {"apiKey": {"type": "string"}}, "required": ["apiKey"]}'::json),
  ('resend', 'Resend Emails', 'Sends Transactional Emails with Resend API', '/integrations/resend.png', '{"type": "object", "properties": {"apiKey": {"type": "string"}}, "required": ["apiKey"]}'::json);

CREATE POLICY "Authenticated users can view integrations." ON "integration"
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE TABLE "companyIntegration" (
  "id" TEXT NOT NULL,
  "metadata" JSON NOT NULL DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT FALSE,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,

  CONSTRAINT companyIntegration_pkey PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "companyIntegration_id_fkey" FOREIGN KEY ("id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companyIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "companyIntegration" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with settings_view can view company integrations." ON "companyIntegration"
  FOR SELECT USING (
    has_role('employee', "companyId") AND 
    has_company_permission('settings_view', "companyId")
  );

CREATE POLICY "Employees with settings_update can update company integrations." ON "companyIntegration"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND 
    has_company_permission('settings_update', "companyId")
  );

CREATE FUNCTION verify_integration() RETURNS trigger AS $verify_integration$
    DECLARE integration_schema JSON;
    BEGIN
        SELECT jsonschema INTO integration_schema FROM integration WHERE id = NEW.id;
        IF NEW.active = TRUE AND NOT json_matches_schema(integration_schema, NEW.metadata) THEN
            RAISE EXCEPTION 'metadata does not match jsonschema';
        END IF;
        RETURN NEW;
    END;
$verify_integration$ LANGUAGE plpgsql;

CREATE TRIGGER verify_integration BEFORE INSERT OR UPDATE ON "companyIntegration"
    FOR EACH ROW EXECUTE PROCEDURE verify_integration();


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

