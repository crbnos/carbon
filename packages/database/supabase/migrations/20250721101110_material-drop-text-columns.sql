-- Drop the old unique constraint that includes the text columns
ALTER TABLE "material" DROP CONSTRAINT "material_unique";

-- Create new unique constraint with the ID columns
ALTER TABLE "material" ADD CONSTRAINT "material_unique" 
  UNIQUE ("materialFormId", "materialSubstanceId", "gradeId", "dimensionId", "finishId", "companyId");

-- Drop the old text columns
ALTER TABLE "material" 
  DROP COLUMN "dimensions",
  DROP COLUMN "finish",
  DROP COLUMN "grade";

-- Update the materials view if it exists
DROP VIEW IF EXISTS "materials";

CREATE OR REPLACE VIEW "materials" WITH(SECURITY_INVOKER=true) AS
  SELECT
    m."id",
    m."materialFormId",
    m."materialSubstanceId",
    m."dimensionId",
    m."finishId",
    m."gradeId",
    m."approved",
    m."approvedBy",
    m."customFields",
    m."companyId",
    m."createdBy",
    m."createdAt",
    m."updatedBy",
    m."updatedAt",
    m."tags",
    mf."name" AS "formName",
    ms."name" AS "substanceName",
    md."name" AS "dimensions",
    mfin."name" AS "finish",
    mg."name" AS "grade"
  FROM "material" m
  LEFT JOIN "materialForm" mf ON m."materialFormId" = mf."id"
  LEFT JOIN "materialSubstance" ms ON m."materialSubstanceId" = ms."id"
  LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
  LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin."id"
  LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id";