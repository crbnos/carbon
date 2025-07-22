INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('nonConformanceType', 'Issue Type', 'Quality');

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('gaugeType', 'Gauge Type', 'Quality');

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('gaugeCalibrationRecord', 'Gauge Calibration Record', 'Quality');

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('gauge', 'Gauge', 'Quality');

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

-- Insert issue types for all existing companies
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


CREATE TYPE "gaugeStatus" AS ENUM (
  'Active',
  'Inactive'
);


CREATE TYPE "gaugeRole" AS ENUM (
  'Master',
  'Standard'
);

CREATE TYPE "gaugeCalibrationStatus" AS ENUM (
  'Pending',
  'In-Calibration',
  'Out-of-Calibration'
);

CREATE TABLE "gauge" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "gaugeId" TEXT NOT NULL,
  "supplierId" TEXT,
  "modelNumber" TEXT,
  "serialNumber" TEXT,
  "description" TEXT,
  "dateAcquired" DATE,
  "gaugeTypeId" TEXT NOT NULL,
  "gaugeCalibrationStatus" "gaugeCalibrationStatus" NOT NULL DEFAULT 'Pending',
  "gaugeStatus" "gaugeStatus" NOT NULL DEFAULT 'Active',
  "gaugeRole" "gaugeRole" NOT NULL DEFAULT 'Standard',
  "calibrationIntervalInMonths" INTEGER NOT NULL DEFAULT 6,
  "lastCalibrationDate" DATE,
  "nextCalibrationDate" DATE,
  "locationId" TEXT,
  "shelfId" TEXT,
  "companyId" TEXT,
  "customFields" JSON NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "gauge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gauge_gaugeId_unique" UNIQUE ("gaugeId", "companyId"),
  CONSTRAINT "gauge_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gauge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gauge_gaugeTypeId_fkey" FOREIGN KEY ("gaugeTypeId") REFERENCES "gaugeType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gauge_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gauge_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelf"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gauge_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "gauge_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "gauge_companyId_idx" ON "gauge" ("companyId");
CREATE INDEX "gauge_gaugeTypeId_idx" ON "gauge" ("gaugeTypeId");
CREATE INDEX "gauge_locationId_idx" ON "gauge" ("locationId");
CREATE INDEX "gauge_shelfId_idx" ON "gauge" ("shelfId");

CREATE OR REPLACE VIEW "gauges" WITH(SECURITY_INVOKER=true) AS
 SELECT
  g.*,
   CASE 
    WHEN g."gaugeStatus" = 'Inactive' THEN 'Out-of-Calibration'
    WHEN g."nextCalibrationDate" IS NOT NULL AND g."nextCalibrationDate" < CURRENT_DATE THEN 'Out-of-Calibration'
    ELSE g."gaugeCalibrationStatus"
  END as "gaugeCalibrationStatusWithDueDate"
FROM "gauge" g;


INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 
  'gauge',
  'Gauge',
  'G',
  NULL,
  0,
  6,
  1,
  "id"
FROM "company";


CREATE POLICY "SELECT" ON "public"."gauge"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."gauge"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."gauge"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."gauge"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);


CREATE TYPE "inspectionStatus" AS ENUM (
  'Pass',
  'Fail'
);

CREATE TABLE "gaugeCalibrationRecord" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "gaugeId" TEXT NOT NULL,
  "dateCalibrated" DATE NOT NULL,
  "inspectionStatus" "inspectionStatus" NOT NULL,
  "requiresAction" BOOLEAN NOT NULL DEFAULT FALSE,
  "requiresAdjustment" BOOLEAN NOT NULL DEFAULT FALSE,
  "requiresRepair" BOOLEAN NOT NULL DEFAULT FALSE,
  "notes" JSON NOT NULL DEFAULT '{}',
  "customFields" JSON NOT NULL DEFAULT '{}',
  "companyId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "gaugeCalibrationRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gaugeCalibrationRecord_gaugeId_fkey" FOREIGN KEY ("gaugeId") REFERENCES "gauge"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gaugeCalibrationRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gaugeCalibrationRecord_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "gaugeCalibrationRecord_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "gaugeCalibrationRecord_companyId_idx" ON "gaugeCalibrationRecord" ("companyId");
CREATE INDEX "gaugeCalibrationRecord_gaugeId_idx" ON "gaugeCalibrationRecord" ("gaugeId");

CREATE OR REPLACE VIEW "gaugeCalibrationRecords" WITH(SECURITY_INVOKER=true) AS
SELECT
  gcr.id,
  gcr."gaugeId",
  gcr."dateCalibrated",
  gcr."inspectionStatus",
  gcr."requiresAction",
  gcr."requiresAdjustment",
  gcr."requiresRepair",
  gcr."notes",
  gcr."customFields",
  gcr."companyId",
  gcr."createdAt",
  gcr."createdBy",
  gcr."updatedAt",
  gcr."updatedBy",
  g."gaugeId" as "gaugeReadableId",
  g."gaugeTypeId",
  g."description"
FROM "gaugeCalibrationRecord" gcr
JOIN "gauge" g ON gcr."gaugeId" = g."id";



CREATE POLICY "SELECT" ON "public"."gaugeCalibrationRecord"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."gaugeCalibrationRecord"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."gaugeCalibrationRecord"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."gaugeCalibrationRecord"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);