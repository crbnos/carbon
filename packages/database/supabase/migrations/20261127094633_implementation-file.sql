-- Implementation Hub 2.0: files on a person's page. A person attaches files to
-- the cards of their page that ask for one, and Carbon staff to any card. The
-- file itself is in the company's bucket, under
-- <companyId>/implementation/<userId>/; this row records which card of whose
-- page it belongs to.
--
-- Rules and event triggers for the new table live in the authz manifest and
-- the event attachments, not here (see authz-manifest.md).

CREATE TABLE IF NOT EXISTS "implementationFile" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    -- The person whose page the file is on.
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    -- The card, by its id on the page: a hub item's key, or custom:<key>.
    "cardId" TEXT NOT NULL,
    -- The file's key in the company's bucket.
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- In bytes.
    "size" INTEGER NOT NULL CHECK ("size" >= 0),

    "createdBy" TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id") ON DELETE RESTRICT,
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "implementationFile_companyId_path_key"
      UNIQUE ("companyId", "path")
);

CREATE INDEX IF NOT EXISTS "implementationFile_companyId_userId_idx"
  ON "implementationFile" ("companyId", "userId");
CREATE INDEX IF NOT EXISTS "implementationFile_userId_idx"
  ON "implementationFile" ("userId");
CREATE INDEX IF NOT EXISTS "implementationFile_createdBy_idx"
  ON "implementationFile" ("createdBy");
CREATE INDEX IF NOT EXISTS "implementationFile_updatedBy_idx"
  ON "implementationFile" ("updatedBy");

ALTER TABLE "implementationFile" ENABLE ROW LEVEL SECURITY;
