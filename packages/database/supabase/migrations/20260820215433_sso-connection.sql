-- Enterprise SAML SSO: app-side record binding a GoTrue SSO provider to a company.
-- GoTrue's auth.sso_providers/auth.sso_domains drive the SAML handshake; this table
-- is the tenant router and security anchor (providers are project-global in GoTrue,
-- so the callback verifies providerId -> companyId + email-domain membership here).
--
-- "requireSso": when TRUE, users whose email domain is covered by this ACTIVE
-- connection may only authenticate via SSO — magic link, Google/Azure OAuth, and
-- passkeys are refused server-side at the login action, the callback, and the
-- passkey verify routes (ERP + MES). Break-glass for self-hosted operators
-- (documented in docs/content/docs/platform/single-sign-on.mdx):
--   UPDATE "ssoConnection" SET "requireSso" = false WHERE "companyId" = '<id>';
CREATE TABLE IF NOT EXISTS "ssoConnection" (
    "id" TEXT NOT NULL DEFAULT id('sso'),
    "companyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "metadataUrl" TEXT,
    "metadataXml" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "requireSso" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "ssoConnection_providerId_key" UNIQUE ("providerId"),
    CONSTRAINT "ssoConnection_metadata_check" CHECK (num_nonnulls("metadataUrl", "metadataXml") = 1)
);

CREATE INDEX IF NOT EXISTS "ssoConnection_companyId_idx" ON "ssoConnection" ("companyId");
CREATE INDEX IF NOT EXISTS "ssoConnection_createdBy_idx" ON "ssoConnection" ("createdBy");
CREATE INDEX IF NOT EXISTS "ssoConnection_updatedBy_idx" ON "ssoConnection" ("updatedBy");

-- One ACTIVE connection per company. Readers use .maybeSingle() (errors on two
-- rows) and two concurrent upserts could otherwise both pass the app-side check;
-- this makes the second insert fail loudly instead. Also lives in
-- 20260826*_sso-connection-active-unique.sql (IF NOT EXISTS) for databases that
-- applied the pre-squash version of this migration.
CREATE UNIQUE INDEX IF NOT EXISTS "ssoConnection_companyId_active_key" ON "ssoConnection" ("companyId") WHERE "active" = TRUE;

ALTER TABLE "ssoConnection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."ssoConnection"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."ssoConnection"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."ssoConnection"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."ssoConnection"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

-- One row per claimed email domain, with a DNS TXT ownership challenge. A
-- domain routes SSO logins (and enforces "requireSso") ONLY while
-- status = 'verified' — the GoTrue provider is registered with the verified
-- set, and every app-side lookup filters on it, so a pending claim is inert.
-- Verification is one-shot and manual: the admin publishes
--   _carbon-challenge.<domain>  TXT  "carbon-domain-verification=<token>"
-- and clicks Verify; there is no periodic re-check, and the record may be
-- removed once verified. Exclusivity attaches to VERIFICATION, not the claim:
-- pending claims may coexist across companies (a free pending row must never
-- block the rightful owner), and the partial unique index below enforces
-- first-to-verify-wins race-free.
DO $$ BEGIN
  CREATE TYPE "ssoDomainStatus" AS ENUM ('pending', 'verified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ssoDomain" (
    "id" TEXT NOT NULL DEFAULT id('ssod'),
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "status" "ssoDomainStatus" NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "ssoDomain_connectionId_fkey" FOREIGN KEY ("connectionId", "companyId") REFERENCES "ssoConnection"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ssoDomain_companyId_domain_key" UNIQUE ("companyId", "domain")
);

-- First-to-verify-wins: at most one VERIFIED row per domain across companies.
CREATE UNIQUE INDEX IF NOT EXISTS "ssoDomain_domain_verified_key" ON "ssoDomain" ("domain") WHERE "status" = 'verified';

CREATE INDEX IF NOT EXISTS "ssoDomain_companyId_idx" ON "ssoDomain" ("companyId");
CREATE INDEX IF NOT EXISTS "ssoDomain_connectionId_idx" ON "ssoDomain" ("connectionId", "companyId");
CREATE INDEX IF NOT EXISTS "ssoDomain_createdBy_idx" ON "ssoDomain" ("createdBy");
CREATE INDEX IF NOT EXISTS "ssoDomain_updatedBy_idx" ON "ssoDomain" ("updatedBy");

ALTER TABLE "ssoDomain" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."ssoDomain"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."ssoDomain"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."ssoDomain"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."ssoDomain"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

-- Crash-free public-user creation: an SSO signup whose email already belongs to a
-- DIFFERENT public."user" row must not violate index_user_email_key inside GoTrue's
-- transaction (the SAML login would fail opaquely before app code runs). The branch
-- inserts NOTHING — not even the "userPermission" row, whose id has an FK to the
-- "user" row this branch declines to create. The SSO callback's migration
-- transaction owns creating both rows after domain + invite verification
-- (users.sso.server.ts migrateUserToSso). The existing row is never mutated from
-- this trigger (a rogue IdP must not be able to touch another account's row).
CREATE OR REPLACE FUNCTION public.create_public_user()
RETURNS TRIGGER AS $$
DECLARE
  full_name TEXT;
  name_parts TEXT[];
  email_owner TEXT;
BEGIN
  SELECT "id" INTO email_owner FROM public."user" WHERE "email" = NEW.email;
  IF email_owner IS NOT NULL AND email_owner <> NEW.id::text THEN
    RETURN NEW;
  END IF;

  full_name := NEW.raw_user_meta_data->>'name';
  IF full_name IS NOT NULL THEN
    name_parts := regexp_split_to_array(full_name, '\s+');
    INSERT INTO public."user" ("id","email","active","firstName","lastName","about")
    VALUES (NEW.id, NEW.email, true,
            COALESCE(name_parts[1], ''),
            COALESCE(array_to_string(name_parts[2:], ' '), ''), '')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  ELSE
    INSERT INTO public."user" ("id","email","active","firstName","lastName","about")
    VALUES (NEW.id, NEW.email, true, '', '', '')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  END IF;

  INSERT INTO public."userPermission" ("id") VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
