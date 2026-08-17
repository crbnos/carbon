-- Declare the release-import settings in the onshape integration jsonschema.
-- The verify_integration() trigger validates companyIntegration.metadata against
-- this schema; the new keys currently pass only because additionalProperties
-- defaults to true. Declaring them makes the settings survive a future
-- additionalProperties: false tightening — same reason as
-- 20260703165330_onshape-asset-sync-jsonschema.sql, which this supersedes.
--
-- Data-only: no existing row is touched. A company that has not opted in has no
-- releaseImportEnabled key at all, and its absence is indistinguishable from
-- false at every read site.
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
    "releaseImportEnabled": {
      "type": "boolean"
    },
    "releaseImportMode": {
      "type": "string",
      "enum": ["changeNotice", "revision"]
    },
    "webhookSigningSecret": {
      "type": "string"
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
