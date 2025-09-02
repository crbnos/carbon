INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('radan', '{"type": "object", "properties": {"processes": {"type": "array", "items": {"type": "string"}}}}'::json);

DROP FUNCTION IF EXISTS get_radan_v1;
CREATE OR REPLACE FUNCTION get_radan_v1(
  company_id TEXT,
  processes TEXT[]
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "priority" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobMakeMethodId" TEXT,
  "assignee" TEXT,
  "tags" TEXT[],
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "jobCustomerId" TEXT,
  "jobLocationName" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "parentMaterialId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityScrapped" NUMERIC,
  "materialItemReadableId" TEXT,
  "materialItemDescription" TEXT,
  "materialSubstance" TEXT,
  "materialForm" TEXT,
  "materialDimension" TEXT,
  "materialFinish" TEXT,
  "materialGrade" TEXT
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT
      j."id",
      j."jobId",
      j."status",
      j."dueDate",
      j."deadlineType",
      j."customerId",
      l."name" AS "locationName",
      so."salesOrderId" AS "salesOrderReadableId",
      so."id" AS "salesOrderId",
      j."salesOrderLineId"
      
    FROM "job" j
    LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
    LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
    LEFT JOIN "location" l ON l."id" = j."locationId"
    WHERE l."companyId" = company_id
    AND (j."status" = 'Ready' OR j."status" = 'In Progress' OR j."status" = 'Paused')
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
    jo."priority",
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
    jo."jobMakeMethodId",
    jo."assignee",
    jo."tags",
    rj."jobId" AS "jobReadableId",
    rj."status" AS "jobStatus",
    rj."dueDate" AS "jobDueDate",
    rj."deadlineType" AS "jobDeadlineType",
    rj."customerId" AS "jobCustomerId",
    rj."locationName" AS "jobLocationName",
    rj."salesOrderReadableId",
    rj."salesOrderId",
    rj."salesOrderLineId",
    jmm."parentMaterialId",
    i."id" AS "itemId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN rj."status" = 'Paused' THEN 'Paused'::"jobOperationStatus"
      ELSE jo."status"
    END AS "operationStatus",
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    fm."materialItemReadableId" as "materialItemReadableId",
    fm."materialItemDescription" as "materialItemDescription",
    fm."materialSubstance" as "materialSubstance",
    fm."materialForm" as "materialForm",
    fm."materialDimension" as "materialDimension",
    fm."materialFinish" as "materialFinish",
    fm."materialGrade" as "materialGrade"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN (
    SELECT 
      jm."jobMakeMethodId",
      jm."itemId" AS "materialItemId",
      mi."readableId" AS "materialItemReadableId",
      mi."name" AS "materialItemDescription",
      ms."name" AS "materialSubstance",
      mf."name" AS "materialForm",
      md."name" AS "materialDimension",
      mf2."name" AS "materialFinish",
      mg."name" AS "materialGrade"
    FROM (
      SELECT DISTINCT ON (jm."jobMakeMethodId")
        jm."jobMakeMethodId",
        jm."itemId",
        jm."id"
      FROM "jobMaterial" jm
      WHERE jm."itemType" = 'Material'
      AND jm."jobMakeMethodId" IN (
        SELECT DISTINCT jo."jobMakeMethodId"
        FROM "jobOperation" jo
        JOIN relevant_jobs rj ON rj.id = jo."jobId"
        WHERE jo."status" != 'Done' 
        AND jo."status" != 'Canceled'
        AND CASE
          WHEN array_length(processes, 1) > 0 THEN 
            jo."processId" = ANY(processes)
          ELSE true
        END
      )
      ORDER BY jm."jobMakeMethodId", jm."order" DESC
      LIMIT 1
    ) jm
    INNER JOIN "item" mi ON mi."id" = jm."itemId"
    LEFT JOIN "material" m ON m."id" = mi."readableId"
    LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
    LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
    LEFT JOIN "materialDimension" md ON md."id" = m."dimensionId"
    LEFT JOIN "materialFinish" mf2 ON mf2."id" = m."finishId"
    LEFT JOIN "materialGrade" mg ON mg."id" = m."gradeId"
  ) fm ON fm."jobMakeMethodId" = jmm."id"
  INNER JOIN "item" i ON jmm."itemId" = i.id
  
  WHERE jo."status" != 'Done' 
  AND jo."status" != 'Canceled'
  AND CASE
    WHEN array_length(processes, 1) > 0 THEN 
      jo."processId" = ANY(processes)
    ELSE true
  END
  ORDER BY jo."priority";
END;
$$ LANGUAGE plpgsql;


DROP POLICY IF EXISTS "Authenticated users can view global material substances" ON "materialSubstance";

DROP POLICY IF EXISTS "Employees can view material substances" ON "materialSubstance";

DROP POLICY IF EXISTS "Employees with parts_create can insert material substances" ON "materialSubstance";

DROP POLICY IF EXISTS "Employees with parts_update can update material substances" ON "materialSubstance";

DROP POLICY IF EXISTS "Employees with parts_delete can delete material substances" ON "materialSubstance";

DROP POLICY IF EXISTS "Requests with an API key can access material substances" ON "materialSubstance";

-- RLS Policies for materialSubstance table
CREATE POLICY "SELECT" ON "materialSubstance"
FOR SELECT 
USING (
  "companyId" IS NULL 
  OR "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "materialSubstance"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "materialSubstance"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "materialSubstance"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_delete')
    )::text[]
  )
);


DROP POLICY IF EXISTS "Authenticated users can view global material forms" ON "materialForm";

DROP POLICY IF EXISTS "Employees can view material forms" ON "materialForm";

DROP POLICY IF EXISTS "Employees with parts_create can insert material forms" ON "materialForm";

DROP POLICY IF EXISTS "Employees with parts_update can update material forms" ON "materialForm";

DROP POLICY IF EXISTS "Employees with parts_delete can delete material forms" ON "materialForm";

DROP POLICY IF EXISTS "Requests with an API key can access material forms" ON "materialForm";

-- RLS Policies for materialForm table
CREATE POLICY "SELECT" ON "materialForm"
FOR SELECT 
USING (
  "companyId" IS NULL 
  OR "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "materialForm"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "materialForm"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "materialForm"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('parts_delete')
    )::text[]
  )
);