INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('onshape', '{"type": "object", "properties": {"baseUrl": {"type": "string"}, "accessKey": {"type": "string"}, "secretKey": {"type": "string"}}, "required": ["baseUrl", "accessKey", "secretKey"]}'::json);