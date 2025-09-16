-- First, rename the tables before creating foreign key constraints

-- Drop and recreate RLS policies for jobOperationAttribute before renaming
DROP POLICY IF EXISTS "SELECT" ON "public"."jobOperationAttribute";
DROP POLICY IF EXISTS "INSERT" ON "public"."jobOperationAttribute";
DROP POLICY IF EXISTS "UPDATE" ON "public"."jobOperationAttribute";
DROP POLICY IF EXISTS "DELETE" ON "public"."jobOperationAttribute";

-- Rename jobOperationAttribute table to jobOperationStep
ALTER TABLE "jobOperationAttribute" RENAME TO "jobOperationStep";

-- Update jobOperationStepRecord to support multiple rows per operation attribute
ALTER TABLE "jobOperationAttributeRecord" DROP CONSTRAINT "jobOperationAttributeRecord_pkey";

-- Add an id column as the new primary key
ALTER TABLE "jobOperationAttributeRecord" ADD COLUMN "id" TEXT NOT NULL DEFAULT id('step');

-- Add an index column to order the records
ALTER TABLE "jobOperationAttributeRecord" ADD COLUMN "index" INTEGER NOT NULL DEFAULT 0;

-- Set the new primary key
ALTER TABLE "jobOperationAttributeRecord" ADD CONSTRAINT "jobOperationAttributeRecord_pkey" PRIMARY KEY ("id");

-- Update the column name from jobOperationAttributeId to jobOperationStepId
ALTER TABLE "jobOperationAttributeRecord" RENAME COLUMN "jobOperationAttributeId" TO "jobOperationStepId";

-- Drop the existing foreign key constraint
ALTER TABLE "jobOperationAttributeRecord" DROP CONSTRAINT IF EXISTS "jobOperationAttributeRecord_jobOperationAttributeId_fkey";

-- Rename jobOperationAttributeRecord table to jobOperationStepRecord first
ALTER TABLE "jobOperationAttributeRecord" RENAME TO "jobOperationStepRecord";

-- Add the new foreign key constraint (now that jobOperationStep table exists)
ALTER TABLE "jobOperationStepRecord" ADD CONSTRAINT "jobOperationStepRecord_jobOperationStepId_fkey" 
  FOREIGN KEY ("jobOperationStepId") REFERENCES "jobOperationStep"("id") ON DELETE CASCADE;

-- Create a unique constraint on jobOperationStepId and index to ensure ordering
ALTER TABLE "jobOperationStepRecord" ADD CONSTRAINT "jobOperationStepRecord_jobOperationStepId_index_fkey" UNIQUE ("jobOperationStepId", "index");

-- Add index for better query performance
CREATE INDEX "jobOperationStepRecord_jobOperationStepId_index_idx" ON "jobOperationStepRecord"("jobOperationStepId", "index");

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


-- Update RLS policies for jobOperationStepRecord (already renamed above)

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

-- procedureStepType enum doesn't need renaming (already correct name)


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




-- procedureStep table doesn't need renaming (already correct name)

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
