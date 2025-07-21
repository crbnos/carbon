-- Migrate dimension data
-- First, insert any company-specific dimensions that don't exist in the global table
INSERT INTO "materialDimension" ("materialFormId", "name", "companyId")
SELECT DISTINCT 
  m."materialFormId",
  m."dimensions",
  m."companyId"
FROM "material" m
WHERE m."dimensions" IS NOT NULL
  AND m."companyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 
    FROM "materialDimension" md 
    WHERE md."name" = m."dimensions" 
      AND md."companyId" IS NULL
      AND md."materialFormId" = m."materialFormId"
  )
  AND NOT EXISTS (
    SELECT 1 
    FROM "materialDimension" md 
    WHERE md."name" = m."dimensions" 
      AND md."companyId" = m."companyId"
      AND md."materialFormId" = m."materialFormId"
  );

-- Update material dimensionId to use global entries where they exist, otherwise company-specific
UPDATE "material" m
SET "dimensionId" = COALESCE(
  -- First try to find a global entry (companyId = null)
  (SELECT md."id" 
   FROM "materialDimension" md 
   WHERE md."name" = m."dimensions" 
     AND md."companyId" IS NULL
     AND md."materialFormId" = m."materialFormId"
   LIMIT 1),
  -- If no global entry, use company-specific
  (SELECT md."id" 
   FROM "materialDimension" md 
   WHERE md."name" = m."dimensions" 
     AND md."companyId" = m."companyId"
     AND md."materialFormId" = m."materialFormId"
   LIMIT 1)
)
WHERE m."dimensions" IS NOT NULL;

-- Migrate finish data
-- First, insert any company-specific finishes that don't exist in the global table
INSERT INTO "materialFinish" ("materialSubstanceId", "name", "companyId")
SELECT DISTINCT 
  m."materialSubstanceId",
  m."finish",
  m."companyId"
FROM "material" m
WHERE m."finish" IS NOT NULL
  AND m."companyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 
    FROM "materialFinish" mf 
    WHERE mf."name" = m."finish" 
      AND mf."companyId" IS NULL
      AND mf."materialSubstanceId" = m."materialSubstanceId"
  )
  AND NOT EXISTS (
    SELECT 1 
    FROM "materialFinish" mf 
    WHERE mf."name" = m."finish" 
      AND mf."companyId" = m."companyId"
      AND mf."materialSubstanceId" = m."materialSubstanceId"
  );

-- Update material finishId to use global entries where they exist, otherwise company-specific
UPDATE "material" m
SET "finishId" = COALESCE(
  -- First try to find a global entry (companyId = null)
  (SELECT mf."id" 
   FROM "materialFinish" mf 
   WHERE mf."name" = m."finish" 
     AND mf."companyId" IS NULL
     AND mf."materialSubstanceId" = m."materialSubstanceId"
   LIMIT 1),
  -- If no global entry, use company-specific
  (SELECT mf."id" 
   FROM "materialFinish" mf 
   WHERE mf."name" = m."finish" 
     AND mf."companyId" = m."companyId"
     AND mf."materialSubstanceId" = m."materialSubstanceId"
   LIMIT 1)
)
WHERE m."finish" IS NOT NULL;

-- Migrate grade data
-- First, insert any company-specific grades that don't exist in the global table
INSERT INTO "materialGrade" ("materialSubstanceId", "name", "companyId")
SELECT DISTINCT 
  m."materialSubstanceId",
  m."grade",
  m."companyId"
FROM "material" m
WHERE m."grade" IS NOT NULL
  AND m."companyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 
    FROM "materialGrade" mg 
    WHERE mg."name" = m."grade" 
      AND mg."companyId" IS NULL
      AND mg."materialSubstanceId" = m."materialSubstanceId"
  )
  AND NOT EXISTS (
    SELECT 1 
    FROM "materialGrade" mg 
    WHERE mg."name" = m."grade" 
      AND mg."companyId" = m."companyId"
      AND mg."materialSubstanceId" = m."materialSubstanceId"
  );

-- Update material gradeId to use global entries where they exist, otherwise company-specific
UPDATE "material" m
SET "gradeId" = COALESCE(
  -- First try to find a global entry (companyId = null)
  (SELECT mg."id" 
   FROM "materialGrade" mg 
   WHERE mg."name" = m."grade" 
     AND mg."companyId" IS NULL
     AND mg."materialSubstanceId" = m."materialSubstanceId"
   LIMIT 1),
  -- If no global entry, use company-specific
  (SELECT mg."id" 
   FROM "materialGrade" mg 
   WHERE mg."name" = m."grade" 
     AND mg."companyId" = m."companyId"
     AND mg."materialSubstanceId" = m."materialSubstanceId"
   LIMIT 1)
)
WHERE m."grade" IS NOT NULL;