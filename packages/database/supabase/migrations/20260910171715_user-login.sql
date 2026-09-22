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
  "deviceId" TEXT,
  "mfaPending" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "userLogin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "userLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "userLogin_userId_createdAt_idx" ON "userLogin" ("userId", "createdAt" DESC);

CREATE INDEX "userLogin_userId_deviceId_idx"
  ON "userLogin" ("userId", "deviceId", "createdAt");

ALTER TABLE "userLogin" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."userLogin"
  FOR SELECT USING (auth.uid()::text = "userId");

CREATE OR REPLACE FUNCTION prune_user_logins(p_user_id TEXT, p_cutoff TIMESTAMP WITH TIME ZONE)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "userLogin"
  WHERE "userId" = p_user_id
    AND "createdAt" < p_cutoff
    AND "id" NOT IN (
      SELECT DISTINCT ON ("deviceId") "id"
      FROM "userLogin"
      WHERE "userId" = p_user_id AND "deviceId" IS NOT NULL
      ORDER BY "deviceId", "createdAt" ASC
    );
$$;

REVOKE ALL ON FUNCTION prune_user_logins(TEXT, TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_user_logins(TEXT, TIMESTAMP WITH TIME ZONE) TO service_role;
