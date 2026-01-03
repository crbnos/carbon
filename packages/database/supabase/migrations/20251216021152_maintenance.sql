-- Maintenance dispatch status enum
DO $$ BEGIN
    CREATE TYPE "maintenanceDispatchStatus" AS ENUM (
      'Open',
      'Assigned',
      'In Progress',
      'Completed',
      'Cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Maintenance dispatch priority enum
DO $$ BEGIN
    CREATE TYPE "maintenanceDispatchPriority" AS ENUM (
      'Low',
      'Medium',
      'High',
      'Critical'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Maintenance severity enum
DO $$ BEGIN
    CREATE TYPE "maintenanceSeverity" AS ENUM (
      'Preventive',
      'Operator Performed',
      'Maintenance Required',
      'OEM Required'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Maintenance source enum
DO $$ BEGIN
    CREATE TYPE "maintenanceSource" AS ENUM (
      'Scheduled',
      'Reactive',
      'Non-Conformance'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Maintenance frequency enum
DO $$ BEGIN
  CREATE TYPE "maintenanceFrequency" AS ENUM (
    'Daily',
    'Weekly',
    'Monthly',
    'Quarterly',
    'Annual'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Failure mode catalog
CREATE TABLE "maintenanceFailureMode" (
  "id" TEXT NOT NULL DEFAULT id(),
  "name" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceFailureMode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceFailureMode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceFailureMode_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceFailureMode_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "maintenanceFailureMode_companyId_idx" ON "maintenanceFailureMode" ("companyId");

-- Insert default failure modes for each existing company
INSERT INTO "maintenanceFailureMode" ("name", "companyId", "createdBy")
SELECT 
  failure_mode,
  c."id" as "companyId",
  'system'
FROM (
  VALUES 
    ('Bearing Failure'),
    ('Lubrication Failure'),
    ('Electrical Fault'),
    ('Leak'),
    ('Excessive Wear'),
    ('Misalignment'),
    ('Overheating'),
    ('Cracking/Fatigue'),
    ('Blockage'),
    ('Excessive Vibration')
) AS failure_modes(failure_mode)
CROSS JOIN "company" c;


ALTER TABLE "maintenanceFailureMode" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceFailureMode"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "maintenanceFailureMode"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_create')
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceFailureMode"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_update')
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "maintenanceFailureMode"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );

-- Maintenance schedule table (must be created before maintenanceDispatch)
CREATE TABLE IF NOT EXISTS "maintenanceSchedule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "workCenterId" TEXT NOT NULL,
  "frequency" "maintenanceFrequency" NOT NULL,
  "priority" "maintenanceDispatchPriority" NOT NULL DEFAULT 'Medium',
  "estimatedDuration" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastGeneratedAt" TIMESTAMP WITH TIME ZONE,
  "nextDueAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceSchedule_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceSchedule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceSchedule_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "maintenanceSchedule_workCenterId_idx" ON "maintenanceSchedule" ("workCenterId");
CREATE INDEX IF NOT EXISTS "maintenanceSchedule_companyId_idx" ON "maintenanceSchedule" ("companyId");
CREATE INDEX IF NOT EXISTS "maintenanceSchedule_active_idx" ON "maintenanceSchedule" ("active");

ALTER TABLE "maintenanceSchedule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceSchedule"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_view')
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "maintenanceSchedule"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_create')
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceSchedule"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_update')
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "maintenanceSchedule"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );

-- Maintenance schedule items (parts required for scheduled maintenance)
CREATE TABLE IF NOT EXISTS "maintenanceScheduleItem" (
  "id" TEXT NOT NULL DEFAULT id(),
  "maintenanceScheduleId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitOfMeasureCode" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceScheduleItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceScheduleItem_maintenanceScheduleId_fkey" FOREIGN KEY ("maintenanceScheduleId") REFERENCES "maintenanceSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceScheduleItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceScheduleItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceScheduleItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceScheduleItem_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "maintenanceScheduleItem_maintenanceScheduleId_idx" ON "maintenanceScheduleItem" ("maintenanceScheduleId");
CREATE INDEX IF NOT EXISTS "maintenanceScheduleItem_itemId_idx" ON "maintenanceScheduleItem" ("itemId");
CREATE INDEX IF NOT EXISTS "maintenanceScheduleItem_companyId_idx" ON "maintenanceScheduleItem" ("companyId");

ALTER TABLE "maintenanceScheduleItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceScheduleItem"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "maintenanceScheduleItem"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceScheduleItem"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_update')
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "maintenanceScheduleItem"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );

-- Main dispatch table
CREATE TABLE IF NOT EXISTS "maintenanceDispatch" (
  "id" TEXT NOT NULL DEFAULT id('main'),
  "maintenanceDispatchId" TEXT NOT NULL,
  "content" JSON NOT NULL DEFAULT '{}',
  "status" "maintenanceDispatchStatus" NOT NULL DEFAULT 'Open',
  "priority" "maintenanceDispatchPriority" NOT NULL DEFAULT 'Medium',
  "source" "maintenanceSource" NOT NULL DEFAULT 'Reactive',
  "severity" "maintenanceSeverity",
  "workCenterId" TEXT,
  "maintenanceScheduleId" TEXT,
  "suspectedFailureModeId" TEXT,
  "actualFailureModeId" TEXT,
  "plannedStartTime" TIMESTAMP WITH TIME ZONE,
  "plannedEndTime" TIMESTAMP WITH TIME ZONE,
  "actualStartTime" TIMESTAMP WITH TIME ZONE,
  "actualEndTime" TIMESTAMP WITH TIME ZONE,
  "duration" INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN "actualEndTime" IS NULL THEN 0
      ELSE EXTRACT(EPOCH FROM ("actualEndTime" - "actualStartTime"))::INTEGER
    END
  ) STORED,
  "nonConformanceId" TEXT,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "assignee" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceDispatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceDispatch_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_maintenanceScheduleId_fkey" FOREIGN KEY ("maintenanceScheduleId") REFERENCES "maintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_suspectedFailureModeId_fkey" FOREIGN KEY ("suspectedFailureModeId") REFERENCES "maintenanceFailureMode"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_actualFailureModeId_fkey" FOREIGN KEY ("actualFailureModeId") REFERENCES "maintenanceFailureMode"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatch_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "maintenanceDispatch_status_idx" ON "maintenanceDispatch" ("status");
CREATE INDEX "maintenanceDispatch_companyId_idx" ON "maintenanceDispatch" ("companyId");

ALTER TABLE "maintenanceDispatch" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceDispatch"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "maintenanceDispatch"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceDispatch"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "maintenanceDispatch"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );

-- Time tracking events
CREATE TABLE "maintenanceDispatchEvent" (
  "id" TEXT NOT NULL DEFAULT id(),
  "maintenanceDispatchId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL,
  "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
  "endTime" TIMESTAMP WITH TIME ZONE,
  "notes" TEXT,
  "duration" INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN "endTime" IS NULL THEN 0
      ELSE EXTRACT(EPOCH FROM ("endTime" - "startTime"))::INTEGER
    END
  ) STORED,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceDispatchEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceDispatchEvent_maintenanceDispatchId_fkey" FOREIGN KEY ("maintenanceDispatchId") REFERENCES "maintenanceDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchEvent_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchEvent_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchEvent_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "maintenanceDispatchEvent_maintenanceDispatchId_idx" ON "maintenanceDispatchEvent" ("maintenanceDispatchId");
CREATE INDEX "maintenanceDispatchEvent_employeeId_idx" ON "maintenanceDispatchEvent" ("employeeId");
CREATE INDEX "maintenanceDispatchEvent_companyId_idx" ON "maintenanceDispatchEvent" ("companyId");

ALTER TABLE "maintenanceDispatchEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceDispatchEvent"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "maintenanceDispatchEvent"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceDispatchEvent"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "maintenanceDispatchEvent"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );

-- Comments on dispatches
CREATE TABLE IF NOT EXISTS "maintenanceDispatchComment" (
  "id" TEXT NOT NULL DEFAULT id(),
  "maintenanceDispatchId" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceDispatchComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceDispatchComment_maintenanceDispatchId_fkey" FOREIGN KEY ("maintenanceDispatchId") REFERENCES "maintenanceDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchComment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchComment_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "maintenanceDispatchComment_maintenanceDispatchId_idx" ON "maintenanceDispatchComment" ("maintenanceDispatchId");

ALTER TABLE "maintenanceDispatchComment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceDispatchComment"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "maintenanceDispatchComment"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceDispatchComment"
  FOR UPDATE USING (
    "createdBy" = auth.uid()::text
  );

CREATE POLICY "DELETE" ON "maintenanceDispatchComment"
  FOR DELETE USING (
    "createdBy" = auth.uid()::text
  );

-- Work centers involved in dispatch
CREATE TABLE "maintenanceDispatchWorkCenter" (
  "id" TEXT NOT NULL DEFAULT id(),
  "maintenanceDispatchId" TEXT NOT NULL,
  "workCenterId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceDispatchWorkCenter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceDispatchWorkCenter_maintenanceDispatchId_fkey" FOREIGN KEY ("maintenanceDispatchId") REFERENCES "maintenanceDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchWorkCenter_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchWorkCenter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchWorkCenter_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchWorkCenter_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "maintenanceDispatchWorkCenter_maintenanceDispatchId_idx" ON "maintenanceDispatchWorkCenter" ("maintenanceDispatchId");
CREATE INDEX "maintenanceDispatchWorkCenter_workCenterId_idx" ON "maintenanceDispatchWorkCenter" ("workCenterId");
CREATE INDEX "maintenanceDispatchWorkCenter_companyId_idx" ON "maintenanceDispatchWorkCenter" ("companyId");

ALTER TABLE "maintenanceDispatchWorkCenter" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceDispatchWorkCenter"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "maintenanceDispatchWorkCenter"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceDispatchWorkCenter"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_update')
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "maintenanceDispatchWorkCenter"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );
  

-- Parts/materials consumed
CREATE TABLE "maintenanceDispatchItem" (
  "id" TEXT NOT NULL DEFAULT id(),
  "maintenanceDispatchId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitOfMeasureCode" TEXT NOT NULL,
  "unitCost" NUMERIC,
  "totalCost" NUMERIC GENERATED ALWAYS AS ("quantity" * "unitCost") STORED,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceDispatchItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceDispatchItem_maintenanceDispatchId_fkey" FOREIGN KEY ("maintenanceDispatchId") REFERENCES "maintenanceDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItem_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "maintenanceDispatchItem_maintenanceDispatchId_idx" ON "maintenanceDispatchItem" ("maintenanceDispatchId");
CREATE INDEX "maintenanceDispatchItem_itemId_idx" ON "maintenanceDispatchItem" ("itemId");
CREATE INDEX "maintenanceDispatchItem_companyId_idx" ON "maintenanceDispatchItem" ("companyId");

ALTER TABLE "maintenanceDispatchItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."maintenanceDispatchItem"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "maintenanceDispatchItem"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role()
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "maintenanceDispatchItem"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_update')
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "maintenanceDispatchItem"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );

-- Standard replacement parts for work centers
CREATE TABLE "workCenterReplacementPart" (
  "id" TEXT NOT NULL DEFAULT id(),
  "workCenterId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitOfMeasureCode" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "workCenterReplacementPart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workCenterReplacementPart_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "workCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterReplacementPart_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterReplacementPart_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterReplacementPart_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workCenterReplacementPart_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "workCenterReplacementPart_workCenterId_idx" ON "workCenterReplacementPart" ("workCenterId");
CREATE INDEX "workCenterReplacementPart_itemId_idx" ON "workCenterReplacementPart" ("itemId");
CREATE INDEX "workCenterReplacementPart_companyId_idx" ON "workCenterReplacementPart" ("companyId");

ALTER TABLE "workCenterReplacementPart" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."workCenterReplacementPart"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('resources_view')
      )::text[]
    )
  );

CREATE POLICY "INSERT" ON "workCenterReplacementPart"
  FOR INSERT
  WITH CHECK (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_create')
      )::text[]
    )
  );

CREATE POLICY "UPDATE" ON "workCenterReplacementPart"
  FOR UPDATE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_update')
      )::text[]
    )
  );

CREATE POLICY "DELETE" ON "workCenterReplacementPart"
  FOR DELETE USING (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_permission('resources_delete')
      )::text[]
    )
  );
  
-- Company settings for maintenance scheduling
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "maintenanceGenerateInAdvance" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "maintenanceAdvanceDays" INTEGER NOT NULL DEFAULT 3;

-- salesRfq sequence for existing companies
INSERT INTO "sequence" (
  "table", 
  "name", 
  "prefix", 
  "suffix", 
  "next", 
  "size", 
  "step", 
  "companyId"
) 
SELECT 
  'maintenanceDispatch',
  'Maintenance Dispatch',
  'MAIN',
  null,
  0,
  6,
  1,
  id
FROM "company" 
ON CONFLICT DO NOTHING;