-- Orderful secrets (apiKey/webhookSecret) move to Supabase Vault per the
-- integration-secret model (20260817122916); drop them from the integration's
-- jsonschema so verify_integration() accepts the secret-free metadata the
-- vault write path leaves in the plaintext column. Mirrors
-- 20260817123719_integration-jsonschema-drop-secrets.sql for the integrations
-- that predated the vault. The @carbon/ee SECRET_KEYS map carries the
-- matching `orderful: ["apiKey", "webhookSecret"]` entry.
--
-- No companyIntegration backfill is needed: the orderful integration ships on
-- this branch, so no production rows exist before this migration runs.

UPDATE "integration"
SET "jsonschema" = '{
  "type": "object",
  "properties": {
    "environment": { "type": "string", "enum": ["sandbox", "production"] }
  }
}'::json
WHERE "id" = 'orderful';
