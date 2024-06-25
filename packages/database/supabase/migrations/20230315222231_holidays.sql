CREATE TABLE "holiday" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "year" INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM "date")) STORED,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP,
  "customFields" JSONB,

  CONSTRAINT "holiday_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_holiday_date" UNIQUE ("date", "companyId"),
  CONSTRAINT "holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "holiday_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "holiday_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "holiday_companyId_idx" ON "holiday" ("companyId");

CREATE OR REPLACE VIEW "holidayYears" AS SELECT DISTINCT "year", "companyId" FROM "holiday";

ALTER TABLE "holiday" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view holidays" ON "holiday"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    "companyId" = ANY(
      select "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees with resources_create can insert holidays" ON "holiday"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId") AND
    has_company_permission('resources_create', "companyId")
);

CREATE POLICY "Employees with resources_update can update holidays" ON "holiday"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_update', "companyId")
  );

CREATE POLICY "Employees with resources_delete can delete holidays" ON "holiday"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('resources_delete', "companyId")
  );
