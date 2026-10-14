-- check_api_key_rate_limit: the per-key limit, the per-company limit across keys,
-- and the lastUsedAt it records.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/api-key-rate-limit.test.sql
-- All fixtures are confined to the rolled-back transaction. NOW() is the
-- transaction's start, so every call below lands in the same window.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.new_key(company text, key_limit integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE key_id text;
BEGIN
  INSERT INTO "apiKey" (name, "companyId", "createdBy", "keyHash")
    VALUES ('Rate limit ' || id(), company, 'system', id()) RETURNING id INTO key_id;
  IF key_limit IS NOT NULL THEN
    UPDATE "apiKey" SET "rateLimit" = key_limit WHERE id = key_id;
  END IF;
  RETURN key_id;
END;
$fn$;

-- Calls the limiter n times as the app does (the key's own limit and window)
-- and returns the last result.
CREATE FUNCTION pg_temp.hit(key_id text, n integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE result jsonb;
BEGIN
  FOR i IN 1..n LOOP
    SELECT check_api_key_rate_limit(k.id, k."rateLimit", k."rateLimitWindow") INTO result
    FROM "apiKey" k WHERE k.id = key_id;
  END LOOP;
  RETURN result;
END;
$fn$;

DO $proof$
DECLARE
  group_id text; company_a text; company_b text; company_c text;
  a1 text; a2 text; a3 text; a4 text; b1 text; b2 text; c1 text;
  r jsonb;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Rate limit ' || id(), 'system') RETURNING id INTO group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Rate limit A', group_id, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Rate limit B', group_id, 'USD', 'America/New_York') RETURNING id INTO company_b;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Rate limit C', group_id, 'USD', 'America/New_York') RETURNING id INTO company_c;

  a1 := pg_temp.new_key(company_a); a2 := pg_temp.new_key(company_a);
  a3 := pg_temp.new_key(company_a); a4 := pg_temp.new_key(company_a);
  b1 := pg_temp.new_key(company_b); b2 := pg_temp.new_key(company_b);
  c1 := pg_temp.new_key(company_c, 120);

  ASSERT (SELECT "rateLimit" = 20 AND "rateLimitWindow" = '1m' FROM "apiKey" WHERE id = a1),
    'a new key gets 20 requests per minute';
  RAISE NOTICE 'PASS new keys default to 20/min';

  UPDATE "apiKey" SET "lastUsedAt" = NOW() - INTERVAL '2 days' WHERE id = a2;
  ASSERT (SELECT "lastUsedAt" IS NULL FROM "apiKey" WHERE id = a1), 'an unused key has no lastUsedAt';

  r := pg_temp.hit(a1, 20);
  ASSERT (SELECT "lastUsedAt" = NOW() FROM "apiKey" WHERE id = a1), 'a request records lastUsedAt';
  ASSERT (SELECT "lastUsedAt" < NOW() FROM "apiKey" WHERE id = a2), 'and only on the key that made it';
  ASSERT (r->>'success')::boolean AND (r->>'remaining')::int = 0, 'the 20th request of a key passes';
  r := pg_temp.hit(a1);
  ASSERT NOT (r->>'success')::boolean AND (r->>'limit')::int = 20, 'the 21st request of a key is refused by the key limit';
  RAISE NOTICE 'PASS per-key limit';

  r := pg_temp.hit(a2, 20);
  ASSERT (SELECT "lastUsedAt" = NOW() FROM "apiKey" WHERE id = a2), 'a stale lastUsedAt is brought up to date';
  RAISE NOTICE 'PASS lastUsedAt is recorded';

  r := pg_temp.hit(a3, 20);
  ASSERT (r->>'success')::boolean, 'the 60th request of a company passes';
  r := pg_temp.hit(a4);
  ASSERT NOT (r->>'success')::boolean AND (r->>'limit')::int = 60 AND (r->>'count')::int = 61,
    'the 61st request of a company is refused by the company limit, on a key that has used 1 of 20';
  ASSERT (r->>'resetAt')::bigint = EXTRACT(EPOCH FROM date_trunc('minute', NOW()) + INTERVAL '1 minute')::bigint * 1000,
    'a company refusal resets at the end of the minute';
  RAISE NOTICE 'PASS per-company limit across keys';

  r := pg_temp.hit(b1);
  ASSERT (r->>'success')::boolean AND (r->>'remaining')::int = 19, 'another company is unaffected';
  r := pg_temp.hit(b1, 500);
  ASSERT NOT (r->>'success')::boolean AND (r->>'limit')::int = 20, 'a hammering key is refused by its own limit';
  r := pg_temp.hit(b2);
  ASSERT (r->>'success')::boolean, 'requests refused on one key do not use up the company''s allowance';
  RAISE NOTICE 'PASS a refused key does not lock out the company''s other keys';

  r := pg_temp.hit(c1, 60);
  ASSERT (r->>'success')::boolean AND (r->>'remaining')::int = 0, 'a key with a higher limit still passes its 60th request';
  r := pg_temp.hit(c1);
  ASSERT NOT (r->>'success')::boolean AND (r->>'limit')::int = 60, 'and is held to the company limit after that';
  RAISE NOTICE 'PASS a key above the company limit is capped by it';
END
$proof$;

ROLLBACK;
