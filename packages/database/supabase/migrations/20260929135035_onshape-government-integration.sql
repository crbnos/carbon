-- Onshape Government: a second Onshape integration for the ITAR / FedRAMP
-- edition, which has no public App Store. The customer creates a private OAuth
-- app inside their own Enterprise and enters it in the integration settings, so
-- the connection is configured (baseUrl / oauthUrl / clientId, secret in Vault)
-- BEFORE it is authorized — `credentials` is therefore not required, unlike the
-- public `onshape` row. Everything after authorization is the same runtime.
--
-- companyIntegration.id has an FK to integration.id, so installing fails
-- without this row. Secrets (clientSecret, credentials.accessToken,
-- credentials.refreshToken) are split to Vault and never reach this column.
INSERT INTO "integration" ("id", "jsonschema")
VALUES (
  'onshape-government',
  '{
    "type": "object",
    "properties": {
      "baseUrl": {"type": "string"},
      "oauthUrl": {"type": "string"},
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
    "required": ["baseUrl", "oauthUrl", "clientId"]
  }'::json
)
ON CONFLICT ("id") DO NOTHING;
