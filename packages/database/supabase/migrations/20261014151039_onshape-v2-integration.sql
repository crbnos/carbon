-- `onshape-v2`: the push-only panel integration, with its own OAuth grant,
-- companyIntegration row and mapping namespace beside `onshape`.
-- `baseUrl` is optional: the client defaults it to cad.onshape.com.
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
