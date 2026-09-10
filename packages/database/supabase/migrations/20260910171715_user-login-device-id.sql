-- Device recognition for the revoke gate (spec:
-- .ai/specs/2026-09-10-device-gated-session-revocation.md). Opaque id from the
-- signed "carbon-device" cookie. Nullable: rows recorded before this feature,
-- and logins from a client that refuses cookies, have none and are treated as
-- unrecognised (which refuses cross-session revoke).
ALTER TABLE "userLogin" ADD COLUMN "deviceId" TEXT;

-- The gate asks "when was this (userId, deviceId) pair first seen?" on every
-- revoke, and "have we seen it at all?" on every login.
CREATE INDEX "userLogin_userId_deviceId_idx"
  ON "userLogin" ("userId", "deviceId");
