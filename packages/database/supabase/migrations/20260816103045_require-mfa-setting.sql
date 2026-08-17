-- Company-level policy: every employee must have an authenticator app enrolled
-- before they can use the app.
--
-- The factor itself is global to the auth user (Supabase owns `auth.mfa_factors`),
-- but the REQUIREMENT is per-company, so a user who belongs to several companies
-- is held to the strictest one — there is no coherent half-enrolled account.
--
-- Controlled (ITAR/CMMC) deployments force this on regardless of the column:
-- NIST 800-171 3.5.3 requires MFA for network access to non-privileged accounts,
-- so `CONTROLLED_ENVIRONMENT=true` must not be overridable by a company toggle.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireMfa" BOOLEAN NOT NULL DEFAULT false;

