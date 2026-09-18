-- Per-user sign-in records, backing the "Your devices" card and the
-- device-age revoke gate (specs: .ai/specs/2026-08-26-user-devices-login-history.md,
-- .ai/specs/2026-08-26-session-revocation.md,
-- .ai/specs/2026-09-10-device-gated-session-revocation.md).
--
-- USER-OWNED, deliberately no "companyId": a login happens before a company is
-- chosen, so there is no company to scope by. Precedent: "passkeyCredential"
-- (no companyId, FK to "user") and "notificationPreference" (PK on "id" alone).
--
-- Rows are written pre-session by the service role at first-factor success.
-- There are intentionally NO INSERT/UPDATE/DELETE policies: a user must not be
-- able to forge or erase their own sign-in records. No audit columns for the
-- same reason — the row IS the record; the only mutation is the service role
-- clearing "mfaPending" once the second factor succeeds.
--
-- "sessionId" is the GoTrue session_id claim from the access token that minted
-- this login — the join key to auth.sessions, which is what makes the "Your
-- devices" card and per-device revocation possible. Nullable: a login recorded
-- by a path that cannot resolve the claim still belongs in the record.
--
-- "deviceId" is the opaque id from the signed "carbon-device" cookie. Nullable:
-- logins from a client that refuses cookies have none and are treated as
-- unrecognised (which refuses cross-session revoke).
--
-- "mfaPending": a login is recorded at FIRST-factor success, before the TOTP
-- gate, so that a blocked attempt still lands in the record. Such a row must
-- not age the device: otherwise failing MFA once is enough to make an
-- attacker's browser "older" than the owner's sessions, which is exactly what
-- the gate exists to prevent. Rows start pending and are cleared by
-- completeMfaChallenge; logins with no TOTP factor are never pending.
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

-- The gate asks "when was this (userId, deviceId) pair first seen?" on every
-- revoke, and "have we seen it at all?" on every login. "createdAt" is part of
-- the key so the first-seen lookup is a single index seek rather than a sort
-- over the pair's whole history.
CREATE INDEX "userLogin_userId_deviceId_idx"
  ON "userLogin" ("userId", "deviceId", "createdAt");

ALTER TABLE "userLogin" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."userLogin"
  FOR SELECT USING (auth.uid()::text = "userId");

-- Retention prune, as one statement so it cannot race with a concurrent login.
-- Deletes the user's rows past the cutoff EXCEPT each device's earliest row:
-- that one is what the revoke gate reads as "first seen", and dropping it would
-- reset a long-trusted device's age. Runs as the definer because the table has
-- no DELETE policy by design (a user must not be able to erase their own
-- sign-in records) — the userId argument is supplied by the service role at
-- login.
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
