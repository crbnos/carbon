-- Onshape Government: a tenant serves OAuth from its own address, so the
-- separate `oauthUrl` setting added in 20260929135035 is redundant. The
-- authorize and token endpoints now derive from `baseUrl`. A stale `oauthUrl`
-- left on an existing companyIntegration row is inert.
UPDATE "integration"
SET "jsonschema" = '{
    "type": "object",
    "properties": {
      "baseUrl": {"type": "string"},
      "clientId": {"type": "string"},
      "credentials": {
        "type": "object",
        "properties": {
          "type": {"type": "string"},
          "expiresAt": {"type": "string"}
        },
        "required": ["type"]
      },
      "assetSyncEnabled": {"type": "boolean"},
      "onshapeCompanyId": {"type": "string"},
      "scope": {"type": "string"}
    },
    "required": ["baseUrl", "clientId"]
  }'::json
WHERE "id" = 'onshape-government';
