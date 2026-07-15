-- Configurable default/template actions for Change Orders. Mirrors
-- nonConformanceRequiredAction (Quality), but company-scoped with a composite PK
-- and no systemType/protection (all CO templates are freely deletable). New
-- change orders instantiate one changeOrderActionTask per active row (in
-- insertChangeOrder -> seedDefaultChangeOrderActions).

CREATE TABLE IF NOT EXISTS "changeOrderRequiredAction" (
  "id" TEXT NOT NULL DEFAULT id('cora'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "changeOrderRequiredAction_companyId_idx" ON "changeOrderRequiredAction" ("companyId");
CREATE INDEX IF NOT EXISTS "changeOrderRequiredAction_createdBy_idx" ON "changeOrderRequiredAction" ("createdBy");

ALTER TABLE "changeOrderRequiredAction" DROP CONSTRAINT IF EXISTS "changeOrderRequiredAction_companyId_name_key";
ALTER TABLE "changeOrderRequiredAction" ADD CONSTRAINT "changeOrderRequiredAction_companyId_name_key" UNIQUE ("companyId", "name");

ALTER TABLE "public"."changeOrderRequiredAction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."changeOrderRequiredAction"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."changeOrderRequiredAction"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."changeOrderRequiredAction"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."changeOrderRequiredAction"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- Backfill defaults for existing companies (guarded on the system user for the
-- createdBy FK; idempotent via the (companyId, name) unique constraint).
INSERT INTO "changeOrderRequiredAction" ("companyId", "name", "createdBy")
SELECT c."id", action.name, 'system'
FROM "company" c
CROSS JOIN (VALUES
  ('Engineering Review'),
  ('Update Drawings / CAD'),
  ('Update BOM / Routing'),
  ('Cost Impact Review'),
  ('Quality Review'),
  ('Inventory Disposition (rework / scrap / use-as-is)'),
  ('Notify Affected Parties')
) AS action(name)
ON CONFLICT ("companyId", "name") DO NOTHING;
