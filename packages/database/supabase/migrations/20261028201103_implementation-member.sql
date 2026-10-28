-- Implementation Hub per person: each person in the hub has their own page,
-- defined card by card by Carbon staff as a JSON document. A person with no
-- row sees an empty hub.
--
-- Rules and event triggers for the new table live in the authz manifest and
-- the event attachments, not here (see authz-manifest.md).

CREATE TABLE "implementationMember" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    -- The page definition, validated by `memberPageValidator`
    -- (@carbon/onboarding) before every write.
    "page" JSONB NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "implementationMember_companyId_userId_key"
      UNIQUE ("companyId", "userId")
);

CREATE INDEX "implementationMember_companyId_idx"
  ON "implementationMember" ("companyId");
CREATE INDEX "implementationMember_userId_idx"
  ON "implementationMember" ("userId");
CREATE INDEX "implementationMember_createdBy_idx"
  ON "implementationMember" ("createdBy");
CREATE INDEX "implementationMember_updatedBy_idx"
  ON "implementationMember" ("updatedBy");

ALTER TABLE "implementationMember" ENABLE ROW LEVEL SECURITY;
