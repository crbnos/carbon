-- Device recognition for the revoke gate (spec:
-- .ai/specs/2026-09-10-device-gated-session-revocation.md). Opaque id from the
-- signed "carbon-device" cookie. Nullable: rows recorded before this feature,
-- and logins from a client that refuses cookies, have none and are treated as
-- unrecognised (which refuses cross-session revoke).
ALTER TABLE "userLogin" ADD COLUMN "deviceId" TEXT;

-- A login is recorded at FIRST-factor success, before the TOTP gate, so that a
-- blocked attempt still lands in the audit trail. Such a row must not age the
-- device: otherwise failing MFA once is enough to make an attacker's browser
-- "older" than the owner's sessions, which is exactly what the gate exists to
-- prevent. Rows start pending and are cleared by completeMfaChallenge; logins
-- with no TOTP factor are never pending.
ALTER TABLE "userLogin" ADD COLUMN "mfaPending" BOOLEAN NOT NULL DEFAULT FALSE;

-- The gate asks "when was this (userId, deviceId) pair first seen?" on every
-- revoke, and "have we seen it at all?" on every login. "createdAt" is part of
-- the key so the first-seen lookup is a single index seek rather than a sort
-- over the pair's whole history.
CREATE INDEX "userLogin_userId_deviceId_idx"
  ON "userLogin" ("userId", "deviceId", "createdAt");

-- Retention prune, as one statement so it cannot race with a concurrent login.
-- Deletes the user's rows past the cutoff EXCEPT each device's earliest row:
-- that one is what the revoke gate reads as "first seen", and dropping it would
-- reset a long-trusted device's age. Runs as the definer because the table has
-- no DELETE policy by design (a user must not be able to erase their own audit
-- trail) — the userId argument is supplied by the service role at login.
CREATE OR REPLACE FUNCTION prune_user_login_history(p_user_id TEXT, p_cutoff TIMESTAMP WITH TIME ZONE)
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

REVOKE ALL ON FUNCTION prune_user_login_history(TEXT, TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_user_login_history(TEXT, TIMESTAMP WITH TIME ZONE) TO service_role;
