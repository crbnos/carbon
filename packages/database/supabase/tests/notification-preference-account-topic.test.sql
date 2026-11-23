-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/notification-preference-account-topic.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $proof$
DECLARE
  group_a text; company_a text; company_b text;
  user_id text := gen_random_uuid()::text;
  other_id text := gen_random_uuid()::text;
  n int;
BEGIN
  INSERT INTO "companyGroup" (name,"createdBy") VALUES ('Preference A '||id(),'system') RETURNING id INTO group_a;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Preference A',group_a,'USD','America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name,"companyGroupId","baseCurrencyCode",timezone)
    VALUES ('Preference B',group_a,'USD','America/New_York') RETURNING id INTO company_b;
  INSERT INTO "user" (id,email) VALUES
    (user_id, user_id||'@preference.invalid'),
    (other_id, other_id||'@preference.invalid');
  -- The user belongs to A only.
  INSERT INTO "userToCompany" ("userId","companyId",role) VALUES (user_id,company_a,'employee');

  -- A per-company newsletter row (an older backup's) is still accepted.
  INSERT INTO "notificationPreference" ("userId","companyId",channel,topic,enabled)
    VALUES (user_id,company_a,'email','changelog',true);

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;

  -- The upsert the account page sends, twice: one row, holding the last value.
  INSERT INTO "notificationPreference" ("userId","companyId",channel,topic,enabled)
    VALUES (user_id,NULL,'email','changelog',true)
    ON CONFLICT ("userId","companyId",channel,topic) DO UPDATE SET enabled = EXCLUDED.enabled;
  INSERT INTO "notificationPreference" ("userId","companyId",channel,topic,enabled)
    VALUES (user_id,NULL,'email','changelog',false)
    ON CONFLICT ("userId","companyId",channel,topic) DO UPDATE SET enabled = EXCLUDED.enabled;
  SELECT count(*) INTO n FROM "notificationPreference"
    WHERE "userId" = user_id AND "companyId" IS NULL AND topic = 'changelog' AND NOT enabled;
  ASSERT n = 1, 'The account-level newsletter row is one row per user';
  RAISE NOTICE 'PASS the newsletter upsert keeps one row per user';

  BEGIN
    INSERT INTO "notificationPreference" ("userId","companyId",channel,topic,enabled)
      VALUES (user_id,company_b,'email','job',false);
    RAISE EXCEPTION 'A preference was written for a company the user does not belong to';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO "notificationPreference" ("userId","companyId",channel,topic,enabled)
      VALUES (other_id,NULL,'email','changelog',true);
    RAISE EXCEPTION 'A user wrote another user''s newsletter preference';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS a user writes only their own rows, in their own companies';

  RESET ROLE;
  INSERT INTO "notificationPreference" ("userId","companyId",channel,topic,enabled)
    VALUES (other_id,NULL,'email','changelog',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM "notificationPreference" WHERE "userId" = other_id;
  ASSERT n = 0, 'Another user''s newsletter row is not readable';
  RAISE NOTICE 'PASS another user''s newsletter row is not readable';
  RESET ROLE;
END
$proof$;

ROLLBACK;
