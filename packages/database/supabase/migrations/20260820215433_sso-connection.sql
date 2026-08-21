-- Enterprise SAML SSO: app-side record binding a GoTrue SSO provider to a company.
-- GoTrue's auth.sso_providers/auth.sso_domains drive the SAML handshake; this table
-- is the tenant router and security anchor (providers are project-global in GoTrue,
-- so the callback verifies providerId -> companyId + email-domain membership here).
CREATE TABLE IF NOT EXISTS "ssoConnection" (
    "id" TEXT NOT NULL DEFAULT id('sso'),
    "companyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "domains" TEXT[] NOT NULL,
    "metadataUrl" TEXT,
    "metadataXml" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
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
CREATE INDEX IF NOT EXISTS "ssoConnection_domains_idx" ON "ssoConnection" USING GIN ("domains");

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

-- Crash-free public-user creation: an SSO signup whose email already belongs to a
-- DIFFERENT public."user" row must not violate index_user_email_key inside GoTrue's
-- transaction (the SAML login would fail opaquely before app code runs). The row is
-- skipped here; the SSO callback's migration transaction owns creating it after
-- domain + invite verification. The existing row is never mutated from this trigger
-- (a rogue IdP must not be able to touch another account's row).
CREATE OR REPLACE FUNCTION public.create_public_user()
RETURNS TRIGGER AS $$
DECLARE
  full_name TEXT;
  name_parts TEXT[];
  email_owner TEXT;
BEGIN
  SELECT "id" INTO email_owner FROM public."user" WHERE "email" = NEW.email;
  IF email_owner IS NOT NULL AND email_owner <> NEW.id::text THEN
    INSERT INTO public."userPermission" ("id") VALUES (NEW.id) ON CONFLICT DO NOTHING;
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
