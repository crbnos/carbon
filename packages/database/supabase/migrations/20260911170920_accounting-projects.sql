CREATE TABLE "project" (
  "id" TEXT NOT NULL DEFAULT id('prj'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  UNIQUE ("companyId", "name")
);

CREATE INDEX "project_companyId_idx" ON "project" ("companyId");
CREATE INDEX "project_createdBy_idx" ON "project" ("createdBy");
CREATE INDEX "project_updatedBy_idx" ON "project" ("updatedBy");

ALTER TABLE "public"."project" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."project"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."project"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."project"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."project"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);
