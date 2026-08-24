-- NIST 800-171 3.13.16: secrets no longer live in companyIntegration.metadata
-- (they move to the vault), so drop them from each integration's jsonschema —
-- otherwise verify_integration() would reject the now-secret-free metadata for
-- active integrations. Only the config remainder is validated here; secret
-- presence is enforced in the app. Idempotent (guarded by id; UPDATE is a no-op
-- if the row is absent).

-- linear: only had apiKey.
UPDATE "integration"
SET "jsonschema" = '{"type":"object","properties":{}}'::json
WHERE id = 'linear';

-- paperless-parts: only had apiKey + secretKey.
UPDATE "integration"
SET "jsonschema" = '{"type":"object","properties":{}}'::json
WHERE id = 'paperless-parts';

-- slack: drop access_token, keep all non-secret channel/team config.
UPDATE "integration"
SET "jsonschema" = '{
  "type": "object",
  "properties": {
    "url": {"type": "string"},
    "channel": {"type": "string"},
    "team_id": {"type": "string"},
    "team_name": {"type": "string"},
    "channel_id": {"type": "string"},
    "bot_user_id": {"type": "string"},
    "slack_configuration_url": {"type": "string"},
    "nonconformance_channel_id": {"type": "string", "description": "Default Slack channel for non-conformance notifications"},
    "nonconformance_notifications_enabled": {"type": "boolean", "default": true, "description": "Enable automatic Slack notifications for non-conformances"}
  }
}'::json
WHERE id = 'slack';

-- onshape: drop credentials.accessToken/refreshToken; keep type + expiresAt.
UPDATE "integration"
SET "jsonschema" = '{
  "type": "object",
  "properties": {
    "baseUrl": {"type": "string"},
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
  "required": ["baseUrl", "credentials"]
}'::json
WHERE id = 'onshape';

NOTIFY pgrst, 'reload schema';
