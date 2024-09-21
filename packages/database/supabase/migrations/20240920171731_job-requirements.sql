DROP VIEW "jobMaterialWithMakeMethodId";
ALTER TABLE "jobMaterial" 
  DROP COLUMN "productionQuantity",
  ADD COLUMN "estimatedQuantity" NUMERIC(10,4) DEFAULT 0;

CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    jm.*, 
    jmm."id" AS "jobMaterialMakeMethodId" 
  FROM "jobMaterial" jm 
  LEFT JOIN "jobMakeMethod" jmm 
    ON jmm."parentMaterialId" = jm."id";

ALTER TABLE "jobOperation"
  ADD COLUMN "operationQuantity" NUMERIC(10,4) DEFAULT 0,
  ADD COLUMN "quantityComplete" NUMERIC(10,4) DEFAULT 0,
  ADD COLUMN "quantityScrapped" NUMERIC(10,4) DEFAULT 0;


