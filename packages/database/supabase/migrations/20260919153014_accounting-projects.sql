-- Accounting Projects: the project master, its default journal dimension, and
-- project coding on the two Ramp-fed line tables. The 'Project' dimensionEntityType
-- value is added in the prior migration (accounting-project-dimension-enum), a
-- separate transaction, so it is safe to reference in the backfill below.

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

-- Backfill the default "Project" entity-backed dimension for every existing company
-- group. Dimensions are user-configured per company group, but slice 2 of the Projects
-- feature expects a Project dimension to exist so a project is selectable on journal
-- lines. New-company seeding covers this via functions/lib/seed.data.ts; this covers
-- pre-existing groups.
--
-- Idempotent: the partial unique index on (name, companyGroupId) WHERE active = true plus
-- ON CONFLICT DO NOTHING guarantees no duplicate. Name mirrors seed.data.ts exactly
-- ("Project"). Inserted rows default active = true.
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Project', 'Project'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;

-- Project coding on the two Ramp-fed line tables, mirroring their existing
-- costCenterId columns. A project chosen in Ramp is decoded (codeSelections) and
-- staged onto these columns, then post-card-transaction / post-purchase-invoice
-- write it as a Project journalLineDimension. The `project` PK is composite
-- ("id","companyId") with no standalone unique on "id", so the FK is tenant-composite
-- (unlike the pre-existing single-column costCenter FK on purchaseInvoiceLine).
-- Idempotent: guard every statement for the retryable deploy runner.

ALTER TABLE "cardTransactionLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cardTransactionLine_projectId_fkey'
  ) THEN
    ALTER TABLE "cardTransactionLine"
      ADD CONSTRAINT "cardTransactionLine_projectId_fkey"
      FOREIGN KEY ("projectId", "companyId")
      REFERENCES "project"("id", "companyId")
      ON UPDATE CASCADE ON DELETE SET NULL ("projectId");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "cardTransactionLine_projectId_idx"
  ON "cardTransactionLine"("projectId");

ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchaseInvoiceLine_projectId_fkey'
  ) THEN
    ALTER TABLE "purchaseInvoiceLine"
      ADD CONSTRAINT "purchaseInvoiceLine_projectId_fkey"
      FOREIGN KEY ("projectId", "companyId")
      REFERENCES "project"("id", "companyId")
      ON UPDATE CASCADE ON DELETE SET NULL ("projectId");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "purchaseInvoiceLine_projectId_idx"
  ON "purchaseInvoiceLine"("projectId");
