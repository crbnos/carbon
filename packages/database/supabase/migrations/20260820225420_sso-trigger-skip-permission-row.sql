-- Fix: the duplicate-email skip branch of create_public_user() still inserted a
-- "userPermission" row, whose id has an FK to the "user" row the branch just
-- declined to create — FK violation, which aborts GoTrue's signup transaction
-- and kills the SAML login at the ACS with "Database error saving new user".
-- The branch must insert NOTHING: the SSO callback's migration transaction
-- upserts both the "user" row and the "userPermission" row after domain +
-- invite verification (users.sso.server.ts migrateUserToSso).
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
