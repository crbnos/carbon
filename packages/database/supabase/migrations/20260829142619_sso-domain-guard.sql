-- SAML SSO domain guard (defense in depth).
--
-- GoTrue scopes SSO by email domain instance-wide (auth.sso_domains). Carbon's
-- app flow only ever registers a domain in GoTrue AFTER a DNS-TXT ownership
-- challenge (packages/ee/src/sso/connections.server.ts -> verifySsoDomain). This
-- guard enforces the same rule in the database, so no auth.sso_domains row can
-- be created for a domain nobody has claimed (e.g. a direct Studio insert or a
-- stray migration) — registering a domain is what grants its verified owner
-- control over identity for every user on it, so it must not be possible without
-- a Carbon-side claim.
--
-- Requires a *claim row* (any status), NOT status = 'verified', on purpose:
-- verifySsoDomain syncs GoTrue (which writes auth.sso_domains) while the ssoDomain
-- row is still 'pending', by a deliberate lockout-avoidance ordering. A
-- verified-only guard would break that happy path. Reserved domains can never
-- obtain a claim row via the app validator (PUBLIC_EMAIL_DOMAINS), and the
-- reserved check below makes that hold against direct DB writes too.

-- Global reserved-domain list. NOT company-scoped: a reserved domain can never be
-- claimed by anyone. Kept in sync with PUBLIC_EMAIL_DOMAINS in
-- apps/erp/app/modules/settings/settings.models.ts, plus Carbon's own domains
-- (staff configure those directly, bypassing the tenant flow).
CREATE TABLE IF NOT EXISTS "ssoReservedDomain" (
  "domain" TEXT PRIMARY KEY
);

INSERT INTO "ssoReservedDomain" ("domain") VALUES
  -- Consumer mailbox providers (mirror PUBLIC_EMAIL_DOMAINS)
  ('gmail.com'), ('googlemail.com'), ('outlook.com'), ('hotmail.com'),
  ('live.com'), ('msn.com'), ('yahoo.com'), ('ymail.com'), ('icloud.com'),
  ('me.com'), ('mac.com'), ('aol.com'), ('proton.me'), ('protonmail.com'),
  ('pm.me'), ('gmx.com'), ('gmx.net'), ('mail.com'), ('zoho.com'),
  ('yandex.com'), ('qq.com'), ('163.com'), ('126.com'),
  -- Carbon's own domains
  ('carbon.ms'), ('carbon.us.org'), ('carbonms.onmicrosoft.com')
ON CONFLICT ("domain") DO NOTHING;

ALTER TABLE "public"."ssoReservedDomain" ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated employee; writes are service-role/staff only
-- (no INSERT/UPDATE/DELETE policy — RLS denies them by default).
DROP POLICY IF EXISTS "SELECT" ON "public"."ssoReservedDomain";
CREATE POLICY "SELECT" ON "public"."ssoReservedDomain"
FOR SELECT USING (auth.role() = 'authenticated');

-- The guard. Defined in PUBLIC (not auth) — the migration role can create
-- functions in public but not in the auth schema, and this mirrors
-- create_public_user (function in public, trigger on an auth table). SECURITY
-- DEFINER so it can read public tables regardless of the caller's role;
-- search_path pinned to public per house convention. A session-local override
-- lets Carbon staff scripts bypass for own-domain setup.
CREATE OR REPLACE FUNCTION public.enforce_sso_domain_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.sso_domain_override', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."ssoReservedDomain"
    WHERE lower("domain") = lower(NEW."domain")
  ) THEN
    RAISE EXCEPTION
      'auth.sso_domains insert blocked: % is a reserved domain', NEW."domain";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."ssoDomain"
    WHERE lower("domain") = lower(NEW."domain")
  ) THEN
    RAISE EXCEPTION
      'auth.sso_domains insert blocked: no ssoDomain claim exists for %',
      NEW."domain";
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_sso_domain_claim ON auth.sso_domains;
CREATE TRIGGER enforce_sso_domain_claim
  BEFORE INSERT ON auth.sso_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sso_domain_claim();
