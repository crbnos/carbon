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
--
-- The claim must also belong to the connection behind NEW."sso_provider_id", not
-- just match the domain (CWE-863): a domain check alone would let a writer route
-- a domain one company DNS-proved to a DIFFERENT company's IdP. The trigger joins
-- the ssoDomain claim to its ssoConnection and checks the provider id matches.

-- Global reserved-domain list. NOT company-scoped: a reserved domain can never be
-- claimed by anyone. Kept in sync with PUBLIC_EMAIL_DOMAINS in
-- apps/erp/app/modules/settings/settings.models.ts.
CREATE TABLE IF NOT EXISTS "ssoReservedDomain" (
  "domain" TEXT PRIMARY KEY
);

INSERT INTO "ssoReservedDomain" ("domain") VALUES
  -- Consumer mailbox providers (mirror PUBLIC_EMAIL_DOMAINS). These are shared
  -- across unrelated people, so DNS verification cannot prove single ownership —
  -- they must never be claimable. Carbon's OWN domains are deliberately NOT here:
  -- a domain a company controls can be proven via the DNS-TXT challenge and set up
  -- for SSO like any other, so a blanket reservation was only friction.
  ('gmail.com'), ('googlemail.com'), ('outlook.com'), ('hotmail.com'),
  ('live.com'), ('msn.com'), ('yahoo.com'), ('ymail.com'), ('icloud.com'),
  ('me.com'), ('mac.com'), ('aol.com'), ('proton.me'), ('protonmail.com'),
  ('pm.me'), ('gmx.com'), ('gmx.net'), ('mail.com'), ('zoho.com'),
  ('yandex.com'), ('qq.com'), ('163.com'), ('126.com')
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

  -- Bind the claim to the PROVIDER, not just the domain: the ssoDomain claim
  -- must belong to the ssoConnection that owns NEW."sso_provider_id". A bare
  -- domain check would let a writer register a claimed domain under an unrelated
  -- company's provider (CWE-863) — the claim proving DNS ownership sits with one
  -- company/connection, but the routing row would point at another's IdP. The
  -- claim may still be 'pending' here: verifySsoDomain syncs GoTrue (writing
  -- auth.sso_domains) before it flips the ssoDomain row to 'verified', by a
  -- deliberate lockout-avoidance ordering, so we require a matching claim of ANY
  -- status — only that it belongs to this provider's connection.
  IF NOT EXISTS (
    SELECT 1
    FROM public."ssoDomain" d
    JOIN public."ssoConnection" c
      ON c."id" = d."connectionId" AND c."companyId" = d."companyId"
    WHERE lower(d."domain") = lower(NEW."domain")
      AND c."providerId" = NEW."sso_provider_id"::text
  ) THEN
    RAISE EXCEPTION
      'auth.sso_domains insert blocked: no ssoDomain claim for % under provider %',
      NEW."domain", NEW."sso_provider_id";
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_sso_domain_claim ON auth.sso_domains;
CREATE TRIGGER enforce_sso_domain_claim
  BEFORE INSERT ON auth.sso_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sso_domain_claim();
