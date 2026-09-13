-- The Onshape panel becomes its own integration, alongside the original.
--
-- `onshape` stays the pull-shaped one (released-asset webhook sync).
-- `onshape-v2` is the push-only panel: its own OAuth grant, its own
-- companyIntegration row, and its own externalIntegrationMapping namespace, so
-- a company can install either or both and uninstalling one never disturbs the
-- other. companyIntegration.id is a foreign key to this table, so the row has
-- to exist before anyone can install it.
--
-- The pair is expected to be temporary while v2 replaces v1.
--
-- `credentials` is required and `baseUrl` is not: the OAuth callback always
-- writes both, but the panel defaults the base URL to cad.onshape.com, and a
-- company that has saved push defaults without ever connecting is a legitimate
-- state — the settings form writes metadata before any grant exists.
INSERT INTO "integration" ("id", "jsonschema")
VALUES
  (
    'onshape-v2',
    '{
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
        "scope": {"type": "string"},
        "propertyMap": {"type": "array"},
        "defaultUnitOfMeasureCode": {"type": "string"},
        "defaultReplenishmentSystem": {"type": "string"},
        "defaultMethodTypeForMake": {"type": "string"},
        "defaultMethodTypeForBuy": {"type": "string"},
        "defaultItemTrackingType": {"type": "string"}
      },
      "required": ["credentials"]
    }'::json
  )
ON CONFLICT ("id") DO NOTHING;
