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

CREATE TYPE "procedureAttributeType" AS ENUM (
  'Value',
  'Measurement',
  'Checkbox',
  'Timestamp',
  'Person',
  'List',
  'File'
);

CREATE TABLE "procedureAttribute" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "procedureId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "required" BOOLEAN DEFAULT FALSE,
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "type" "procedureAttributeType" NOT NULL,
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

  CONSTRAINT "procedureAttribute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "procedureAttribute_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedureAttribute_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "procedureAttribute_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "procedureAttribute_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "procedureAttribute_uom_measurement_only" CHECK (
    ("type" = 'Measurement' AND "unitOfMeasureCode" IS NOT NULL) OR
    ("type" != 'Measurement' AND "unitOfMeasureCode" IS NULL)
  ),
  CONSTRAINT "procedureAttribute_unitOfMeasureCode_fkey" FOREIGN KEY ("unitOfMeasureCode", "companyId") REFERENCES "unitOfMeasure"("code", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "procedureAttribute_procedureId_idx" ON "procedureAttribute" ("procedureId");
CREATE INDEX "procedureAttribute_companyId_idx" ON "procedureAttribute" ("companyId");

ALTER TABLE "procedureAttribute" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."procedureAttribute"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."procedureAttribute"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."procedureAttribute"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."procedureAttribute"
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

  