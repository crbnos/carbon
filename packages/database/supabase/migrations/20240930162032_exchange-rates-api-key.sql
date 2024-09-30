UPDATE "integration"
SET "jsonschema" = '{"type": "object", "properties": {}}'::json
WHERE "id" = 'exchange-rates-v1';