-- Declare assetSyncEnabled in the onshape integration jsonschema. The
-- verify_integration() trigger validates companyIntegration.metadata against
-- this schema; the toggle currently passes only because additionalProperties
-- defaults to true. Declaring it makes the setting survive a future
-- additionalProperties: false tightening.
UPDATE "integration"
SET "jsonschema" = '{
  "type": "object",
  "properties": {
    "baseUrl": {
      "type": "string"
    },
    "credentials": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "accessToken": {
          "type": "string"
        },
        "refreshToken": {
          "type": "string"
        },
        "expiresAt": {
          "type": "string"
        }
      },
      "required": ["type", "accessToken", "refreshToken", "expiresAt"]
    },
    "assetSyncEnabled": {
      "type": "boolean"
    },
    "onshapeCompanyId": {
      "type": "string"
    },
    "scope": {
      "type": "string"
    }
  },
  "required": ["baseUrl", "credentials"]
}'::json
WHERE "id" = 'onshape';
