-- Onshape v2 ships as its own integration record rather than as a pipeline
-- selected inside `onshape`. One OAuth application is shared between the two;
-- everything else — settings, credentials, webhook subscription, routes and jobs
-- — is separate, so neither record can change the other's behaviour.
--
-- INSERT, never UPDATE of the existing id: companyIntegration_id_fkey is
-- ON UPDATE CASCADE (20240119095150_integrations.sql:35), so renaming
-- integration.id would cascade into companyIntegration.id and re-validate every
-- affected row against the new schema. 20260410040000_email-smtp-support.sql
-- documents that trap.
--
-- The `onshape` row is deliberately untouched by this migration and stays
-- byte-identical to what main ships.
--
-- Schema notes:
--   * `credentials.required` is ["type"] only, matching the post-vault shape set
--     by 20260817123719_integration-jsonschema-drop-secrets.sql. accessToken and
--     refreshToken live in Supabase Vault and are stripped from the metadata
--     column, so requiring them here would make sync_verify_integration reject
--     every write to an active row.
--   * `webhookSigningSecret` is NOT declared, for the same reason: it is
--     classified as a secret and never persists to the metadata column.
--   * No `additionalProperties: false` — consistent with every other onshape
--     jsonschema. The declarations document the settings; they do not enforce.
INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('onshape-v2', '{
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
      "onshapeCompanyId": {
        "type": "string"
      },
      "scope": {
        "type": "string"
      }
    },
    "required": ["baseUrl", "credentials"]
  }'::json)
ON CONFLICT ("id") DO NOTHING;

NOTIFY pgrst, 'reload schema';
