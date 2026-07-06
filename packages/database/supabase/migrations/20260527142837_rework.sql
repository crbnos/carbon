-- 1. Create the rework table
CREATE TABLE "rework" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "jobId" TEXT NOT NULL,
  "triggeredAtJobOperationId" TEXT NOT NULL,
  "targetJobOperationId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "quantity" NUMERIC(10,4) NOT NULL,
  "trackedEntityId" TEXT,
  "requestedById" TEXT NOT NULL,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "rework_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rework_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rework_triggeredAtJobOperationId_fkey" FOREIGN KEY ("triggeredAtJobOperationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "rework_targetJobOperationId_fkey" FOREIGN KEY ("targetJobOperationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE,
  CONSTRAINT "rework_trackedEntityId_fkey" FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE SET NULL,
  CONSTRAINT "rework_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rework_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "rework_jobId_idx" ON "rework"("jobId");
CREATE INDEX "rework_companyId_idx" ON "rework"("companyId");

-- 2. RLS policies for rework
ALTER TABLE "rework" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "rework"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "rework"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "rework"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "rework"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );

-- 3. Drop views that use jo.* before altering jobOperation
DROP VIEW IF EXISTS "jobOperationsWithDependencies";
DROP VIEW IF EXISTS "jobOperationsWithMakeMethods";

-- 4. Add reworkId column to jobOperation
ALTER TABLE "jobOperation" ADD COLUMN "reworkId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_reworkId_fkey"
  FOREIGN KEY ("reworkId") REFERENCES "rework"("id") ON DELETE SET NULL;

CREATE INDEX "jobOperation_reworkId_idx" ON "jobOperation"("reworkId");

-- 5. Recreate views with the new column included
CREATE OR REPLACE VIEW "jobOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT
    mm.id AS "makeMethodId",
    jo.*
  FROM "jobOperation" jo
  INNER JOIN "jobMakeMethod" jmm
    ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "makeMethod" mm
    ON jmm."itemId" = mm."itemId" AND jmm."version" = mm."version";

CREATE VIEW "jobOperationsWithDependencies"
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

-- 6. Trigger to mark rework as complete when all its operations are done
CREATE OR REPLACE FUNCTION complete_rework_on_operation_done()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Done' AND NEW."reworkId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "jobOperation"
      WHERE "reworkId" = NEW."reworkId"
        AND "id" != NEW."id"
        AND "status" != 'Done'
    ) THEN
      UPDATE "rework"
      SET "completedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = NEW."reworkId"
        AND "completedAt" IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER complete_rework_trigger
AFTER UPDATE OF "status" ON "jobOperation"
FOR EACH ROW
WHEN (NEW.status = 'Done')
EXECUTE FUNCTION complete_rework_on_operation_done();
