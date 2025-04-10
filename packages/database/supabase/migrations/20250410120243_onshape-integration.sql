INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('onshape', '{"type": "object", "properties": {"baseUrl": {"type": "string"}, "accessKey": {"type": "string"}, "secretKey": {"type": "string"}, "companyId": {"type": "string"}}, "required": ["baseUrl", "accessKey", "secretKey", "companyId"]}'::json);