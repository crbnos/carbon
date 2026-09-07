-- GoTrue session linkage for revocation + live status on the sign-in activity
-- card (spec: .ai/specs/2026-08-26-session-revocation.md). Nullable: rows
-- recorded before this feature have no session id and render with no status.
ALTER TABLE "userLogin" ADD COLUMN "sessionId" TEXT;
