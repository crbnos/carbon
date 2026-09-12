-- Seed the NetSuite integration registry row. `companyIntegration.id` has an FK
-- to `integration.id` (20240119095150_integrations.sql), so connecting NetSuite
-- fails without this row.
--
-- The jsonschema is permissive on purpose: the `verify_integration()` trigger
-- validates `metadata` against it when the integration is active, and the real
-- validation is the zod schema in `packages/ee/src/netsuite/config.tsx`. A strict
-- schema here would have to be kept in lockstep with that one, and the two would
-- drift the first time a field was added.
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('netsuite', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;
