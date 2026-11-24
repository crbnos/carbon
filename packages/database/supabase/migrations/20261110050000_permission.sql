-- Page-level permissions (.ai/specs/2026-10-18-page-level-permissions.md).
--
-- One table holds every grant: a role's (employeeTypeId), a person's override
-- (userId) and an API key's (apiKeyId), exactly one per row. A row with no
-- page covers the whole module; a row with a page overrides it for that page.
-- The RLS rules live in packages/database/src/authz/manifest.ts.

DO $permissionlevel$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permissionLevel') THEN
    CREATE TYPE "permissionLevel" AS ENUM ('None', 'View', 'Create', 'Edit', 'Full');
  END IF;
END
$permissionlevel$;

CREATE TABLE IF NOT EXISTS "permission" (
    "id" TEXT NOT NULL DEFAULT id('prm'),
    "companyId" TEXT NOT NULL,
    "employeeTypeId" TEXT REFERENCES "employeeType"("id") ON DELETE CASCADE,
    "userId" TEXT REFERENCES "user"("id") ON DELETE CASCADE,
    "apiKeyId" TEXT REFERENCES "apiKey"("id") ON DELETE CASCADE,
    "module" "module" NOT NULL,
    -- 'inventory.receipts'; NULL: the whole module
    "page" TEXT,
    "level" "permissionLevel" NOT NULL,
    -- The old checkboxes this row was rounded up from; set only by the conversion.
    "convertedFrom" TEXT[],
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "permission_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "permission_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "permission_one_subject" CHECK (
      num_nonnulls("employeeTypeId", "userId", "apiKeyId") = 1
    ),
    CONSTRAINT "permission_page_in_module" CHECK (
      "page" IS NULL OR split_part("page", '.', 1) = lower("module"::text)
    ),
    CONSTRAINT "permission_unique" UNIQUE NULLS NOT DISTINCT
      ("companyId", "employeeTypeId", "userId", "apiKeyId", "module", "page")
);

CREATE INDEX IF NOT EXISTS "permission_companyId_idx" ON "permission" ("companyId");
CREATE INDEX IF NOT EXISTS "permission_employeeTypeId_idx" ON "permission" ("employeeTypeId");
CREATE INDEX IF NOT EXISTS "permission_userId_idx" ON "permission" ("userId", "companyId");
CREATE INDEX IF NOT EXISTS "permission_apiKeyId_idx" ON "permission" ("apiKeyId");
CREATE INDEX IF NOT EXISTS "permission_createdBy_idx" ON "permission" ("createdBy");
