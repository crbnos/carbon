-- Populate code values for existing materialSubstance records
-- Take first two characters of name and capitalize them
UPDATE "materialSubstance"
SET "code" = UPPER(LEFT("name", 2))
WHERE "code" IS NULL;

-- Populate code values for existing materialForm records
-- Take first two characters of name and capitalize them
UPDATE "materialForm" 
SET "code" = UPPER(LEFT("name", 2))
WHERE "code" IS NULL;

-- Populate code values for existing materialType records
-- Take first two characters of name and capitalize them
UPDATE "materialType"
SET "code" = UPPER(LEFT("name", 2))
WHERE "code" IS NULL;

-- Handle any duplicates that might occur by appending numbers
-- For materialSubstance
WITH duplicates AS (
  SELECT 
    id,
    code,
    "companyId",
    ROW_NUMBER() OVER (PARTITION BY code, "companyId" ORDER BY id) as rn
  FROM "materialSubstance"
  WHERE code IS NOT NULL
)
UPDATE "materialSubstance" ms
SET code = CONCAT(d.code, d.rn - 1)
FROM duplicates d
WHERE ms.id = d.id AND d.rn > 1;

-- For materialForm
WITH duplicates AS (
  SELECT 
    id,
    code,
    "companyId",
    ROW_NUMBER() OVER (PARTITION BY code, "companyId" ORDER BY id) as rn
  FROM "materialForm"
  WHERE code IS NOT NULL
)
UPDATE "materialForm" mf
SET code = CONCAT(d.code, d.rn - 1)
FROM duplicates d
WHERE mf.id = d.id AND d.rn > 1;

-- For materialType
WITH duplicates AS (
  SELECT 
    id,
    code,
    "companyId",
    ROW_NUMBER() OVER (PARTITION BY code, "companyId" ORDER BY id) as rn
  FROM "materialType"
  WHERE code IS NOT NULL
)
UPDATE "materialType" mt
SET code = CONCAT(d.code, d.rn - 1)
FROM duplicates d
WHERE mt.id = d.id AND d.rn > 1;