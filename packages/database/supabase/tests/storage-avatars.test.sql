-- Who may write another user's avatar photo (20261124115013_person-avatar-uploads.sql).
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/storage-avatars.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';
-- The Storage API sets this for its deletes; without it storage.protect_delete refuses every one.
SET LOCAL "storage.allow_delete_query" = 'true';

DO $proof$
DECLARE
  group_a text; company_a text; company_b text;
  admin text := gen_random_uuid()::text;     -- users_update in A
  person text := gen_random_uuid()::text;    -- employee of A
  plain text := gen_random_uuid()::text;     -- employee of A, no users_update
  outsider text := gen_random_uuid()::text;  -- users_update in B only
  stranger text := gen_random_uuid()::text;  -- employee of B only
  portal text := gen_random_uuid()::text;    -- customer account in A
  n int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Avatars ' || id(), 'system') RETURNING id INTO group_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Avatars A', group_a, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Avatars B', group_a, 'USD', 'America/New_York') RETURNING id INTO company_b;
  INSERT INTO "user" (id, email)
    SELECT u, u || '@avatars.invalid' FROM unnest(ARRAY[admin, person, plain, outsider, stranger, portal]) u;
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (admin, company_a, 'employee'), (person, company_a, 'employee'), (plain, company_a, 'employee'),
    (outsider, company_b, 'employee'), (stranger, company_b, 'employee'),
    (portal, company_a, 'customer');
  INSERT INTO "userPermission" (id, permissions) VALUES
    (admin, jsonb_build_object('users_update', jsonb_build_array(company_a))),
    (plain, '{}'::jsonb),
    (outsider, jsonb_build_object('users_update', jsonb_build_array(company_b)));
  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('avatars', person || '.png'),
    ('avatars', stranger || '.webp');

  PERFORM set_config('request.path', '/test', true);
  SET LOCAL ROLE authenticated;

  -- users_update in the person's company: upload, replace, remove.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', admin, 'role', 'authenticated')::text, true);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', person || '.webp');
  UPDATE storage.objects SET metadata = '{"size": 1}'::jsonb WHERE bucket_id = 'avatars' AND name = person || '.webp';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'a users_update holder replaces the photo of a user in their company';
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = person || '.png';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'a users_update holder removes the replaced photo of a user in their company';

  BEGIN
    UPDATE storage.objects SET name = stranger || '.webp.bak' WHERE bucket_id = 'avatars' AND name = person || '.webp';
    RAISE EXCEPTION 'a users_update holder renamed a photo onto a user outside their company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Only the name shape of an avatar upload: "<userId>.<ext>" at the bucket root.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'folder/' || person || '.webp');
    RAISE EXCEPTION 'a users_update holder wrote a photo inside a folder';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', person || '.webp/x.png');
    RAISE EXCEPTION 'a users_update holder wrote under a folder named after the user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', person);
    RAISE EXCEPTION 'a users_update holder wrote a photo with no extension';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A user who shares no company with the caller.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', stranger || '.jpg');
    RAISE EXCEPTION 'a users_update holder uploaded a photo for a user in another company';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = stranger || '.webp';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'a users_update holder cannot remove the photo of a user in another company';

  -- A customer account of the caller's company is not an employee.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', portal || '.webp');
    RAISE EXCEPTION 'a users_update holder uploaded a photo for a customer account';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Another bucket is not opened by these policies.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('feedback', person || '.webp');
    RAISE EXCEPTION 'a users_update holder wrote a user-named file into another bucket';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- An API key's request runs as anon: the policies apply to authenticated only.
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', person || '.jpg');
    RAISE EXCEPTION 'an anon request with users_update claims uploaded a photo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;

  -- users_update in another company only.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', person || '.jpg');
    RAISE EXCEPTION 'users_update in another company uploaded a photo for this company''s user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- An employee without users_update.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', plain, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', person || '.jpg');
    RAISE EXCEPTION 'an employee without users_update uploaded a photo for a coworker';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = person || '.webp';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'an employee without users_update cannot remove a coworker''s photo';

  -- Everyone still manages their own photo.
  INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', plain || '.webp');
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = plain || '.webp';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'an employee still removes their own photo';

  RESET ROLE;
  RAISE NOTICE 'PASS users_update holders manage the avatar photos of users in their companies only';
END
$proof$;

ROLLBACK;
