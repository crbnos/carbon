CREATE TYPE "procedureStatus" AS ENUM (
  'Draft',
  'Active',
  'Archived'
);

CREATE TABLE "procedure" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "processId" TEXT,
  "description" TEXT,
  "version" NUMERIC NOT NULL DEFAULT 0,
  "status" "procedureStatus" NOT NULL DEFAULT 'Draft',
  "content" JSON DEFAULT '{}',
  "assignee" TEXT,
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "procedure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "procedure_version_check" CHECK ("version" >= 0),
  CONSTRAINT "procedure_version_unique" UNIQUE ("name", "companyId", "version"),
  CONSTRAINT "procedure_processId_fkey" FOREIGN KEY ("processId") REFERENCES "process"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedure_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "procedure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedure_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "procedure_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "procedure_companyId_idx" ON "procedure" ("companyId");
CREATE INDEX "procedure_processId_idx" ON "procedure" ("processId");

ALTER TABLE "procedure" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."procedure"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."procedure"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."procedure"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."procedure"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);

CREATE TYPE "procedureStepType" AS ENUM (
  'Value',
  'Measurement',
  'Checkbox',
  'Timestamp',
  'Person',
  'List',
  'File'
);

CREATE TABLE "procedureStep" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "procedureId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "required" BOOLEAN DEFAULT FALSE,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "type" "procedureStepType" NOT NULL,
  "unitOfMeasureCode" TEXT,
  "minValue" DECIMAL,
  "maxValue" DECIMAL,
  "listValues" TEXT[],
  "fileTypes" TEXT[],
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "procedureStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "procedureStep_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedureStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedureStep_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "procedureStep_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "procedureStep_uom_measurement_only" CHECK (
    ("type" = 'Measurement' AND "unitOfMeasureCode" IS NOT NULL) OR
    ("type" != 'Measurement' AND "unitOfMeasureCode" IS NULL)
  ),
  CONSTRAINT "procedureStep_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "procedureStep_procedureId_idx" ON "procedureStep" ("procedureId");
CREATE INDEX "procedureStep_companyId_idx" ON "procedureStep" ("companyId");

ALTER TABLE "procedureStep" ENABLE ROW LEVEL SECURITY;


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

DROP VIEW IF EXISTS "procedures";
CREATE OR REPLACE VIEW "procedures" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    p1."id",
    p1."name",
    p1."version",
    p1."status",
    p1."assignee",
    p1."companyId",
    p1."processId",
    jsonb_agg(
      jsonb_build_object(
        'id', p2."id",
        'version', p2."version", 
        'status', p2."status"
      )
    ) as "versions"
  FROM "procedure" p1
  JOIN "procedure" p2 ON p1."name" = p2."name" AND p1."companyId" = p2."companyId"
  WHERE p1."version" = (
    SELECT MAX("version")
    FROM "procedure" p3 
    WHERE p3."name" = p1."name"
    AND p3."companyId" = p1."companyId"
  )
  GROUP BY p1."id", p1."name", p1."version", p1."status", p1."assignee", p1."companyId", p1."processId";

  
CREATE TABLE "methodOperationAttribute" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "required" BOOLEAN DEFAULT FALSE,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "type" "procedureStepType" NOT NULL,
  "unitOfMeasureCode" TEXT,
  "minValue" DECIMAL,
  "maxValue" DECIMAL,
  "listValues" TEXT[],
  "fileTypes" TEXT[],
  "operationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "methodOperationAttribute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "methodOperationAttribute_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "methodOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "methodOperationAttribute_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "methodOperationAttribute_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "methodOperationAttribute_companyId_idx" ON "methodOperationAttribute"("companyId");
CREATE INDEX "methodOperationAttribute_operationId_idx" ON "methodOperationAttribute"("operationId");

ALTER TABLE "methodOperationAttribute" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."methodOperationAttribute"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."methodOperationAttribute"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."methodOperationAttribute"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."methodOperationAttribute"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

CREATE TABLE "quoteOperationAttribute" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "required" BOOLEAN DEFAULT FALSE,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "type" "procedureStepType" NOT NULL,
  "unitOfMeasureCode" TEXT,
  "minValue" DECIMAL,
  "maxValue" DECIMAL,
  "listValues" TEXT[],
  "fileTypes" TEXT[],
  "operationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "quoteOperationAttribute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteOperationAttribute_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "quoteOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteOperationAttribute_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "quoteOperationAttribute_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "quoteOperationAttribute_companyId_idx" ON "quoteOperationAttribute"("companyId");
CREATE INDEX "quoteOperationAttribute_operationId_idx" ON "quoteOperationAttribute"("operationId");

ALTER TABLE "quoteOperationAttribute" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."quoteOperationAttribute"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteOperationAttribute"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteOperationAttribute"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteOperationAttribute"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);


CREATE TABLE "jobOperationAttribute" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "required" BOOLEAN DEFAULT FALSE,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "type" "procedureStepType" NOT NULL,
  "unitOfMeasureCode" TEXT,
  "minValue" DECIMAL,
  "maxValue" DECIMAL,
  "listValues" TEXT[],
  "fileTypes" TEXT[],
  "operationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "jobOperationAttribute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperationAttribute_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperationAttribute_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "jobOperationAttribute_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "jobOperationAttribute_companyId_idx" ON "jobOperationAttribute"("companyId");
CREATE INDEX "jobOperationAttribute_operationId_idx" ON "jobOperationAttribute"("operationId");

ALTER TABLE "jobOperationAttribute" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."jobOperationAttribute"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperationAttribute"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperationAttribute"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperationAttribute"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);


CREATE TABLE "procedureParameter" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "procedureId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "procedureParameter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "procedureParameter_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedureParameter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedureParameter_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "procedureParameter_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "procedureParameter_procedureId_idx" ON "procedureParameter" ("procedureId");
CREATE INDEX "procedureParameter_companyId_idx" ON "procedureParameter" ("companyId");

ALTER TABLE "procedureParameter" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."procedureParameter"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."procedureParameter"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."procedureParameter"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."procedureParameter"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);

ALTER TABLE "methodOperation" ADD COLUMN "procedureId" TEXT;
ALTER TABLE "methodOperation" ADD CONSTRAINT "methodOperation_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jobOperation" ADD COLUMN "procedureId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quoteOperation" ADD COLUMN "procedureId" TEXT;
ALTER TABLE "quoteOperation" ADD CONSTRAINT "quoteOperation_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DROP TABLE IF EXISTS "jobOperationAttributeRecord";
CREATE TABLE "jobOperationAttributeRecord" (
  "jobOperationAttributeId" TEXT NOT NULL,
  "value" TEXT,
  "numericValue" NUMERIC,
  "booleanValue" BOOLEAN,
  "userValue" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "jobOperationAttributeRecord_pkey" PRIMARY KEY ("jobOperationAttributeId"),
  CONSTRAINT "jobOperationAttributeRecord_jobOperationAttributeId_fkey" FOREIGN KEY ("jobOperationAttributeId") REFERENCES "jobOperationAttribute"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperationAttributeRecord_userValue_fkey" FOREIGN KEY ("userValue") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "jobOperationAttributeRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperationAttributeRecord_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "jobOperationAttributeRecord_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "jobOperationAttributeRecord_companyId_idx" ON "jobOperationAttributeRecord"("companyId");
CREATE INDEX "jobOperationAttributeRecord_jobOperationAttributeId_idx" ON "jobOperationAttributeRecord"("jobOperationAttributeId");

ALTER TABLE "jobOperationAttributeRecord" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."jobOperationAttributeRecord"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperationAttributeRecord"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperationAttributeRecord"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperationAttributeRecord"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);

DROP POLICY IF EXISTS "Job documents insert requires employee role" ON storage.objects;
CREATE POLICY "Job documents insert requires employee role" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'job'
);

CREATE OR REPLACE VIEW "jobOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    mm.id AS "makeMethodId",
    jo.*
  FROM "jobOperation" jo
  INNER JOIN "jobMakeMethod" jmm 
    ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "makeMethod" mm 
    ON jmm."itemId" = mm."itemId";


DROP VIEW "quoteOperationsWithMakeMethods";
COMMIT; 
CREATE OR REPLACE VIEW "quoteOperationsWithMakeMethods" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    mm.id AS "makeMethodId",
    qo.*
  FROM "quoteOperation" qo
  INNER JOIN "quoteMakeMethod" qmm 
    ON qo."quoteMakeMethodId" = qmm.id
  LEFT JOIN "makeMethod" mm 
    ON qmm."itemId" = mm."itemId";