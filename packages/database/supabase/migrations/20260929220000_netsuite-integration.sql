-- Seed the NetSuite integration registry row. companyIntegration.id has an FK
-- to integration.id (20240119095150_integrations.sql), so installing the
-- integration fails without this row.
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('netsuite', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;

UPDATE "integration" SET "providerRole" = 'accounting'
  WHERE id = 'netsuite'
    AND "providerRole" IS DISTINCT FROM 'accounting';
