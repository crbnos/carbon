-- Company bucket prefixes and the feedback bucket.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/storage-private-prefixes.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_a text; company_a text;
  w text := gen_random_uuid()::text;  -- plain employee of A
  n int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Storage A ' || id(), 'system') RETURNING id INTO group_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Storage A', group_a, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO "user" (id, email) VALUES (w, w || '@storage.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES (w, company_a, 'employee');

  INSERT INTO storage.objects (bucket_id, name) VALUES
    (company_a, 'readme.txt'),
    (company_a, 'parts/drawing.pdf'),
    (company_a, 'exports/backup-1/manifest.json'),
    (company_a, company_a || '/audit-logs/2026/09/2026-09-29.jsonl.gz'),
    ('feedback', 'screenshot-' || id() || '.png');

  ASSERT NOT (SELECT public FROM storage.buckets WHERE id = 'feedback'),
    'the feedback bucket is private';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', w, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', '/test', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = company_a AND name IN ('readme.txt', 'parts/drawing.pdf');
  ASSERT n = 2, 'an employee still reads ordinary company files';

  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = company_a AND (name LIKE 'exports/%' OR name LIKE '%/audit-logs/%');
  ASSERT n = 0, 'an employee cannot see backups or audit-log archives';

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'feedback';
  ASSERT n = 0, 'an employee cannot see feedback objects';

  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES (company_a, 'exports/forged/manifest.json');
    RAISE EXCEPTION 'an employee wrote into exports/';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('feedback', 'upload-' || id() || '.png');
    RAISE EXCEPTION 'an employee uploaded to the feedback bucket';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO storage.objects (bucket_id, name) VALUES (company_a, 'parts/new.pdf');
  RESET ROLE;
  RAISE NOTICE 'PASS company backups, audit-log archives and feedback are service-role only';
END
$proof$;

ROLLBACK;
