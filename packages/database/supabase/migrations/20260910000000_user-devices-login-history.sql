-- Per-user sign-in history (spec: .ai/specs/2026-08-26-user-devices-login-history.md).
--
-- USER-OWNED, deliberately no "companyId": a login happens before a company is
-- chosen, so there is no company to scope by. Precedent: "passkeyCredential"
-- (no companyId, FK to "user") and "notificationPreference" (PK on "id" alone).
--
-- Rows are written pre-session by the service role at first-factor success.
-- There are intentionally NO INSERT/UPDATE/DELETE policies: a user must not be
-- able to forge or erase their own sign-in audit trail. No audit columns for
-- the same reason — the row IS the audit record and has no mutator.
--
-- "sessionId" is the GoTrue session_id claim from the access token that minted
-- this login — the join key to auth.sessions, which is what makes the "Your
-- devices" card and per-device revocation possible (spec:
-- .ai/specs/2026-08-26-session-revocation.md). Nullable: a login recorded by a
-- path that cannot resolve the claim still belongs in the history.
CREATE TABLE "userLogin" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "method" TEXT NOT NULL CHECK (
    "method" IN ('magic_link', 'oauth_google', 'oauth_azure', 'passkey',
                 'verification_code', 'bypass', 'sso', 'unknown')
  ),
  "app" TEXT NOT NULL CHECK ("app" IN ('erp', 'mes')),
  "ipAddress" TEXT,
  "city" TEXT,
  "country" TEXT,
  "userAgent" TEXT,
  "sessionId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "userLogin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "userLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "userLogin_userId_createdAt_idx" ON "userLogin" ("userId", "createdAt" DESC);

ALTER TABLE "userLogin" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."userLogin"
  FOR SELECT USING (auth.uid()::text = "userId");
