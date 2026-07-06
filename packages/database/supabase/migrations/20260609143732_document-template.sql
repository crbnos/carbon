CREATE TABLE "documentTemplate" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    -- Schema version of `blocks`/`theme`; app migrates older rows forward on read.
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "theme" JSONB NOT NULL DEFAULT '{}',
    -- Document-level settings (footer page numbers + registration line).
    "settings" JSONB NOT NULL DEFAULT '{}',
    -- Optional references to a shared documentSection used as the page
    -- header/footer. Plain ids (no FK): a deleted section is skipped at render.
    "headerSectionId" TEXT,
    "footerSectionId" TEXT,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "documentTemplate_companyId_idx" ON "documentTemplate" ("companyId");
CREATE INDEX "documentTemplate_createdBy_idx" ON "documentTemplate" ("createdBy");

-- One template per document type per company
ALTER TABLE "documentTemplate" ADD CONSTRAINT "documentTemplate_companyId_documentType_key"
    UNIQUE ("companyId", "documentType");

-- Row Level Security
ALTER TABLE "public"."documentTemplate" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."documentTemplate"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."documentTemplate"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."documentTemplate"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."documentTemplate"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);

-- Shared, reusable document sections (rich text) referenced across documents:
-- body sections (inserted as blocks) and page header/footer chrome.
CREATE TABLE "documentSection" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- 'body' = referenceable content block; 'header'/'footer' = page chrome
    "placement" TEXT NOT NULL DEFAULT 'body',
    "content" JSONB NOT NULL DEFAULT '{}',
    -- Header layout config (logo, which company fields show); header sections only.
    "config" JSONB NOT NULL DEFAULT '{}',

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "documentSection_companyId_idx" ON "documentSection" ("companyId");
CREATE INDEX "documentSection_createdBy_idx" ON "documentSection" ("createdBy");

ALTER TABLE "public"."documentSection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."documentSection"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."documentSection"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."documentSection"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."documentSection"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_delete'))::text[]
  )
);
