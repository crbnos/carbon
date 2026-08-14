-- Seed the Avalara integration registry row. Idempotent so re-running is a
-- no-op. Per-company config lives in "companyIntegration" (already has RLS);
-- the "integration" table is a global product catalog with only id + jsonschema.
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('avalara', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;
