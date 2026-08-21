-- Per-connection SSO enforcement: when TRUE, users whose email domain is
-- covered by this ACTIVE connection may only authenticate via SSO — magic
-- link, Google/Azure OAuth, and passkeys are refused server-side at the login
-- action, the callback, and the passkey verify routes (ERP + MES).
-- Break-glass for self-hosted operators (documented in
-- docs/content/docs/platform/single-sign-on.mdx):
--   UPDATE "ssoConnection" SET "requireSso" = false WHERE "companyId" = '<id>';
ALTER TABLE "ssoConnection" ADD COLUMN IF NOT EXISTS "requireSso" BOOLEAN NOT NULL DEFAULT FALSE;
