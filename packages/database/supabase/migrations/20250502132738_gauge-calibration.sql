INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('nonConformanceType', 'Non-Conformance Type', 'Quality');

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('gaugeType', 'Gauge Type', 'Quality');

ALTER TABLE "nonConformanceType"
ADD COLUMN "customFields" JSON NOT NULL DEFAULT '{}';

CREATE TABLE "gaugeType" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "customFields" JSON NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "gaugeType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gaugeType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gaugeType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "gaugeType_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "gaugeType_companyId_idx" ON "gaugeType" ("companyId");

CREATE POLICY "SELECT" ON "public"."gaugeType"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."gaugeType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."gaugeType"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."gaugeType"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

-- Insert non-conformance types for all existing companies
WITH nc_types AS (
  SELECT unnest(ARRAY[
    'Gauge Block',
    'Caliper - Inside',
    'Caliper - Outside',
    'Caliper - Depth',
    'Micrometer - Outside',
    'Micrometer - Inside',
    'Micrometer - Depth',
    'Dial Indicator',
    'Height Gauge',
    'Thread Gauge',
    'Pin Gauge',
    'Ring Gauge',
    'Plug Gauge',
    'Bore Gauge',
    'Feeler Gauge',
    'Surface Plate',
    'Go/No-Go Gauge',
    'Profile Gauge',
    'Coordinate Measuring Machine (CMM)',
    'Optical Comparator'
  ]) AS name
)
INSERT INTO "gaugeType" ("name", "companyId", "createdBy")
SELECT 
  nc_types.name,
  c.id,
  'system'
FROM 
  "company" c,
  nc_types;