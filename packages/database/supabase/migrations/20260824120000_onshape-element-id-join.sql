-- The Onshape integration is rebuilt around a hidden, id-based join between
-- Carbon items and Onshape elements, replacing the part-number string matching
-- it used before. There is still exactly ONE Onshape integration: the `onshape`
-- row keeps its id, so every connected company keeps its OAuth grant, its vault
-- secret bag and its registered webhook subscription. Nothing reconnects.
--
-- This rewrites that row's jsonschema to the settings the rebuilt integration
-- actually has. `credentials.required` stays `["type"]`, matching the post-vault
-- shape set by 20260817123719_integration-jsonschema-drop-secrets.sql — the
-- tokens live in Supabase Vault and are stripped from the metadata column, so
-- requiring them here would make sync_verify_integration reject every write to
-- an active row. `webhookSigningSecret` is likewise absent: it is now classified
-- as a secret and never reaches the column.
--
-- Data-only. No companyIntegration row is touched, and no onshape jsonschema has
-- ever set `additionalProperties`, so a row still carrying the retired
-- `assetSyncEnabled` / `releaseImportEnabled` / `releaseImportMode` /
-- `pipeline` / `allowUnreleasedSync` keys continues to validate. Those keys are
-- simply inert — nothing reads them any more.
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
        "expiresAt": {
          "type": "string"
        }
      },
      "required": ["type"]
    },
    "attachAssetsOnRelease": {
      "type": "boolean"
    },
    "releaseImportMode": {
      "type": "string",
      "enum": ["off", "changeNotice", "revision"]
    },
    "createItemsOnRelease": {
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

NOTIFY pgrst, 'reload schema';
