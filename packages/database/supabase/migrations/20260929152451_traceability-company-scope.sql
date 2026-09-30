-- Scope the traceability traversal and job step record RPCs to one company.

DROP FUNCTION IF EXISTS get_direct_descendants_of_tracked_entities_strict(TEXT[]);
CREATE OR REPLACE FUNCTION get_direct_descendants_of_tracked_entities_strict(
    p_tracked_entity_ids TEXT[],
    p_company_id TEXT
)
RETURNS TABLE (
    "sourceEntityId" TEXT,
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        seed.id AS "sourceEntityId",
        ta."id" AS "trackedActivityId",
        te."id",
        te."readableId",
        te."quantity",
        te."status",
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM unnest(p_tracked_entity_ids) AS seed(id)
    JOIN "trackedActivityOutput" tao
        ON tao."trackedEntityId" = seed.id
        AND tao."companyId" = p_company_id
    JOIN "trackedActivityInput" tai
        ON tai."trackedActivityId" = tao."trackedActivityId"
        AND tai."companyId" = p_company_id
    LEFT JOIN "trackedActivityInput" tai2
        ON tai2."trackedActivityId" = tao."trackedActivityId"
        AND tai2."trackedEntityId" = seed.id
    JOIN "trackedEntity" te
        ON te."id" = tai."trackedEntityId"
        AND te."companyId" = p_company_id
    JOIN "trackedActivity" ta
        ON ta."id" = tai."trackedActivityId"
        AND ta."companyId" = p_company_id
    WHERE tai2."trackedEntityId" IS NULL;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS get_direct_ancestors_of_tracked_entities_strict(TEXT[]);
CREATE OR REPLACE FUNCTION get_direct_ancestors_of_tracked_entities_strict(
    p_tracked_entity_ids TEXT[],
    p_company_id TEXT
)
RETURNS TABLE (
    "sourceEntityId" TEXT,
    "trackedActivityId" TEXT,
    "id" TEXT,
    "readableId" TEXT,
    "quantity" NUMERIC,
    "status" "trackedEntityStatus",
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "activityAttributes" JSONB,
    "attributes" JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        seed.id AS "sourceEntityId",
        ta."id" AS "trackedActivityId",
        te."id",
        te."readableId",
        te."quantity",
        te."status",
        te."sourceDocument",
        te."sourceDocumentId",
        te."sourceDocumentReadableId",
        ta."attributes" AS "activityAttributes",
        te."attributes" AS "attributes"
    FROM unnest(p_tracked_entity_ids) AS seed(id)
    JOIN "trackedActivityInput" tai
        ON tai."trackedEntityId" = seed.id
        AND tai."companyId" = p_company_id
    JOIN "trackedActivityOutput" tao
        ON tao."trackedActivityId" = tai."trackedActivityId"
        AND tao."companyId" = p_company_id
    LEFT JOIN "trackedActivityOutput" tao2
        ON tao2."trackedActivityId" = tai."trackedActivityId"
        AND tao2."trackedEntityId" = seed.id
    JOIN "trackedEntity" te
        ON te."id" = tao."trackedEntityId"
        AND te."companyId" = p_company_id
    JOIN "trackedActivity" ta
        ON ta."id" = tao."trackedActivityId"
        AND ta."companyId" = p_company_id
    WHERE tao2."trackedEntityId" IS NULL;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS get_job_operation_step_records(TEXT);
CREATE OR REPLACE FUNCTION get_job_operation_step_records(
  p_job_id TEXT,
  p_company_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobOperationStepId" TEXT,
  "index" INTEGER,
  "type" "procedureStepType",
  "name" TEXT,
  "value" TEXT,
  "numericValue" NUMERIC,
  "booleanValue" BOOLEAN,
  "userValue" TEXT,
  "unitOfMeasureCode" TEXT,
  "minValue" NUMERIC,
  "maxValue" NUMERIC,
  "operationId" TEXT,
  "operationDescription" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH job_operations AS (
    SELECT
      jo."id",
      jo."description",
      jo."order",
      jo."jobMakeMethodId"
    FROM "jobOperation" jo
    WHERE jo."jobId" = p_job_id
      AND jo."companyId" = p_company_id
  ),
  job_operation_steps AS (
    SELECT
      jos."id",
      jos."type",
      jos."name",
      jos."unitOfMeasureCode",
      jos."minValue",
      jos."maxValue",
      jos."operationId",
      jo."description" as "operationDescription",
      jo."jobMakeMethodId"
    FROM "jobOperationStep" jos
    INNER JOIN job_operations jo ON jos."operationId" = jo."id"
    WHERE jos."companyId" = p_company_id
  ),
  job_items AS (
    SELECT
      jmm."id" as "makeMethodId",
      i."id" as "itemId",
      i."readableIdWithRevision" as "itemReadableId"
    FROM "jobMakeMethod" jmm
    LEFT JOIN "item" i ON jmm."parentMaterialId" = i."id" AND i."companyId" = p_company_id
    WHERE jmm."companyId" = p_company_id
  )
  SELECT
    josr."id",
    josr."jobOperationStepId",
    josr."index",
    jos."type",
    jos."name",
    josr."value",
    josr."numericValue",
    josr."booleanValue",
    josr."userValue",
    jos."unitOfMeasureCode",
    jos."minValue",
    jos."maxValue",
    jos."operationId",
    jos."operationDescription",
    ji."itemId",
    ji."itemReadableId",
    josr."companyId",
    josr."createdAt",
    josr."createdBy",
    josr."updatedAt",
    josr."updatedBy"
  FROM "jobOperationStepRecord" josr
  INNER JOIN job_operation_steps jos ON josr."jobOperationStepId" = jos."id"
  LEFT JOIN job_items ji ON jos."jobMakeMethodId" = ji."makeMethodId"
  WHERE josr."companyId" = p_company_id
  ORDER BY josr."jobOperationStepId", josr."index";
END;
$$ LANGUAGE plpgsql;
