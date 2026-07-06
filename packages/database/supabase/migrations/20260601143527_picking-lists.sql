-- ============================================================================
-- Picking Lists
-- Tables, enums, views, functions, indexes, sequences, custom fields, and RLS
-- for the picking list feature.
-- ============================================================================

-- Enums

DROP TYPE IF EXISTS "pickingListStatus";
CREATE TYPE "pickingListStatus" AS ENUM (
  'Draft',
  'In Progress',
  'Completed',
  'Cancelled'
);

DROP TYPE IF EXISTS "pickingListLineStatus";
CREATE TYPE "pickingListLineStatus" AS ENUM (
  'Pending',
  'Picked',
  'Short',
  'Cancelled'
);

-- ============================================================================
-- pickingList table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "pickingList" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "pickingListId" TEXT NOT NULL,
  "status" "pickingListStatus" NOT NULL DEFAULT 'Draft',
  "locationId" TEXT NOT NULL,
  "assignee" TEXT,
  "dueDate" DATE,
  "notes" JSONB,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "pickingList_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pickingList_pickingListId_key" UNIQUE ("pickingListId", "companyId"),
  CONSTRAINT "pickingList_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingList_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingList_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingList_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "pickingList_companyId_idx" ON "pickingList"("companyId");
CREATE INDEX IF NOT EXISTS "pickingList_status_companyId_idx" ON "pickingList"("status", "companyId");
CREATE INDEX IF NOT EXISTS "pickingList_assignee_companyId_idx" ON "pickingList"("assignee", "companyId");
CREATE INDEX IF NOT EXISTS "pickingList_locationId_companyId_idx" ON "pickingList"("locationId", "companyId");

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('pickingList', 'Picking List', 'Inventory')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- pickingListLine table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "pickingListLine" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "pickingListId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "jobMaterialId" TEXT NOT NULL,
  "jobOperationId" TEXT,
  "itemId" TEXT NOT NULL,
  "quantityToPick" NUMERIC(12,4) NOT NULL,
  "quantityPicked" NUMERIC(12,4) NOT NULL DEFAULT 0,
  "outstandingQuantity" NUMERIC(12,4) GENERATED ALWAYS AS (CASE WHEN "quantityToPick" >= "quantityPicked" THEN "quantityToPick" - "quantityPicked" ELSE 0 END) STORED,
  "storageUnitId" TEXT,
  "toStorageUnitId" TEXT,
  "status" "pickingListLineStatus" NOT NULL DEFAULT 'Pending',
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "pickingListLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pickingListLine_pickingListId_fkey" FOREIGN KEY ("pickingListId") REFERENCES "pickingList"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingListLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_jobMaterialId_fkey" FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_jobOperationId_fkey" FOREIGN KEY ("jobOperationId") REFERENCES "jobOperation"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingListLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_storageUnitId_fkey" FOREIGN KEY ("storageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingListLine_toStorageUnitId_fkey" FOREIGN KEY ("toStorageUnitId") REFERENCES "storageUnit"("id") ON DELETE SET NULL,
  CONSTRAINT "pickingListLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingListLine_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "pickingListLine_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "pickingListLine_pickingListId_idx" ON "pickingListLine"("pickingListId");
CREATE INDEX IF NOT EXISTS "pickingListLine_jobId_idx" ON "pickingListLine"("jobId");
CREATE INDEX IF NOT EXISTS "pickingListLine_jobMaterialId_idx" ON "pickingListLine"("jobMaterialId");
CREATE INDEX IF NOT EXISTS "pickingListLine_jobOperationId_idx" ON "pickingListLine"("jobOperationId");
CREATE INDEX IF NOT EXISTS "pickingListLine_itemId_idx" ON "pickingListLine"("itemId");
CREATE INDEX IF NOT EXISTS "pickingListLine_storageUnitId_idx" ON "pickingListLine"("storageUnitId");
CREATE INDEX IF NOT EXISTS "pickingListLine_toStorageUnitId_idx" ON "pickingListLine"("toStorageUnitId");
CREATE INDEX IF NOT EXISTS "pickingListLine_companyId_idx" ON "pickingListLine"("companyId");

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('pickingListLine', 'Picking List Line', 'Inventory')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- pickingListLineTrackedEntity table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "pickingListLineTrackedEntity" (
  "pickingListLineId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC(12,4) NOT NULL,
  "quantityPicked" NUMERIC(12,4) NOT NULL DEFAULT 0,

  CONSTRAINT "pickingListLineTrackedEntity_pkey" PRIMARY KEY ("pickingListLineId", "trackedEntityId"),
  CONSTRAINT "pickingListLineTrackedEntity_pickingListLineId_fkey" FOREIGN KEY ("pickingListLineId") REFERENCES "pickingListLine"("id") ON DELETE CASCADE,
  CONSTRAINT "pickingListLineTrackedEntity_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "pickingListLineTrackedEntity_trackedEntityId_idx"
  ON "pickingListLineTrackedEntity" ("trackedEntityId");

-- ============================================================================
-- Sequence
-- ============================================================================

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT
  'pickingList',
  'Picking List',
  'PL',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company"
ON CONFLICT DO NOTHING;

-- ============================================================================
-- storageUnit enhancement: add workCenterId (lineside designation) and a flag
-- marking the single system-managed default lineside unit per work center.
-- ============================================================================

ALTER TABLE "storageUnit"
  ADD COLUMN IF NOT EXISTS "workCenterId" TEXT;

ALTER TABLE "storageUnit"
  ADD COLUMN IF NOT EXISTS "isWorkCenterDefault" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storageUnit_workCenterId_fkey'
  ) THEN
    ALTER TABLE "storageUnit"
      ADD CONSTRAINT "storageUnit_workCenterId_fkey"
        FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id")
        ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "storageUnit_workCenterId_idx" ON "storageUnit"("workCenterId");

-- At most one auto-created default lineside unit per work center (race-proof).
CREATE UNIQUE INDEX IF NOT EXISTS "storageUnit_workCenterDefault_uniq"
  ON "storageUnit" ("workCenterId", "companyId")
  WHERE "isWorkCenterDefault";

-- ============================================================================
-- Function: get_or_create_work_center_lineside
-- Returns the work center's lineside storage unit, lazily creating a canonical
-- default named after the work center when none exists. Idempotent + race-safe.
-- The shelf name mirrors the work center name exactly (no suffix) so it stays
-- internationalization-friendly.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_or_create_work_center_lineside(
  p_work_center_id TEXT,
  p_company_id TEXT,
  p_user_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_storage_unit_id TEXT;
  v_location_id TEXT;
  v_name TEXT;
BEGIN
  -- Prefer an existing lineside unit (the managed default first, else oldest).
  SELECT "id" INTO v_storage_unit_id
  FROM "storageUnit"
  WHERE "workCenterId" = p_work_center_id
    AND "companyId" = p_company_id
  ORDER BY "isWorkCenterDefault" DESC, "createdAt" ASC
  LIMIT 1;

  IF v_storage_unit_id IS NOT NULL THEN
    RETURN v_storage_unit_id;
  END IF;

  SELECT "locationId", "name" INTO v_location_id, v_name
  FROM "workCenter"
  WHERE "id" = p_work_center_id;

  IF v_location_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Omit "id" so the table default (id('sh')) generates the prefixed id.
  INSERT INTO "storageUnit" ("name", "locationId", "workCenterId", "isWorkCenterDefault", "companyId", "createdBy")
  VALUES (v_name, v_location_id, p_work_center_id, true, p_company_id, p_user_id)
  ON CONFLICT ("workCenterId", "companyId") WHERE "isWorkCenterDefault" DO NOTHING;

  SELECT "id" INTO v_storage_unit_id
  FROM "storageUnit"
  WHERE "workCenterId" = p_work_center_id
    AND "companyId" = p_company_id
    AND "isWorkCenterDefault"
  LIMIT 1;

  RETURN v_storage_unit_id;
END;
$$;

-- ============================================================================
-- Trigger: keep the auto-created lineside unit's name in sync with its work
-- center's name (only touches the system-managed default unit). The shelf name
-- mirrors the work center name exactly (no suffix) for internationalization.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_work_center_lineside_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."name" IS DISTINCT FROM OLD."name" THEN
    UPDATE "storageUnit"
    SET "name" = NEW."name"
    WHERE "workCenterId" = NEW."id" AND "isWorkCenterDefault";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_work_center_lineside_name_trigger ON "workCenter";
CREATE TRIGGER sync_work_center_lineside_name_trigger
  AFTER UPDATE OF "name" ON "workCenter"
  FOR EACH ROW
  EXECUTE FUNCTION sync_work_center_lineside_name();

-- ============================================================================
-- Function: get_effective_work_center_id
-- Walks the storageUnit parent chain to find the first non-null workCenterId.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_work_center_id(p_storage_unit_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE chain AS (
    SELECT "id", "parentId", "workCenterId", 1 AS depth
    FROM "storageUnit"
    WHERE "id" = p_storage_unit_id

    UNION ALL

    SELECT su."id", su."parentId", su."workCenterId", c.depth + 1
    FROM "storageUnit" su
    JOIN chain c ON su."id" = c."parentId"
    WHERE c.depth < 20
  )
  SELECT "workCenterId"
  FROM chain
  WHERE "workCenterId" IS NOT NULL
  LIMIT 1;
$$;

-- ============================================================================
-- Function: get_picking_schedule
-- Returns job operations with outstanding pick requirements at a location.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_picking_schedule(
  p_location_id TEXT,
  p_company_id TEXT,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  "jobOperationId" TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "jobReadableId" TEXT,
  "itemId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "operationDescription" TEXT,
  "processName" TEXT,
  "workCenterId" TEXT,
  "workCenterName" TEXT,
  "operationStatus" "jobOperationStatus",
  "deadlineType" "deadlineType",
  "dueDate" DATE,
  "customerId" TEXT,
  "customerName" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "salesOrderReadableId" TEXT,
  "thumbnailPath" TEXT,
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityReworked" NUMERIC,
  "quantityScrapped" NUMERIC,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "tags" TEXT[],
  "partsToPickCount" BIGINT,
  "totalQuantityToPick" NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  -- Outstanding picks aggregated per operation. A material needs picking unless
  -- the operation's OWN work-center lineside bin already stocks enough on-hand
  -- to cover it. We test the ACTUAL on-hand at that bin rather than whether the
  -- jobMaterial's recorded shelf points there: a part can be line-stocked at
  -- this work center while the jobMaterial still points at the warehouse (or
  -- another line) — that is already staged, not an outstanding pick.
  picks AS (
    SELECT
      jm."jobOperationId",
      COUNT(*) AS "partsToPickCount",
      SUM(jm."quantityToIssue") AS "totalQuantityToPick"
    FROM "jobMaterial" jm
    JOIN "jobOperation" jo2 ON jo2."id" = jm."jobOperationId"
    -- The operation's work-center lineside bin (managed default first, else
    -- oldest), mirroring get_or_create_work_center_lineside's selection.
    LEFT JOIN LATERAL (
      SELECT su."id"
      FROM "storageUnit" su
      WHERE su."workCenterId" = jo2."workCenterId"
        AND su."companyId" = p_company_id
      ORDER BY su."isWorkCenterDefault" DESC, su."createdAt" ASC
      LIMIT 1
    ) wcl ON true
    -- On-hand of this item already staged at that lineside bin.
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(il."quantity"), 0) AS qty
      FROM "itemLedger" il
      WHERE il."itemId" = jm."itemId"
        AND il."companyId" = p_company_id
        AND il."storageUnitId" = wcl."id"
    ) staged ON true
    WHERE jm."companyId" = p_company_id
      AND jm."jobOperationId" IS NOT NULL
      AND jm."quantityToIssue" > 0
      -- Needs picking unless the lineside bin already covers the issue qty.
      AND (wcl."id" IS NULL OR staged.qty < jm."quantityToIssue")
      -- Exclude operations already on a non-cancelled picking list (no dupes).
      AND NOT EXISTS (
        SELECT 1 FROM "pickingListLine" pll
        JOIN "pickingList" pl ON pl."id" = pll."pickingListId"
        WHERE pll."jobOperationId" = jm."jobOperationId"
          AND pl."status" <> 'Cancelled'
      )
    GROUP BY jm."jobOperationId"
  )
  SELECT
    jo."id" AS "jobOperationId",
    j."id" AS "jobId",
    jo."jobMakeMethodId",
    j."jobId" AS "jobReadableId",
    i."id" AS "itemId",
    i."readableId" AS "itemReadableId",
    i."name" AS "itemDescription",
    jo."order" AS "operationOrder",
    jo."description" AS "operationDescription",
    p."name" AS "processName",
    jo."workCenterId",
    wc."name" AS "workCenterName",
    CASE WHEN j."status" = 'Paused' THEN 'Paused'::"jobOperationStatus" ELSE jo."status" END AS "operationStatus",
    j."deadlineType",
    jo."dueDate",
    j."customerId",
    c."name" AS "customerName",
    j."salesOrderId",
    j."salesOrderLineId",
    so."salesOrderId" AS "salesOrderReadableId",
    COALESCE(mu."thumbnailPath", i."thumbnailPath") AS "thumbnailPath",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityReworked",
    jo."quantityScrapped",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."tags",
    pk."partsToPickCount",
    pk."totalQuantityToPick"
  FROM picks pk
  JOIN "jobOperation" jo ON jo."id" = pk."jobOperationId"
  JOIN "job" j ON jo."jobId" = j."id"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm."id"
  LEFT JOIN "item" i ON jmm."itemId" = i."id"
  LEFT JOIN "process" p ON jo."processId" = p."id"
  LEFT JOIN "workCenter" wc ON jo."workCenterId" = wc."id"
  LEFT JOIN "customer" c ON j."customerId" = c."id"
  LEFT JOIN "salesOrder" so ON j."salesOrderId" = so."id"
  LEFT JOIN "modelUpload" mu ON i."modelUploadId" = mu."id"
  WHERE j."companyId" = p_company_id
    AND j."locationId" = p_location_id
    AND j."status" IN ('Ready', 'In Progress', 'Paused')
    AND jo."status" NOT IN ('Done', 'Canceled')
    AND (
      p_search IS NULL OR p_search = ''
      OR j."jobId" ILIKE '%' || p_search || '%'
      OR i."readableId" ILIKE '%' || p_search || '%'
      OR jo."description" ILIKE '%' || p_search || '%'
    )
  ORDER BY jo."dueDate" NULLS LAST, j."jobId";
$$;

-- ============================================================================
-- View: pickingLists
-- ============================================================================

CREATE OR REPLACE VIEW "pickingLists" WITH(SECURITY_INVOKER=true) AS
  SELECT
    pl.*,
    l."name" AS "locationName",
    u."fullName" AS "assigneeName",
    u."avatarUrl" AS "assigneeAvatarUrl",
    (SELECT COUNT(*) FROM "pickingListLine" pll WHERE pll."pickingListId" = pl."id") AS "lineCount",
    (SELECT COUNT(*) FROM "pickingListLine" pll WHERE pll."pickingListId" = pl."id" AND pll."status" IN ('Picked', 'Short', 'Cancelled')) AS "completedLineCount"
  FROM "pickingList" pl
  INNER JOIN "location" l ON l."id" = pl."locationId"
  LEFT JOIN "user" u ON u."id" = pl."assignee";

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE "pickingList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pickingListLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pickingListLineTrackedEntity" ENABLE ROW LEVEL SECURITY;

-- pickingList policies

DROP POLICY IF EXISTS "SELECT" ON "pickingList";
CREATE POLICY "SELECT" ON "pickingList"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_view')
    )::text[]
  )
);

DROP POLICY IF EXISTS "INSERT" ON "pickingList";
CREATE POLICY "INSERT" ON "pickingList"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "pickingList";
CREATE POLICY "UPDATE" ON "pickingList"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

DROP POLICY IF EXISTS "DELETE" ON "pickingList";
CREATE POLICY "DELETE" ON "pickingList"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

-- pickingListLine policies

DROP POLICY IF EXISTS "SELECT" ON "pickingListLine";
CREATE POLICY "SELECT" ON "pickingListLine"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_view')
    )::text[]
  )
);

DROP POLICY IF EXISTS "INSERT" ON "pickingListLine";
CREATE POLICY "INSERT" ON "pickingListLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_create')
    )::text[]
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "pickingListLine";
CREATE POLICY "UPDATE" ON "pickingListLine"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_update')
    )::text[]
  )
);

DROP POLICY IF EXISTS "DELETE" ON "pickingListLine";
CREATE POLICY "DELETE" ON "pickingListLine"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('inventory_delete')
    )::text[]
  )
);

-- pickingListLineTrackedEntity policies (no companyId - uses FK lookup)

DROP POLICY IF EXISTS "SELECT" ON "pickingListLineTrackedEntity";
CREATE POLICY "SELECT" ON "pickingListLineTrackedEntity"
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

DROP POLICY IF EXISTS "INSERT" ON "pickingListLineTrackedEntity";
CREATE POLICY "INSERT" ON "pickingListLineTrackedEntity"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "pickingListLineTrackedEntity";
CREATE POLICY "UPDATE" ON "pickingListLineTrackedEntity"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

DROP POLICY IF EXISTS "DELETE" ON "pickingListLineTrackedEntity";
CREATE POLICY "DELETE" ON "pickingListLineTrackedEntity"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine"
    WHERE "id" = "pickingListLineId"
  )
);

-- ============================================================================
-- Trigger: keep the picking list header status in sync with its lines
-- (mirrors update_stock_transfer_status). A line is "resolved" when it is
-- fully picked, or explicitly marked Short/Cancelled.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_picking_list_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Only react to picked-quantity or status changes
  IF (OLD."quantityPicked" IS DISTINCT FROM NEW."quantityPicked")
     OR (OLD."status" IS DISTINCT FROM NEW."status") THEN

    IF NOT EXISTS (
      -- no line still outstanding (each is fully picked or Short/Cancelled)
      SELECT 1 FROM "pickingListLine"
      WHERE "pickingListId" = NEW."pickingListId"
        AND "status" NOT IN ('Short', 'Cancelled')
        AND ("quantityPicked" IS NULL OR "quantityPicked" < "quantityToPick")
    ) THEN
      -- All lines resolved → Completed (never override a Cancelled header).
      UPDATE "pickingList"
      SET "status" = 'Completed'
      WHERE "id" = NEW."pickingListId"
        AND "status" <> 'Cancelled';
    ELSE
      -- Work remains: never leave the header stuck on Completed (e.g. after an
      -- unpick), and move a still-Draft list to In Progress on first progress.
      UPDATE "pickingList"
      SET "status" = 'In Progress'
      WHERE "id" = NEW."pickingListId"
        AND ("status" = 'Completed'
             OR ("status" = 'Draft' AND EXISTS (
               SELECT 1 FROM "pickingListLine"
               WHERE "pickingListId" = NEW."pickingListId"
                 AND (COALESCE("quantityPicked", 0) > 0
                      OR "status" IN ('Picked', 'Short', 'Cancelled'))
             )));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_picking_list_status_trigger
  AFTER UPDATE ON "pickingListLine"
  FOR EACH ROW
  EXECUTE FUNCTION update_picking_list_status();
