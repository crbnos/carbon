-- Declare `createItemsOnRelease` in the onshape integration jsonschema.
--
-- Supersedes 20260818094500_onshape-v2-jsonschema.sql wholesale rather than
-- patching it, which is the established chain for this row
-- (20260703165330 -> 20260817155435 -> 20260818094500 -> this).
--
-- Data-only and safe for every existing install: `required` stays
-- ["baseUrl", "credentials"], every settings key remains optional, and no
-- companyIntegration row is touched. An absent `createItemsOnRelease` reads as
-- FALSE at every site (strict `=== true`), so nothing starts minting parts on
-- deploy.
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
    "createItemsOnRelease": {
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
