INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('paperless-parts', '{"type": "object", "properties": {"apiKey": {"type": "string"}, "secretKey": {"type": "string"}}, "required": ["apiKey", "secretKey"]}'::json);