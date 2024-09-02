CREATE TABLE "oauthClient" (
  "id" TEXT PRIMARY KEY DEFAULT xid(),
  "name" TEXT NOT NULL,
  "clientId" TEXT NOT NULL UNIQUE,
  "clientSecret" TEXT NOT NULL,
  "redirectUris" TEXT[] NOT NULL DEFAULT '{}',
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "oauthClient" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "oauthCode" (
  "id" TEXT PRIMARY KEY DEFAULT xid(),
  "code" TEXT NOT NULL UNIQUE,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,

  CONSTRAINT "oauthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  CONSTRAINT "oauthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "oauthCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "oauthCode" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "oauthToken" (
  "id" TEXT PRIMARY KEY DEFAULT xid(),
  "accessToken" TEXT NOT NULL UNIQUE,
  "refreshToken" TEXT NOT NULL UNIQUE,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,

  CONSTRAINT "oauthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  CONSTRAINT "oauthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT "oauthToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "oauthToken" ENABLE ROW LEVEL SECURITY;

-- Create indexes for better query performance
CREATE INDEX "oauthCode_code_idx" ON "oauthCode" ("code");
CREATE INDEX "oauthClient_clientId_idx" ON "oauthClient" ("clientId");
CREATE INDEX "oauthToken_accessToken_idx" ON "oauthToken" ("accessToken");
CREATE INDEX "oauthToken_refreshToken_idx" ON "oauthToken" ("refreshToken");