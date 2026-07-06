-- Print Manager: module enum, tables, indexes, RLS, and permission seeding

ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'Printing';

COMMIT;

DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" AS
    SELECT unnest(enum_range(NULL::module)) AS name;

-- Insert Printing module permissions for Admin and Management employee types
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT
    et.id AS "employeeTypeId",
    'Printing'::module AS "module",
    ARRAY[et."companyId"] AS "create",
    ARRAY[et."companyId"] AS "delete",
    ARRAY[et."companyId"] AS "update",
    ARRAY[et."companyId"] AS "view"
FROM "employeeType" et
WHERE et.name IN ('Admin', 'Management')
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Update userPermission table to add Printing module permissions based on Settings permissions
UPDATE "userPermission"
SET "permissions" = "permissions" || jsonb_build_object(
  'printing_view', COALESCE("permissions"->'settings_view', '[]'::jsonb),
  'printing_create', COALESCE("permissions"->'settings_create', '[]'::jsonb),
  'printing_update', COALESCE("permissions"->'settings_update', '[]'::jsonb),
  'printing_delete', COALESCE("permissions"->'settings_delete', '[]'::jsonb)
);

-- Auto-print settings on companySettings
ALTER TABLE "companySettings" ADD COLUMN IF NOT EXISTS "printing" jsonb;

-- Printer routing: physical printer definitions
CREATE TABLE "printerRoute" (
  "id" text NOT NULL DEFAULT id('pr'),
  "companyId" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "locationId" text REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "name" text NOT NULL,
  "format" text NOT NULL CHECK ("format" IN ('zpl', 'pdf')),
  "mediaSizeId" text,
  "printerUrl" text NOT NULL,
  "apiKey" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz,
  PRIMARY KEY ("id", "companyId")
);

CREATE UNIQUE INDEX "printerRoute_name_unique"
  ON "printerRoute" ("companyId", COALESCE("locationId", ''), "name");

CREATE INDEX "printerRoute_locationId_idx"
  ON "printerRoute" ("companyId", "locationId");

ALTER TABLE "printerRoute" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "printerRoute"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_view'))::text[])
  );

CREATE POLICY "INSERT" ON "printerRoute"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "printerRoute"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_update'))::text[])
  );

CREATE POLICY "DELETE" ON "printerRoute"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_delete'))::text[])
  );

-- Print job queue/audit table
CREATE TABLE "printJob" (
  "id" text NOT NULL DEFAULT id('pj'),
  "companyId" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" text NOT NULL DEFAULT 'generating'
    CHECK ("status" IN ('generating', 'queued', 'printing', 'completed', 'failed')),
  "contentType" text CHECK ("contentType" IN ('zpl', 'pdf')),
  "content" text,
  "printerUrl" text NOT NULL,
  "sourceDocument" text NOT NULL,
  "sourceDocumentId" text NOT NULL,
  "sourceDocumentReadableId" text,
  "description" text NOT NULL,
  "origin" text NOT NULL DEFAULT 'auto'
    CHECK ("origin" IN ('auto', 'manual', 'reprint')),
  "error" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "createdBy" text NOT NULL REFERENCES "user"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz,
  "updatedBy" text,
  "completedAt" timestamptz,
  PRIMARY KEY ("id", "companyId")
);

CREATE INDEX "printJob_companyId_idx" ON "printJob" ("companyId");
CREATE INDEX "printJob_status_idx" ON "printJob" ("companyId", "status");
CREATE INDEX "printJob_createdAt_idx" ON "printJob" ("companyId", "createdAt" DESC);

ALTER TABLE "printJob" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "printJob"
  FOR SELECT USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_view'))::text[])
  );

CREATE POLICY "INSERT" ON "printJob"
  FOR INSERT WITH CHECK (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_create'))::text[])
  );

CREATE POLICY "UPDATE" ON "printJob"
  FOR UPDATE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_update'))::text[])
  );

CREATE POLICY "DELETE" ON "printJob"
  FOR DELETE USING (
    "companyId" = ANY ((SELECT get_companies_with_employee_permission('printing_delete'))::text[])
  );

-- Enable Realtime for Print Manager live status updates
ALTER PUBLICATION supabase_realtime ADD TABLE "printJob";
