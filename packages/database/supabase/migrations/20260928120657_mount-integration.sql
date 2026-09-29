-- Seed the Mount integration registry row. companyIntegration.id has an FK
-- to integration.id (20240119095150_integrations.sql), so installing the
-- integration fails without this row — the route surfaces the FK violation as
-- a bare "Failed to install integration" with no detail.
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('mount', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;
