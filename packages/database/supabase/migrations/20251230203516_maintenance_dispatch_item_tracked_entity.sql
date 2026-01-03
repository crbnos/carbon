-- Junction table to link maintenance dispatch items to tracked entities (serial/batch)
CREATE TABLE IF NOT EXISTS "maintenanceDispatchItemTrackedEntity" (
  "id" TEXT NOT NULL DEFAULT id(),
  "maintenanceDispatchItemId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "maintenanceDispatchItemTrackedEntity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenanceDispatchItemTrackedEntity_maintenanceDispatchItemId_fkey" FOREIGN KEY ("maintenanceDispatchItemId") REFERENCES "maintenanceDispatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItemTrackedEntity_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItemTrackedEntity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItemTrackedEntity_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenanceDispatchItemTrackedEntity_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "maintenanceDispatchItemTrackedEntity_maintenanceDispatchItemId_idx"
  ON "maintenanceDispatchItemTrackedEntity"("maintenanceDispatchItemId");
CREATE INDEX IF NOT EXISTS "maintenanceDispatchItemTrackedEntity_trackedEntityId_idx"
  ON "maintenanceDispatchItemTrackedEntity"("trackedEntityId");
CREATE INDEX IF NOT EXISTS "maintenanceDispatchItemTrackedEntity_companyId_idx"
  ON "maintenanceDispatchItemTrackedEntity"("companyId");
-- Enable RLS
ALTER TABLE "maintenanceDispatchItemTrackedEntity" ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "SELECT" ON "maintenanceDispatchItemTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "maintenanceDispatchItemTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "maintenanceDispatchItemTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('maintenance_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "maintenanceDispatchItemTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission('maintenance_delete')
    )::text[]
  )
);
