-- Create custom investigation types table
CREATE TABLE "nonConformanceInvestigationType" (
  "id" TEXT NOT NULL DEFAULT id('nct'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceInvestigationType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceInvestigationType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceInvestigationType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceInvestigationType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceInvestigationType_company_name_unique" UNIQUE ("companyId", "name")
);

-- Create custom required actions table
CREATE TABLE "nonConformanceRequiredAction" (
  "id" TEXT NOT NULL DEFAULT id('nca'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceRequiredAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceRequiredAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceRequiredAction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceRequiredAction_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceRequiredAction_company_name_unique" UNIQUE ("companyId", "name")
);

-- Create indexes
CREATE INDEX "nonConformanceInvestigationType_companyId_idx" ON "nonConformanceInvestigationType" ("companyId");
CREATE INDEX "nonConformanceRequiredAction_companyId_idx" ON "nonConformanceRequiredAction" ("companyId");

-- RLS policies for nonConformanceInvestigationType
CREATE POLICY "SELECT" ON "public"."nonConformanceInvestigationType"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceInvestigationType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceInvestigationType"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceInvestigationType"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

-- RLS policies for nonConformanceRequiredAction
CREATE POLICY "SELECT" ON "public"."nonConformanceRequiredAction"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceRequiredAction"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceRequiredAction"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceRequiredAction"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

-- Enable RLS
ALTER TABLE "nonConformanceInvestigationType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nonConformanceRequiredAction" ENABLE ROW LEVEL SECURITY;

-- Populate all existing companies with default investigation types
INSERT INTO "nonConformanceInvestigationType" ("companyId", "name", "createdBy")
SELECT 
  c."id" as "companyId",
  inv_type.name,
  'system' as "createdBy"
FROM "company" c
CROSS JOIN (
  VALUES 
    ('Root Cause Analysis'),
    ('Inventory'),
    ('WIP'),
    ('Finished Goods'),
    ('Incoming Materials'),
    ('Process'),
    ('Documentation')
) AS inv_type(name);

-- Populate all existing companies with default required actions
INSERT INTO "nonConformanceRequiredAction" ("companyId", "name", "createdBy")
SELECT 
  c."id" as "companyId",
  action_type.name,
  'system' as "createdBy"
FROM "company" c
CROSS JOIN (
  VALUES 
    ('Corrective Action'),
    ('Preventive Action'),
    ('Containment Action'),
    ('Verification'),
    ('Customer Communication')
) AS action_type(name);
