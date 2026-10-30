-- SCIM 2.0 provisioning: a customer's identity provider creates, updates,
-- deactivates and regroups the company's employees at /scim/v2.
-- Spec: .ai/specs/2026-10-30-scim-provisioning.md
--
-- One connection per company holds the hashed bearer token (the apiKey.keyHash
-- pattern) and the defaults a new person gets. scimUser and scimGroup are the
-- IdP's view of the people and groups it manages; the Carbon rows they point
-- at (user, employee, userToCompany) are never created or deleted by a cascade
-- from here. RLS rules live in packages/database/src/authz/manifest.ts.

DO $$ BEGIN
  CREATE TYPE "scimIdentityProvider" AS ENUM (
    'Okta',
    'Microsoft Entra ID',
    'Google Workspace',
    'JumpCloud',
    'OneLogin',
    'Other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "scimConnection" (
  "id" TEXT NOT NULL DEFAULT id('scim'),
  "companyId" TEXT NOT NULL,
  "identityProvider" "scimIdentityProvider" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPreview" TEXT NOT NULL,
  -- employeeType and location have single-column keys; the engine checks both
  -- belong to the company before every write.
  "defaultEmployeeTypeId" TEXT NOT NULL REFERENCES "employeeType"("id"),
  "defaultLocationId" TEXT NOT NULL REFERENCES "location"("id"),
  "lastRequestAt" TIMESTAMP WITH TIME ZONE,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

DO $$ BEGIN
  ALTER TABLE "scimConnection"
    ADD CONSTRAINT "scimConnection_companyId_key" UNIQUE ("companyId");
EXCEPTION
  WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "scimConnection"
    ADD CONSTRAINT "scimConnection_tokenHash_key" UNIQUE ("tokenHash");
EXCEPTION
  WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "scimConnection_defaultEmployeeTypeId_idx"
  ON "scimConnection" ("defaultEmployeeTypeId");
CREATE INDEX IF NOT EXISTS "scimConnection_defaultLocationId_idx"
  ON "scimConnection" ("defaultLocationId");
CREATE INDEX IF NOT EXISTS "scimConnection_createdBy_idx"
  ON "scimConnection" ("createdBy");
CREATE INDEX IF NOT EXISTS "scimConnection_updatedBy_idx"
  ON "scimConnection" ("updatedBy");

ALTER TABLE "scimConnection" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "scimUser" (
  -- The SCIM resource id the IdP stores. Company-scoped by construction, so a
  -- token for one company can never address another company's person.
  "id" TEXT NOT NULL DEFAULT id('scimu'),
  "companyId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- The IdP's view. Carbon never writes these back to the global user's
  -- sign-in email.
  "userName" TEXT NOT NULL,
  "externalId" TEXT,
  "email" TEXT NOT NULL,
  "givenName" TEXT,
  "familyName" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("connectionId", "companyId")
    REFERENCES "scimConnection"("id", "companyId") ON DELETE CASCADE
);

-- RFC 7643 §4.1.1: userName is unique and compared without case.
CREATE UNIQUE INDEX IF NOT EXISTS "scimUser_companyId_userName_key"
  ON "scimUser" ("companyId", lower("userName"));

DO $$ BEGIN
  ALTER TABLE "scimUser"
    ADD CONSTRAINT "scimUser_companyId_userId_key" UNIQUE ("companyId", "userId");
EXCEPTION
  WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "scimUser_companyId_idx" ON "scimUser" ("companyId");
CREATE INDEX IF NOT EXISTS "scimUser_connectionId_idx" ON "scimUser" ("connectionId", "companyId");
CREATE INDEX IF NOT EXISTS "scimUser_userId_idx" ON "scimUser" ("userId");
CREATE INDEX IF NOT EXISTS "scimUser_companyId_externalId_idx" ON "scimUser" ("companyId", "externalId");
CREATE INDEX IF NOT EXISTS "scimUser_createdBy_idx" ON "scimUser" ("createdBy");
CREATE INDEX IF NOT EXISTS "scimUser_updatedBy_idx" ON "scimUser" ("updatedBy");

ALTER TABLE "scimUser" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "scimGroup" (
  "id" TEXT NOT NULL DEFAULT id('scimg'),
  "companyId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "externalId" TEXT,
  -- The mapping the admin sets on Settings → Security. Null = not mapped.
  "employeeTypeId" TEXT REFERENCES "employeeType"("id") ON DELETE SET NULL,
  -- A person in several mapped groups gets the type of the lowest priority.
  "priority" INTEGER NOT NULL DEFAULT 100,

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("connectionId", "companyId")
    REFERENCES "scimConnection"("id", "companyId") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "scimGroup_companyId_displayName_key"
  ON "scimGroup" ("companyId", lower("displayName"));
CREATE INDEX IF NOT EXISTS "scimGroup_companyId_idx" ON "scimGroup" ("companyId");
CREATE INDEX IF NOT EXISTS "scimGroup_connectionId_idx" ON "scimGroup" ("connectionId", "companyId");
CREATE INDEX IF NOT EXISTS "scimGroup_employeeTypeId_idx" ON "scimGroup" ("employeeTypeId");
CREATE INDEX IF NOT EXISTS "scimGroup_createdBy_idx" ON "scimGroup" ("createdBy");
CREATE INDEX IF NOT EXISTS "scimGroup_updatedBy_idx" ON "scimGroup" ("updatedBy");

ALTER TABLE "scimGroup" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "scimGroupMember" (
  "groupId" TEXT NOT NULL,
  "scimUserId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  PRIMARY KEY ("groupId", "scimUserId", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("groupId", "companyId")
    REFERENCES "scimGroup"("id", "companyId") ON DELETE CASCADE,
  FOREIGN KEY ("scimUserId", "companyId")
    REFERENCES "scimUser"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "scimGroupMember_companyId_idx" ON "scimGroupMember" ("companyId");
CREATE INDEX IF NOT EXISTS "scimGroupMember_scimUserId_idx" ON "scimGroupMember" ("scimUserId", "companyId");

ALTER TABLE "scimGroupMember" ENABLE ROW LEVEL SECURITY;
