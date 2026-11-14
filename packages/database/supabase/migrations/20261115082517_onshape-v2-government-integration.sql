-- Onshape V2 Government: the panel for the ITAR / FedRAMP edition, which has no
-- public App Store. As with `onshape-government`, the customer's private OAuth
-- app (carrying the panel extension) is entered in the settings before it is
-- authorized, so `credentials` is not required. Secrets (clientSecret and the
-- tokens) are split to Vault and never reach this column.
INSERT INTO "integration" ("id", "jsonschema")
VALUES (
  'onshape-v2-government',
  '{
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
      "scope": {"type": "string"},
      "onshapeCompanyId": {"type": "string"},
      "propertyMap": {"type": "array"},
      "defaultUnitOfMeasureCode": {"type": "string"},
      "defaultReplenishmentSystem": {"type": "string"},
      "defaultMethodTypeForMake": {"type": "string"},
      "defaultMethodTypeForBuy": {"type": "string"},
      "defaultItemTrackingType": {"type": "string"}
    },
    "required": ["baseUrl", "clientId"]
  }'::json
)
ON CONFLICT ("id") DO NOTHING;
