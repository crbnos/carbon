ALTER TYPE module ADD VALUE 'Quality';
DROP VIEW IF EXISTS "modules";
CREATE VIEW "modules" AS
    SELECT unnest(enum_range(NULL::module)) AS name;


-- Insert Quality module permissions for Admin, Management, and Quality employee types
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "create", "delete", "update", "view")
SELECT 
    et.id AS "employeeTypeId", 
    'Quality'::module AS "module",
    ARRAY[et."companyId"] AS "create",
    ARRAY[et."companyId"] AS "delete",
    ARRAY[et."companyId"] AS "update",
    ARRAY[et."companyId"] AS "view"
FROM "employeeType" et
WHERE et.name IN ('Admin', 'Management', 'Quality')
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;


-- Update userPermission table to add Quality module permissions based on Production permissions
UPDATE "userPermission"
SET "permissions" = "permissions" || jsonb_build_object(
  'quality_view', COALESCE("permissions"->'production_view', '[]'::jsonb),
  'quality_create', COALESCE("permissions"->'production_create', '[]'::jsonb),
  'quality_update', COALESCE("permissions"->'production_update', '[]'::jsonb),
  'quality_delete', COALESCE("permissions"->'production_delete', '[]'::jsonb)
);




