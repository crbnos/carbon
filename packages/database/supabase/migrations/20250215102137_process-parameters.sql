CREATE TABLE "methodOperationParameter" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "methodOperationParameter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "methodOperationParameter_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "methodOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "methodOperationParameter_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "methodOperationParameter_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "methodOperationParameter_companyId_idx" ON "methodOperationParameter"("companyId");
CREATE INDEX "methodOperationParameter_operationId_idx" ON "methodOperationParameter"("operationId");

ALTER TABLE "methodOperationParameter" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."methodOperationParameter"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."methodOperationParameter"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."methodOperationParameter"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."methodOperationParameter"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);

CREATE TABLE "quoteOperationParameter" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "quoteOperationParameter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quoteOperationParameter_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "quoteOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quoteOperationParameter_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "quoteOperationParameter_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "quoteOperationParameter_companyId_idx" ON "quoteOperationParameter"("companyId");
CREATE INDEX "quoteOperationParameter_operationId_idx" ON "quoteOperationParameter"("operationId");

ALTER TABLE "quoteOperationParameter" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."quoteOperationParameter"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."quoteOperationParameter"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."quoteOperationParameter"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."quoteOperationParameter"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('parts_delete')
    )::text[]
  )
);


CREATE TABLE "jobOperationParameter" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "jobOperationParameter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jobOperationParameter_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "jobOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "jobOperationParameter_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "jobOperationParameter_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "jobOperationParameter_companyId_idx" ON "jobOperationParameter"("companyId");
CREATE INDEX "jobOperationParameter_operationId_idx" ON "jobOperationParameter"("operationId");

ALTER TABLE "jobOperationParameter" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "SELECT" ON "public"."jobOperationParameter"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."jobOperationParameter"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."jobOperationParameter"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."jobOperationParameter"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('production_delete')
    )::text[]
  )
);