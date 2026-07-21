-- Operation Type Consolidation
-- Spec: .ai/specs/2026-07-20-operation-type-consolidation.md
--
-- Replaces the legacy 2-value "operationType" enum (Inside/Outside) with a 4-value
-- enum (Process/Assembly/Inspection/Outside Processing) on methodOperation,
-- quoteOperation and jobOperation, and converts process."processType" to the SAME
-- enum type so the two can never drift (the 3-value "processType" enum is dropped).
--
-- Data mapping:
--   operations: 'Inside' -> 'Process', 'Outside' -> 'Outside Processing'
--   process:    'Inside' -> 'Process', 'Outside' and 'Inside and Outside' -> 'Outside Processing'
--
-- Business-logic invariant downstream: subcontract behavior keys on
-- operationType = 'Outside Processing'; in-house behavior keys on
-- operationType <> 'Outside Processing' (never an enumeration of in-house values),
-- so future in-house types inherit costing/scheduling/PO behavior unchanged.
--
-- Every step is guarded so a deploy-runner retry over partially-committed state is
-- a no-op for the parts that already ran.

-- 1. Swap the enum: rename the legacy type aside and create the new 4-value type
--    under the same name. Skipped when the new type already exists (retry).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'operationType' AND e.enumlabel = 'Process'
  ) THEN
    ALTER TYPE "operationType" RENAME TO "operationType__old";
    CREATE TYPE "operationType" AS ENUM ('Process', 'Assembly', 'Inspection', 'Outside Processing');
  END IF;
END $$;

-- 2. Drop the views that project these columns (all recreated below, forked from
--    their newest definitions).
DROP VIEW IF EXISTS "jobOperationsWithMakeMethods";
DROP VIEW IF EXISTS "jobOperationsWithDependencies";
DROP VIEW IF EXISTS "quoteOperationsWithMakeMethods";
DROP VIEW IF EXISTS "processes";

-- 3. Convert the three operation tables. Each block is guarded on the column still
--    being the legacy type, so a retry skips already-converted tables.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'methodOperation'
      AND column_name = 'operationType' AND udt_name = 'operationType__old'
  ) THEN
    ALTER TABLE "methodOperation" ALTER COLUMN "operationType" DROP DEFAULT;
    ALTER TABLE "methodOperation" ALTER COLUMN "operationType" TYPE "operationType"
      USING (CASE WHEN "operationType"::text = 'Outside' THEN 'Outside Processing' ELSE 'Process' END)::"operationType";
    ALTER TABLE "methodOperation" ALTER COLUMN "operationType" SET DEFAULT 'Process';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'quoteOperation'
      AND column_name = 'operationType' AND udt_name = 'operationType__old'
  ) THEN
    ALTER TABLE "quoteOperation" ALTER COLUMN "operationType" DROP DEFAULT;
    ALTER TABLE "quoteOperation" ALTER COLUMN "operationType" TYPE "operationType"
      USING (CASE WHEN "operationType"::text = 'Outside' THEN 'Outside Processing' ELSE 'Process' END)::"operationType";
    ALTER TABLE "quoteOperation" ALTER COLUMN "operationType" SET DEFAULT 'Process';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobOperation'
      AND column_name = 'operationType' AND udt_name = 'operationType__old'
  ) THEN
    ALTER TABLE "jobOperation" ALTER COLUMN "operationType" DROP DEFAULT;
    ALTER TABLE "jobOperation" ALTER COLUMN "operationType" TYPE "operationType"
      USING (CASE WHEN "operationType"::text = 'Outside' THEN 'Outside Processing' ELSE 'Process' END)::"operationType";
    ALTER TABLE "jobOperation" ALTER COLUMN "operationType" SET DEFAULT 'Process';
  END IF;
END $$;

-- 4. Convert process."processType" to the same enum. A process's type is the
--    default operationType for operations that use it; capability ("Inside and
--    Outside") now lives in workCenterProcess / supplierProcess rows, not the enum.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'process'
      AND column_name = 'processType' AND udt_name = 'processType'
  ) THEN
    ALTER TABLE "process" ALTER COLUMN "processType" DROP DEFAULT;
    ALTER TABLE "process" ALTER COLUMN "processType" TYPE "operationType"
      USING (CASE WHEN "processType"::text = 'Inside' THEN 'Process' ELSE 'Outside Processing' END)::"operationType";
    ALTER TABLE "process" ALTER COLUMN "processType" SET DEFAULT 'Process';
  END IF;
END $$;

-- 5. Re-bind get_job_operation_by_id to the new enum. The prior definition's
--    RETURNS TABLE references the legacy type, which would block DROP TYPE below.
DROP FUNCTION IF EXISTS get_job_operation_by_id(TEXT);
CREATE OR REPLACE FUNCTION get_job_operation_by_id(operation_id TEXT)
RETURNS TABLE (
  id TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  description TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "parentMaterialId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "itemUnitOfMeasure" TEXT,
  "itemModelPath" TEXT,
  "itemModelId" TEXT,
  "itemModelName" TEXT,
  "itemModelSize" BIGINT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "workInstruction" JSON,
  "operationDueDate" DATE,
  "reworkId" TEXT,
  "operationType" "operationType"
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    jo."id",
    jo."jobId",
    jo."jobMakeMethodId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate"::DATE AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    jmm."parentMaterialId",
    i."id" as "itemId",
    i."readableIdWithRevision" as "itemReadableId",
    i."name" as "itemDescription",
    uom."name" as "itemUnitOfMeasure",
    m."modelPath" as "itemModelPath",
    m."id" as "itemModelId",
    m."name" as "itemModelName",
    m."size" as "itemModelSize",
    jo."status" AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    jo."workInstruction",
    jo."dueDate" AS "operationDueDate",
    jo."reworkId",
    jo."operationType"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "unitOfMeasure" uom ON i."unitOfMeasureCode" = uom."code" AND i."companyId" = uom."companyId"
  LEFT JOIN "modelUpload" m ON i."modelUploadId" = m.id
  WHERE jo.id = operation_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- 6. Drop the retired types. Nothing references them anymore: columns are
--    converted and the RPC above was recreated against the new type.
DROP TYPE IF EXISTS "operationType__old";
DROP TYPE IF EXISTS "processType";

-- 7. Recreate the dropped views, forked verbatim from their newest definitions
--    (20260610151942_assembly-instructions.sql for the two job views,
--    20250603011801_make-method-version.sql for the quote view,
--    20260120171236_process-active-column.sql for processes).
CREATE OR REPLACE VIEW "jobOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT
    mm.id AS "makeMethodId",
    jo.*
  FROM "jobOperation" jo
  INNER JOIN "jobMakeMethod" jmm
    ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "makeMethod" mm
    ON jmm."itemId" = mm."itemId" AND jmm."version" = mm."version";

CREATE OR REPLACE VIEW "jobOperationsWithDependencies"
WITH (security_invoker = true)
AS
SELECT
  jo.*,
  COALESCE(
    (
      SELECT array_agg(jod."dependsOnId")
      FROM "jobOperationDependency" jod
      WHERE jod."operationId" = jo.id
    ),
    '{}'::text[]
  ) AS "dependencies"
FROM "jobOperation" jo;

CREATE OR REPLACE VIEW "quoteOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT
    mm.id AS "makeMethodId",
    qo.*
  FROM "quoteOperation" qo
  INNER JOIN "quoteMakeMethod" qmm
    ON qo."quoteMakeMethodId" = qmm.id
  LEFT JOIN "makeMethod" mm
    ON qmm."itemId" = mm."itemId" AND qmm."version" = mm."version";

CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    wcp."workCenters",
    sp."suppliers"
  FROM "process" p
  LEFT JOIN (
    SELECT
      "processId",
      array_agg("workCenterId"::text) as "workCenters"
    FROM "workCenterProcess" wcp
    INNER JOIN "workCenter" wc ON wcp."workCenterId" = wc.id
    GROUP BY "processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT
      "processId",
      jsonb_agg(jsonb_build_object('id', sp."id", 'name', s.name)) as "suppliers"
    FROM "supplierProcess" sp
    INNER JOIN "supplier" s ON sp."supplierId" = s.id
    GROUP BY "processId"
  ) sp ON p.id = sp."processId";

-- 8. Re-land get_method_tree. Main's 20260714084035_remove-bom-line-effectivity.sql
--    redefined it NEWER than this branch's squashed 20260705143722 (which added the
--    methodOperationStepIds step links), so in timestamp order the step links would
--    be silently reverted on deploy. This definition is main's newest body (no BOM
--    line effectivity) merged with the branch's methodOperationStepIds additions.
DROP FUNCTION IF EXISTS get_method_tree(TEXT);
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
        NULL AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "storageUnitIds",
        false AS "isPickDescendant"
    FROM
        "methodMaterial"
    WHERE
        "makeMethodId" = uid
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
        "methodMaterial" child
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
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
  cost."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  (
    SELECT COALESCE(jsonb_agg(mms."methodOperationStepId"), '[]'::jsonb)
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
INNER JOIN item
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
INNER JOIN "makeMethod" mm
  ON material."makeMethodId" = mm.id
LEFT JOIN "makeMethod" mm2
  ON material."materialMakeMethodId" = mm2.id
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
