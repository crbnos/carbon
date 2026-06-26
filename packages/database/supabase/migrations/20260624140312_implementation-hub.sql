-- Implementation Hub — per-company guided implementation workspace.
-- Content/templates live in code (@carbon/onboarding); these tables hold only
-- the per-company editable/stateful layer: hub config, toggles, fill-in values,
-- and custom rows. Internal-vs-customer edit rights are enforced in-app via
-- isInternal + field ownership; RLS just gates company-employee access.

CREATE TYPE "implementationTier" AS ENUM ('self_serve', 'guided', 'enterprise');
CREATE TYPE "implementationStatus" AS ENUM ('tailoring', 'shared', 'active', 'complete', 'archived');
CREATE TYPE "implementationStateKind" AS ENUM ('gate', 'task', 'check', 'scopeFlag', 'productStep', 'fmt');

-- 1:1 satellite of company (PK = company.id, like companySettings / companyPlan)
CREATE TABLE "implementationHub" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL DEFAULT 'standard',
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "tier" "implementationTier" NOT NULL DEFAULT 'self_serve',
    "status" "implementationStatus" NOT NULL DEFAULT 'tailoring',
    "exclusions" JSONB NOT NULL DEFAULT '{"modules":[],"pages":[],"sections":[]}',
    "contacts" JSONB NOT NULL DEFAULT '{}',
    "signedAt" TIMESTAMP WITH TIME ZONE,
    "signedBy" TEXT REFERENCES "user"("id"),

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "implementationHub_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "implementationHub_id_fkey" FOREIGN KEY ("id") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "implementationHub_createdBy_idx" ON "implementationHub" ("createdBy");

ALTER TABLE "public"."implementationHub" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."implementationHub"
FOR SELECT USING (
  "id" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."implementationHub"
FOR INSERT WITH CHECK (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
);

-- Any company employee may write the hub row; structural edits (tier/exclusions/
-- contacts) are gated in-app by isInternal.
CREATE POLICY "UPDATE" ON "public"."implementationHub"
FOR UPDATE USING (
  "id" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "DELETE" ON "public"."implementationHub"
FOR DELETE USING (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);

-- Per-key toggle/completion layer (the prototype's state.el). Upsert by
-- (companyId, itemKey).
CREATE TABLE "implementationCheckState" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "kind" "implementationStateKind" NOT NULL,
    "value" TEXT NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "implementationCheckState_companyId_idx" ON "implementationCheckState" ("companyId");
CREATE INDEX "implementationCheckState_createdBy_idx" ON "implementationCheckState" ("createdBy");
ALTER TABLE "implementationCheckState" ADD CONSTRAINT "implementationCheckState_companyId_itemKey_key"
    UNIQUE ("companyId", "itemKey");

ALTER TABLE "public"."implementationCheckState" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."implementationCheckState"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."implementationCheckState"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "UPDATE" ON "public"."implementationCheckState"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "DELETE" ON "public"."implementationCheckState"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);

-- Per-key fill-in / chip overrides (the prototype's state.el["txt:*"]).
CREATE TABLE "implementationFieldValue" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "implementationFieldValue_companyId_idx" ON "implementationFieldValue" ("companyId");
CREATE INDEX "implementationFieldValue_createdBy_idx" ON "implementationFieldValue" ("createdBy");
ALTER TABLE "implementationFieldValue" ADD CONSTRAINT "implementationFieldValue_companyId_fieldKey_key"
    UNIQUE ("companyId", "fieldKey");

ALTER TABLE "public"."implementationFieldValue" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."implementationFieldValue"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."implementationFieldValue"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "UPDATE" ON "public"."implementationFieldValue"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "DELETE" ON "public"."implementationFieldValue"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);

-- Staff/customer "+ Add a row" custom rows (the prototype's state.added).
CREATE TABLE "implementationRow" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "implementationRow_companyId_idx" ON "implementationRow" ("companyId");
CREATE INDEX "implementationRow_createdBy_idx" ON "implementationRow" ("createdBy");

ALTER TABLE "public"."implementationRow" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."implementationRow"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."implementationRow"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "UPDATE" ON "public"."implementationRow"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "DELETE" ON "public"."implementationRow"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

-- Surface all four tables over realtime so staff edits and customer toggles
-- propagate live both directions (client revalidates on event; default replica
-- identity / primary key is enough — no payload columns are read).
ALTER PUBLICATION supabase_realtime ADD TABLE "implementationHub";
ALTER PUBLICATION supabase_realtime ADD TABLE "implementationCheckState";
ALTER PUBLICATION supabase_realtime ADD TABLE "implementationFieldValue";
ALTER PUBLICATION supabase_realtime ADD TABLE "implementationRow";
