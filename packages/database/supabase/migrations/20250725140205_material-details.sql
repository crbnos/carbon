
-- Update get_material_naming_details function to use new ID-based relationships
DROP FUNCTION IF EXISTS get_material_naming_details;
CREATE OR REPLACE FUNCTION get_material_naming_details(readable_id TEXT)
RETURNS TABLE (
    "id" TEXT,
    "shape" TEXT,
    "shapeCode" TEXT,
    "substance" TEXT,
    "substanceCode" TEXT,
    "finish" TEXT,
    "grade" TEXT,
    "dimensions" TEXT,
    "materialType" TEXT,
    "materialTypeCode" TEXT
    
) AS $$
BEGIN
  RETURN QUERY SELECT
    "material"."id",
    "materialForm"."name" AS "shape",
    "materialForm"."code" AS "shapeCode",
    "materialSubstance"."name" AS "substance",
    "materialSubstance"."code" AS "substanceCode",
    "materialFinish"."name" AS "finish",
    "materialGrade"."name" AS "grade",
    "materialDimension"."name" AS "dimensions",
    "materialType"."name" AS "materialType",
    "materialType"."code" AS "materialTypeCode"
  FROM "material" LEFT JOIN "materialForm" ON "material"."materialFormId" = "materialForm"."id"
  LEFT JOIN "materialSubstance" ON "material"."materialSubstanceId" = "materialSubstance"."id"
  LEFT JOIN "materialFinish" ON "material"."finishId" = "materialFinish"."id"
  LEFT JOIN "materialGrade" ON "material"."gradeId" = "materialGrade"."id"
  LEFT JOIN "materialType" ON "material"."materialTypeId" = "materialType"."id"
  LEFT JOIN "materialDimension" ON "material"."dimensionId" = "materialDimension"."id"
  WHERE "material"."id" = readable_id;
END;
$$ LANGUAGE plpgsql STABLE;

