-- Corrections: rework-only routings on a make method. A correction is a
-- sequence of one or more operations (with steps, tools, parameters) and
-- materials that normal units never run. A step result can suggest one: a List
-- or Inspection value, or a Measurement below its minimum / above its maximum.
-- Spec: .ai/specs/2026-11-10-conditional-corrections.md
--
-- Correction operations and materials live in methodOperation / methodMaterial
-- with methodCorrectionId set. Every reader of the normal routing and bill of
-- materials excludes those rows.

CREATE TYPE "correctionReturnTo" AS ENUM ('Re-inspect', 'Continue');
CREATE TYPE "correctionMeasurementCondition" AS ENUM (
  'Below Minimum',
  'Above Maximum'
);

CREATE TABLE "methodCorrection" (
    "id" TEXT NOT NULL DEFAULT id('mcor'),
    "companyId" TEXT NOT NULL,
    "makeMethodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "returnTo" "correctionReturnTo" NOT NULL DEFAULT 'Re-inspect',
    -- How many times one unit may use this correction; NULL = no limit.
    "maxAttempts" INTEGER CHECK ("maxAttempts" IS NULL OR "maxAttempts" > 0),
    "order" DOUBLE PRECISION NOT NULL DEFAULT 1,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("makeMethodId") REFERENCES "makeMethod"("id") ON DELETE CASCADE
);

CREATE INDEX "methodCorrection_makeMethodId_idx" ON "methodCorrection" ("makeMethodId");
CREATE INDEX "methodCorrection_companyId_idx" ON "methodCorrection" ("companyId");
CREATE INDEX "methodCorrection_createdBy_idx" ON "methodCorrection" ("createdBy");

ALTER TABLE "methodCorrection" ADD CONSTRAINT "methodCorrection_makeMethodId_name_key"
    UNIQUE ("makeMethodId", "name");

-- Correction operations and materials.
ALTER TABLE "methodOperation" ADD COLUMN "methodCorrectionId" TEXT;
ALTER TABLE "methodOperation" ADD CONSTRAINT "methodOperation_methodCorrectionId_fkey"
    FOREIGN KEY ("methodCorrectionId", "companyId")
    REFERENCES "methodCorrection"("id", "companyId") ON DELETE CASCADE;
CREATE INDEX "methodOperation_methodCorrectionId_idx" ON "methodOperation" ("methodCorrectionId");

ALTER TABLE "methodMaterial" ADD COLUMN "methodCorrectionId" TEXT;
ALTER TABLE "methodMaterial" ADD CONSTRAINT "methodMaterial_methodCorrectionId_fkey"
    FOREIGN KEY ("methodCorrectionId", "companyId")
    REFERENCES "methodCorrection"("id", "companyId") ON DELETE CASCADE;
CREATE INDEX "methodMaterial_methodCorrectionId_idx" ON "methodMaterial" ("methodCorrectionId");

-- A step result that suggests a correction. Exactly one of listValue (List /
-- Inspection steps) and measurementCondition (Measurement steps) is set, and a
-- result suggests at most one correction.
CREATE TABLE "methodCorrectionTrigger" (
    "id" TEXT NOT NULL DEFAULT id('mctr'),
    "companyId" TEXT NOT NULL,
    "methodOperationStepId" TEXT NOT NULL,
    "methodCorrectionId" TEXT NOT NULL,
    "listValue" TEXT,
    "measurementCondition" "correctionMeasurementCondition",

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("methodOperationStepId") REFERENCES "methodOperationStep"("id") ON DELETE CASCADE,
    FOREIGN KEY ("methodCorrectionId", "companyId")
        REFERENCES "methodCorrection"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "methodCorrectionTrigger_one_result_check"
        CHECK (("listValue" IS NULL) <> ("measurementCondition" IS NULL))
);

CREATE INDEX "methodCorrectionTrigger_methodCorrectionId_idx" ON "methodCorrectionTrigger" ("methodCorrectionId");
CREATE INDEX "methodCorrectionTrigger_companyId_idx" ON "methodCorrectionTrigger" ("companyId");
CREATE INDEX "methodCorrectionTrigger_createdBy_idx" ON "methodCorrectionTrigger" ("createdBy");
CREATE UNIQUE INDEX "methodCorrectionTrigger_step_listValue_key"
    ON "methodCorrectionTrigger" ("methodOperationStepId", "listValue")
    WHERE "listValue" IS NOT NULL;
CREATE UNIQUE INDEX "methodCorrectionTrigger_step_measurement_key"
    ON "methodCorrectionTrigger" ("methodOperationStepId", "measurementCondition")
    WHERE "measurementCondition" IS NOT NULL;

-- get_method_tree is the bill of materials for costing, job and quote creation
-- and the configurator: correction materials are not part of it. Forked from
-- 20261003022837_method-lookup-performance.sql; only the two
-- "methodCorrectionId" IS NULL filters are new.
CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "unitCost" NUMERIC,
    "quantity" NUMERIC,
    "methodType" "methodType",
    "itemTrackingType" TEXT,
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "methodOperationStepIds" JSONB,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "externalId" JSONB,
    "version" NUMERIC,
    "storageUnitIds" JSONB,
    "isPickDescendant" BOOLEAN,
    "replenishmentSystem" "itemReplenishmentSystem"
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "id",
        "makeMethodId",
        "methodType",
        COALESCE(
            "materialMakeMethodId",
            CASE WHEN "methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = "methodMaterial"."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        "itemId",
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        "methodOperationId" AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "storageUnitIds",
        false AS "isPickDescendant"
    FROM
        "methodMaterial"
    WHERE
        "makeMethodId" = uid
        AND "methodCorrectionId" IS NULL
    UNION
    SELECT
        child."id",
        child."makeMethodId",
        child."methodType",
        COALESCE(
            child."materialMakeMethodId",
            CASE WHEN child."methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = child."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."order",
        child."kit",
        child."storageUnitIds",
        (parent."methodType" = 'Pull from Inventory' OR parent."isPickDescendant") AS "isPickDescendant"
    FROM
        material parent
        CROSS JOIN LATERAL (
            SELECT * FROM "methodMaterial" c
            WHERE c."makeMethodId" = parent."materialMakeMethodId"
              AND c."methodCorrectionId" IS NULL
            OFFSET 0
        ) child
)
SELECT
  material.id as "methodMaterialId",
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  material."itemType",
  item."name" AS "description",
  item."unitOfMeasureCode",
  item."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', mms."methodOperationStepId", 'quantity', mms."quantity")), '[]'::jsonb)
    FROM "methodMaterialStep" mms
    WHERE mms."methodMaterialId" = material.id
  ) AS "methodOperationStepIds",
  false AS "isRoot",
  material."kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm2."version",
  material."storageUnitIds",
  material."isPickDescendant",
  item."replenishmentSystem"
FROM material
CROSS JOIN LATERAL (
  SELECT item.id, item."readableIdWithRevision", item."name", item."unitOfMeasureCode",
    item."itemTrackingType", item."revision", item."replenishmentSystem", cost."unitCost"
  FROM item
  INNER JOIN "itemCost" cost ON item.id = cost."itemId"
  WHERE item.id = material."itemId"
  OFFSET 0
) item
CROSS JOIN LATERAL (
  SELECT mm.id FROM "makeMethod" mm WHERE mm.id = material."makeMethodId" OFFSET 0
) mm
LEFT JOIN LATERAL (
  SELECT mm2."version" FROM "makeMethod" mm2 WHERE mm2.id = material."materialMakeMethodId" OFFSET 0
) mm2 ON true
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  'Make to Order' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  '[]'::jsonb AS "methodOperationStepIds",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm."version",
  '{}'::JSONB AS "storageUnitIds",
  false AS "isPickDescendant",
  item."replenishmentSystem"
FROM "makeMethod" mm
INNER JOIN item
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;
