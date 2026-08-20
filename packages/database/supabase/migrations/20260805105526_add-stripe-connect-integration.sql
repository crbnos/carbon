INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('stripe-connect', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;
