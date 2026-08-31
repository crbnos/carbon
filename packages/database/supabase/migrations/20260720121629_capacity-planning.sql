-- ============================================================================
-- Process abilities
-- ============================================================================
-- The ability is linked 1:1 to its process (created by the app when
-- "requiresAbility" is toggled on); employee qualification lives in "employeeAbility".
ALTER TABLE "process" ADD COLUMN "requiresAbility" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ability" ADD COLUMN "processId" TEXT REFERENCES "process"("id") ON DELETE SET NULL;
CREATE INDEX "ability_processId_idx" ON "ability" ("processId");
CREATE UNIQUE INDEX "ability_processId_companyId_key" ON "ability" ("processId", "companyId")
  WHERE "processId" IS NOT NULL;

ALTER TABLE "employeeAbility" ADD COLUMN "expiresAt" DATE;
ALTER TABLE "ability" ADD COLUMN "recertifyEveryDays" INTEGER;

DROP VIEW IF EXISTS "processes";
CREATE OR REPLACE VIEW "processes" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.id,
    p.name,
    p."defaultStandardFactor",
    p."companyId",
    p."customFields",
    p."createdBy",
    p."createdAt",
    p."updatedBy",
    p."updatedAt",
    p."processType",
    p.tags,
    p."completeAllOnScan",
    p.active,
    p."requiresAbility",
    wcp."workCenters",
    sp.suppliers
  FROM "process" p
  LEFT JOIN (
    SELECT
      wcp_1."processId",
      array_agg(wcp_1."workCenterId") AS "workCenters"
    FROM "workCenterProcess" wcp_1
      JOIN "workCenter" wc ON wcp_1."workCenterId" = wc.id
    GROUP BY wcp_1."processId"
  ) wcp ON p.id = wcp."processId"
  LEFT JOIN (
    SELECT
      sp_1."processId",
      jsonb_agg(jsonb_build_object('id', sp_1.id, 'name', s.name)) AS suppliers
    FROM "supplierProcess" sp_1
      JOIN "supplier" s ON sp_1."supplierId" = s.id
    GROUP BY sp_1."processId"
  ) sp ON p.id = sp."processId";

-- ============================================================================
-- Capacity reservations
-- ============================================================================
-- 'OperatorPool' remains legal for old rows; the engine no longer writes it.
CREATE TYPE "capacityResourceKind" AS ENUM ('WorkCenter', 'OperatorPool', 'Employee');

CREATE TABLE "capacityReservation" (
    "id" TEXT NOT NULL DEFAULT id('cres'),
    "companyId" TEXT NOT NULL,
    "resourceKind" "capacityResourceKind" NOT NULL,
    "resourceId" TEXT NOT NULL, -- workCenter.id, employee/user id (Employee), or ability.id (OperatorPool)
    "operationId" TEXT NOT NULL REFERENCES "jobOperation"("id") ON DELETE CASCADE,
    "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
    "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "scenarioId" TEXT, -- null = live plan; scenario engine is a later phase
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "earliestStartAt" TIMESTAMP WITH TIME ZONE,
    "scheduleNote" TEXT,
    "workHours" NUMERIC,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CHECK ("endAt" > "startAt")
);

COMMENT ON COLUMN "capacityReservation"."earliestStartAt" IS
  'When the operation could have started at the earliest; startAt - earliestStartAt is time spent waiting. Null when unknown (legacy rows).';
COMMENT ON COLUMN "capacityReservation"."scheduleNote" IS
  'Human-readable reason for the placement timing (English, engine-generated), e.g. "Waited 14h for the work center - queued behind J000010 (2 ops)". Null when the operation started as early as it could.';
COMMENT ON COLUMN "capacityReservation"."workHours" IS
  'Actual work content (hours) inside this reservation; endAt - startAt minus off-shift pauses. Null on legacy rows and manual pins.';

CREATE INDEX "capacityReservation_companyId_idx" ON "capacityReservation" ("companyId");
CREATE INDEX "capacityReservation_resource_window_idx" ON "capacityReservation" ("resourceId", "startAt", "endAt");
CREATE INDEX "capacityReservation_operationId_idx" ON "capacityReservation" ("operationId");
CREATE INDEX "capacityReservation_jobId_idx" ON "capacityReservation" ("jobId");
CREATE INDEX "capacityReservation_createdBy_idx" ON "capacityReservation" ("createdBy");

ALTER TABLE "public"."capacityReservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."capacityReservation" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."capacityReservation" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."capacityReservation" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."capacityReservation" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);

-- ============================================================================
-- Work center operating hours (availability ladder rung 1)
-- ============================================================================
-- Which shifts a work center operates. No rows = rung 2 (all shifts at the
-- work center's location); no shifts at the location = rung 3 (stock Mon-Fri
-- 08:00-17:00 in the location timezone). "alwaysOn" = lights-out, 24x7.
ALTER TABLE "workCenter" ADD COLUMN "alwaysOn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "workCenterShift" (
    "id" TEXT NOT NULL DEFAULT id('wcsh'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "shiftId" TEXT NOT NULL REFERENCES "shift"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "workCenterShift_companyId_idx" ON "workCenterShift" ("companyId");
CREATE INDEX "workCenterShift_workCenterId_idx" ON "workCenterShift" ("workCenterId");
CREATE INDEX "workCenterShift_shiftId_idx" ON "workCenterShift" ("shiftId");
CREATE INDEX "workCenterShift_createdBy_idx" ON "workCenterShift" ("createdBy");
ALTER TABLE "workCenterShift" ADD CONSTRAINT "workCenterShift_wc_shift_key"
    UNIQUE ("workCenterId", "shiftId", "companyId");

ALTER TABLE "public"."workCenterShift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."workCenterShift" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."workCenterShift" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."workCenterShift" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."workCenterShift" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);

-- ============================================================================
-- Machine downtime via maintenance dispatches (derived windows, no new table)
-- ============================================================================
ALTER TABLE "maintenanceDispatch"
  ADD COLUMN "takesWorkCenterOffline" BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN "maintenanceDispatch"."takesWorkCenterOffline" IS
  'While this dispatch is open, its work center(s) contribute no scheduling capacity between (actualStartTime ?? plannedStartTime ?? createdAt) and (actualEndTime ?? plannedEndTime ?? open-ended).';

-- ============================================================================
-- Forecast output on the job
-- ============================================================================
ALTER TABLE "job" ADD COLUMN "projectedCompletionAt" TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN "job"."projectedCompletionAt" IS
  'Simulated finish of the job''s last operation (forward-ASAP finite schedule). Null until first regen.';

-- ============================================================================
-- Recreate the workCenter views so they expose "alwaysOn"
-- ============================================================================
-- A view's "SELECT wc.*" is expanded to the explicit column list at CREATE
-- time, so the pre-existing views froze before "alwaysOn" existed. Redefine
-- them (forked verbatim from 20260524143827_fixed-assets.sql) to pick it up.
DROP VIEW IF EXISTS "workCenters";
CREATE OR REPLACE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS
  SELECT
     wc.*,
     l.name as "locationName",
     d.name as "departmentName",
     wcp.processes
  FROM "workCenter" wc
  LEFT JOIN "location" l
    ON wc."locationId" = l.id
  LEFT JOIN "department" d
    ON wc."departmentId" = d.id
  LEFT JOIN (
    SELECT
      "workCenterId",
      array_agg("processId"::text) as processes
    FROM "workCenterProcess" wcp
    INNER JOIN "process" p ON wcp."processId" = p.id
    GROUP BY "workCenterId"
  ) wcp ON wc.id = wcp."workCenterId";

DROP VIEW IF EXISTS "workCentersWithBlockingStatus";
CREATE OR REPLACE VIEW "workCentersWithBlockingStatus" WITH (security_invoker = true) AS
SELECT
  wc.*,
  l.name AS "locationName",
  COALESCE(
    (SELECT COUNT(*) > 0
     FROM "maintenanceDispatch" md
     WHERE md."workCenterId" = wc.id
       AND md.status = 'In Progress'
       AND md."oeeImpact" IN ('Down', 'Planned')
    ), false
  ) AS "isBlocked",
  (
    SELECT md.id
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchId",
  (
    SELECT md."maintenanceDispatchId"
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchReadableId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;

-- ============================================================================
-- Ready-at + queue time
-- ============================================================================
ALTER TABLE "jobOperation" ADD COLUMN "readyAt" TIMESTAMP WITH TIME ZONE;

-- Ready-transitions are written from multiple functions, so a single BEFORE
-- trigger is the one reliable stamping point.
CREATE OR REPLACE FUNCTION set_job_operation_ready_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."status" = 'Ready' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'Ready') AND NEW."readyAt" IS NULL THEN
    NEW."readyAt" = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ready_at_on_job_operation ON "jobOperation";
CREATE TRIGGER set_ready_at_on_job_operation
BEFORE INSERT OR UPDATE OF "status" ON "jobOperation"
FOR EACH ROW EXECUTE FUNCTION set_job_operation_ready_at();

CREATE OR REPLACE VIEW "jobOperationQueueTime" WITH(SECURITY_INVOKER=true) AS
SELECT
  jo."id",
  jo."companyId",
  jo."jobId",
  jo."workCenterId",
  jo."readyAt",
  MIN(pe."startTime") AS "firstEventAt",
  EXTRACT(EPOCH FROM (MIN(pe."startTime") - jo."readyAt")) / 3600.0 AS "queueHours"
FROM "jobOperation" jo
LEFT JOIN "productionEvent" pe ON pe."jobOperationId" = jo."id"
WHERE jo."readyAt" IS NOT NULL
GROUP BY jo."id", jo."companyId", jo."jobId", jo."workCenterId", jo."readyAt";

-- ============================================================================
-- Training -> ability bridge
-- ============================================================================
ALTER TABLE "training"
  ADD COLUMN "grantsAbilityId" TEXT REFERENCES "ability"("id") ON DELETE SET NULL;
CREATE INDEX "training_grantsAbilityId_idx" ON "training" ("grantsAbilityId");

CREATE OR REPLACE FUNCTION grant_ability_on_training_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  granted_ability_id TEXT;
  recertify_days INTEGER;
  completed_date DATE;
BEGIN
  SELECT t."grantsAbilityId", a."recertifyEveryDays"
    INTO granted_ability_id, recertify_days
  FROM "trainingAssignment" ta
  JOIN "training" t ON t."id" = ta."trainingId"
  LEFT JOIN "ability" a ON a."id" = t."grantsAbilityId"
  WHERE ta."id" = NEW."trainingAssignmentId";

  IF granted_ability_id IS NULL THEN
    RETURN NEW;
  END IF;

  completed_date := COALESCE(NEW."completedAt"::date, CURRENT_DATE);

  INSERT INTO "employeeAbility"
    ("employeeId", "abilityId", "companyId", "active", "trainingCompleted", "lastTrainingDate", "expiresAt")
  VALUES (
    NEW."employeeId",
    granted_ability_id,
    NEW."companyId",
    TRUE,
    TRUE,
    completed_date,
    CASE WHEN recertify_days IS NOT NULL
      THEN completed_date + recertify_days
      ELSE NULL END
  )
  ON CONFLICT ("employeeId", "abilityId") DO UPDATE SET
    "active" = TRUE,
    "trainingCompleted" = TRUE,
    "lastTrainingDate" = EXCLUDED."lastTrainingDate",
    "expiresAt" = EXCLUDED."expiresAt";

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_ability_on_training_completion ON "trainingCompletion";
CREATE TRIGGER grant_ability_on_training_completion
AFTER INSERT ON "trainingCompletion"
FOR EACH ROW EXECUTE FUNCTION grant_ability_on_training_completion();

-- ============================================================================
-- Schedule operations board: conflict columns
-- ============================================================================
-- Main's definition + hasConflict/conflictReason output columns.
DROP FUNCTION IF EXISTS get_active_job_operations_by_location;
CREATE OR REPLACE FUNCTION get_active_job_operations_by_location(
  location_id TEXT,
  work_center_ids TEXT[]
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
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
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "jobCustomerId" TEXT,
  "customerName" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "salesOrderReadableId" TEXT,
  "assignee" TEXT,
  "tags" TEXT[],
  "thumbnailPath" TEXT,
  "operationDueDate" DATE,
  "reworkId" TEXT,
  "hasConflict" BOOLEAN,
  "conflictReason" TEXT
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT *
    FROM "job"
    WHERE "locationId" = location_id
    AND ("status" = 'Ready' OR "status" = 'In Progress' OR "status" = 'Paused')
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."jobMakeMethodId",
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
    rj."jobId" AS "jobReadableId",
    rj."status" AS "jobStatus",
    rj."dueDate" AS "jobDueDate",
    rj."deadlineType" AS "jobDeadlineType",
    rj."customerId" AS "jobCustomerId",
    c."name" AS "customerName",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN rj."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    rj."salesOrderId",
    rj."salesOrderLineId",
    so."salesOrderId" as "salesOrderReadableId",
    jo."assignee",
    jo."tags",
    COALESCE(mu."thumbnailPath", i."thumbnailPath") as "thumbnailPath",
    jo."dueDate" AS "operationDueDate",
    jo."reworkId",
    COALESCE(jo."hasConflict", FALSE) AS "hasConflict",
    jo."conflictReason"
  FROM "jobOperation" jo
  JOIN relevant_jobs rj ON rj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "customer" c ON rj."customerId" = c.id
  LEFT JOIN "salesOrder" so ON rj."salesOrderId" = so.id
  LEFT JOIN "modelUpload" mu ON i."modelUploadId" = mu.id
   WHERE CASE
    WHEN array_length(work_center_ids, 1) > 0 THEN
      jo."workCenterId" = ANY(work_center_ids) AND jo."status" != 'Done' AND jo."status" != 'Canceled'
    ELSE jo."status" != 'Done' AND jo."status" != 'Canceled'
  END
  ORDER BY jo."startDate", jo."priority";

END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Reactive replanning: job schedule-outdated stamps
-- ============================================================================
ALTER TABLE "job"
  ADD COLUMN "scheduleOutdatedReason" TEXT,
  ADD COLUMN "scheduleOutdatedAt" TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN "job"."scheduleOutdatedReason" IS
  'Why the stored schedule may be stale (e.g. "Qualification changed: Solder"). Null = schedule current.';

-- ============================================================================
-- Jobs view: expose the new job columns (projectedCompletionAt,
-- scheduleOutdatedReason, scheduleOutdatedAt) added above. The view expands
-- j.* at create time, so it must be recreated after the column adds to pick
-- them up.
-- ============================================================================
DROP VIEW IF EXISTS "jobs";
CREATE OR REPLACE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    j."companyId",
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
)
SELECT
  j.*,
  jmm."id" as "jobMakeMethodId",
  i.name,
  i."readableIdWithRevision" as "itemReadableIdWithRevision",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
LEFT JOIN "jobMakeMethod" jmm ON jmm."jobId" = j.id AND jmm."parentMaterialId" IS NULL
INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
LEFT JOIN job_model jm ON j.id = jm.job_id AND j."companyId" = jm."companyId"
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id AND j."companyId" = so."companyId"
LEFT JOIN "quote" qo ON j."quoteId" = qo.id AND j."companyId" = qo."companyId";

-- ============================================================================
-- Schedule dates board: schedule-outdated reason
-- ============================================================================
-- Main's definition + scheduleOutdatedReason output column.
DROP FUNCTION IF EXISTS get_jobs_by_date_range(TEXT, DATE, DATE);
CREATE OR REPLACE FUNCTION public.get_jobs_by_date_range(location_id text, start_date date, end_date date)
 RETURNS TABLE(id text, "jobId" text, status "jobStatus", "dueDate" date, "completedDate" timestamp with time zone, "deadlineType" "deadlineType", "customerId" text, "customerName" text, "salesOrderReadableId" text, "salesOrderId" text, "salesOrderLineId" text, "itemId" text, "itemReadableId" text, "itemDescription" text, quantity numeric, "quantityComplete" numeric, "quantityShipped" numeric, priority double precision, assignee text, tags text[], "thumbnailPath" text, "operationCount" integer, "completedOperationCount" integer, "hasConflict" boolean, "jobMakeMethodId" text, "scheduleOutdatedReason" text, "projectedCompletionAt" timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    SELECT
      j."id",
      j."jobId",
      j."status",
      j."dueDate",
      j."completedDate",
      j."deadlineType",
      j."customerId",
      j."salesOrderLineId",
      j."quantity",
      j."quantityShipped",
      j."priority",
      j."assignee",
      j."tags",
      mu."thumbnailPath",
      j."scheduleOutdatedReason",
      j."projectedCompletionAt"
    FROM "job" j
    LEFT JOIN "modelUpload" mu ON mu.id = j."modelUploadId"
    WHERE j."locationId" = location_id
    AND j."dueDate" IS NOT NULL
    AND j."dueDate" >= start_date
    AND j."dueDate" <= end_date
    AND j."status" != 'Cancelled'
  ),
  job_items AS (
    SELECT DISTINCT ON (jmm."jobId")
      jmm."jobId",
      jmm."id" AS "jobMakeMethodId",
      jmm."itemId",
      i."readableId" AS "itemReadableId",
      i."name" AS "itemDescription",
      i."thumbnailPath" AS "itemThumbnailPath",
      imu."thumbnailPath" AS "itemModelThumbnailPath"
    FROM "jobMakeMethod" jmm
    LEFT JOIN "item" i ON i.id = jmm."itemId"
    LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
    WHERE jmm."parentMaterialId" IS NULL
    ORDER BY jmm."jobId", jmm."createdAt"
  ),
  -- Only count operations from the parent make method (not subassemblies)
  operation_stats AS (
    SELECT
      jo."jobId",
      COUNT(*)::INTEGER AS "operationCount",
      COUNT(*) FILTER (WHERE jo."status" = 'Done')::INTEGER AS "completedOperationCount",
      BOOL_OR(COALESCE(jo."hasConflict", FALSE)) AS "hasConflict"
    FROM "jobOperation" jo
    INNER JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
    WHERE jmm."parentMaterialId" IS NULL
    GROUP BY jo."jobId"
  ),
  -- Get quantity complete from only the parent make method operations
  -- Use the MAX to get the highest quantity completed across all root-level operations
  parent_quantity_complete AS (
    SELECT
      jo."jobId",
      MAX(jo."quantityComplete") AS "quantityComplete"
    FROM "jobOperation" jo
    INNER JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
    WHERE jmm."parentMaterialId" IS NULL
    GROUP BY jo."jobId"
  )
  SELECT
    rj."id",
    rj."jobId",
    rj."status",
    rj."dueDate",
    rj."completedDate",
    rj."deadlineType",
    rj."customerId",
    c."name" AS "customerName",
    so."salesOrderId" AS "salesOrderReadableId",
    so."id" AS "salesOrderId",
    rj."salesOrderLineId",
    ji."itemId",
    ji."itemReadableId",
    ji."itemDescription",
    rj."quantity",
    COALESCE(pqc."quantityComplete", 0) AS "quantityComplete",
    rj."quantityShipped",
    rj."priority",
    rj."assignee",
    rj."tags",
    COALESCE(ji."itemThumbnailPath", ji."itemModelThumbnailPath", rj."thumbnailPath") AS "thumbnailPath",
    COALESCE(os."operationCount", 0) AS "operationCount",
    COALESCE(os."completedOperationCount", 0) AS "completedOperationCount",
    COALESCE(os."hasConflict", FALSE) AS "hasConflict",
    ji."jobMakeMethodId",
    rj."scheduleOutdatedReason",
    rj."projectedCompletionAt"
  FROM relevant_jobs rj
  LEFT JOIN "salesOrderLine" sol ON sol."id" = rj."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "customer" c ON c."id" = rj."customerId"
  LEFT JOIN job_items ji ON ji."jobId" = rj."id"
  LEFT JOIN operation_stats os ON os."jobId" = rj."id"
  LEFT JOIN parent_quantity_complete pqc ON pqc."jobId" = rj."id"
  ORDER BY rj."dueDate";
END;
$function$;

-- ============================================================================
-- employeeShift RLS: scope on the table's own companyId
-- ============================================================================
-- The old policies resolved the company via get_company_id_from_foreign_key
-- ("employeeId", 'employee'); employee has a composite PK (id, companyId), so
-- for a person employed in several companies that unordered lookup returns an
-- arbitrary row and the policies pass or fail nondeterministically.
DROP POLICY IF EXISTS "SELECT" ON "public"."employeeShift";
DROP POLICY IF EXISTS "INSERT" ON "public"."employeeShift";
DROP POLICY IF EXISTS "UPDATE" ON "public"."employeeShift";
DROP POLICY IF EXISTS "DELETE" ON "public"."employeeShift";

CREATE POLICY "SELECT" ON "public"."employeeShift"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."employeeShift"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."employeeShift"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."employeeShift"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_delete'))::text[])
);
