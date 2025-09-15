-- Update jobOperationStepRecord to support multiple rows per operation attribute
ALTER TABLE "jobOperationStepRecord" DROP CONSTRAINT "jobOperationStepRecord_pkey";

-- Add an id column as the new primary key
ALTER TABLE "jobOperationStepRecord" ADD COLUMN "id" TEXT NOT NULL DEFAULT id('step');

-- Add an index column to order the records
ALTER TABLE "jobOperationStepRecord" ADD COLUMN "index" INTEGER NOT NULL DEFAULT 0;

-- Set the new primary key
ALTER TABLE "jobOperationStepRecord" ADD CONSTRAINT "jobOperationStepRecord_pkey" PRIMARY KEY ("id");

-- Update the column name from jobOperationAttributeId to jobOperationStepId
ALTER TABLE "jobOperationStepRecord" RENAME COLUMN "jobOperationAttributeId" TO "jobOperationStepId";

-- Drop the existing foreign key constraint
ALTER TABLE "jobOperationStepRecord" DROP CONSTRAINT IF EXISTS "jobOperationStepRecord_jobOperationAttributeId_fkey";

-- Drop the existing foreign key constraint for jobOperationAttributeRecord
ALTER TABLE "jobOperationStepRecord" DROP CONSTRAINT IF EXISTS "jobOperationAttributeRecord_jobOperationAttributeId_fkey";


-- Add the new foreign key constraint
ALTER TABLE "jobOperationStepRecord" ADD CONSTRAINT "jobOperationStepRecord_jobOperationStepId_fkey" 
  FOREIGN KEY ("jobOperationStepId") REFERENCES "jobOperationStep"("id") ON DELETE CASCADE;


-- Create a unique constraint on jobOperationStepId and index to ensure ordering
ALTER TABLE "jobOperationStepRecord" ADD CONSTRAINT "jobOperationStepRecord_jobOperationStepId_index_fkey" UNIQUE ("jobOperationStepId", "index");

-- Add index for better query performance
CREATE INDEX "jobOperationStepRecord_jobOperationStepId_index_idx" ON "jobOperationStepRecord"("jobOperationStepId", "index");


-- Rename jobOperationStep table to jobOperationStep
ALTER TABLE "jobOperationStep" RENAME TO "jobOperationStep";

-- Drop and recreate RLS policies for the renamed table
DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationStep";

CREATE POLICY "SELECT" ON "public"."jobOperationStep"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperationStep"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperationStep"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperationStep"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);


-- Rename the table itself
ALTER TABLE "jobOperationStepRecord" RENAME TO "jobOperationStepRecord";

-- Update RLS policies for the renamed table
DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationStepRecord";
DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationStepRecord";
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationStepRecord";
DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationStepRecord";

CREATE POLICY "SELECT" ON "public"."jobOperationStepRecord"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperationStepRecord"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperationStepRecord"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperationStepRecord"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);

-- Rename procedureStepType enum to procedureStepType
ALTER TYPE "procedureStepType" RENAME TO "procedureStepType";


-- Rename methodOperationAttribute to methodOperationStep
ALTER TABLE "methodOperationAttribute" RENAME TO "methodOperationStep";

-- Update RLS policies for the renamed table
DROP POLICY IF EXISTS "SELECT" ON "public"."methodOperationStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."methodOperationStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."methodOperationStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."methodOperationStep";

CREATE POLICY "SELECT" ON "public"."methodOperationStep"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."methodOperationStep"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."methodOperationStep"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."methodOperationStep"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);


-- Rename quoteOperationAttribute table to quoteOperationStep
ALTER TABLE "quoteOperationAttribute" RENAME TO "quoteOperationStep";

-- Update RLS policies for the renamed table
DROP POLICY IF EXISTS "SELECT" ON "public"."quoteOperationStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."quoteOperationStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."quoteOperationStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."quoteOperationStep";

CREATE POLICY "SELECT" ON "public"."quoteOperationStep"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteOperationStep"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteOperationStep"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteOperationStep"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);




-- Rename procedureStep table to procedureStep
ALTER TABLE "procedureStep" RENAME TO "procedureStep";

-- Update RLS policies for the renamed table
DROP POLICY IF EXISTS "SELECT" ON "public"."procedureStep";
DROP POLICY IF EXISTS "INSERT" ON "public"."procedureStep";
DROP POLICY IF EXISTS "UPDATE" ON "public"."procedureStep";
DROP POLICY IF EXISTS "DELETE" ON "public"."procedureStep";

CREATE POLICY "SELECT" ON "public"."procedureStep"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."procedureStep"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."procedureStep"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."procedureStep"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);
