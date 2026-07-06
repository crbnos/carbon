INSERT INTO "fixedAssetClass" (
  "name", "depreciationMethod", "usefulLifeMonths", "residualValuePercent",
  "assetAccountId", "accumulatedDepreciationAccountId",
  "depreciationExpenseAccountId", "writeOffAccountId",
  "writeDownAccountId", "disposalAccountId",
  "companyId", "createdBy"
)
SELECT
  cls.name,
  'Straight Line'::"depreciationMethod",
  cls.useful_life_months,
  0,
  a_asset.id,
  a1330.id,
  a6310.id,
  a6320.id,
  a6320.id,
  a6320.id,
  c.id,
  'system'
FROM "company" c
CROSS JOIN (
  VALUES
    ('Buildings', 468, '1360'),
    ('Machinery & Equipment', 120, '1350'),
    ('Vehicles', 60, '1310')
) AS cls(name, useful_life_months, asset_account_number)
JOIN "account" a_asset
  ON a_asset."companyGroupId" = c."companyGroupId"
  AND a_asset."number" = cls.asset_account_number
JOIN "account" a1330
  ON a1330."companyGroupId" = c."companyGroupId"
  AND a1330."number" = '1330'
JOIN "account" a6310
  ON a6310."companyGroupId" = c."companyGroupId"
  AND a6310."number" = '6310'
JOIN "account" a6320
  ON a6320."companyGroupId" = c."companyGroupId"
  AND a6320."number" = '6320'
WHERE c."isEliminationEntity" IS NOT TRUE
ON CONFLICT ("name", "companyId") DO NOTHING;
