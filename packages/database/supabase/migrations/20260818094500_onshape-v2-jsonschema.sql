-- Declare the Onshape v2 pipeline settings in the onshape integration jsonschema.
-- The verify_integration() trigger validates companyIntegration.metadata against
-- this schema; declaring the keys makes them survive a future
-- additionalProperties: false tightening — same reason as
-- 20260817155435_onshape-release-import-jsonschema.sql, which this supersedes.
--
-- Data-only and safe for every existing install: `required` stays
-- ["baseUrl", "credentials"], every settings key remains optional, and
-- additionalProperties still defaults to true. No companyIntegration row is
-- touched. A company that has not opted in has no `pipeline` key at all, and
-- every v2 read site tests `pipeline === "next"` strictly, so its absence means
-- the legacy pipeline BY CONSTRUCTION rather than by a default value.
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
    "pipeline": {
      "type": "string",
      "enum": ["legacy", "next"]
    },
    "attachAssetsOnRelease": {
      "type": "boolean"
    },
    "releaseImportV2": {
      "type": "string",
      "enum": ["off", "changeNotice", "revision"]
    },
    "allowUnreleasedSync": {
      "type": "boolean"
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
