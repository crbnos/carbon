-- Backfill: create Asset Class dimension for every company group
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Asset Class', 'FixedAssetClass'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;
