-- Rollback-validation for 20260829142619_sso-domain-guard.sql
--
-- Proves the auth.sso_domains guard trigger without leaving any state behind.
-- Everything runs inside ONE transaction that always ROLLBACKs, so it is safe to
-- point at a development database. Run as a superuser/`supabase_admin` (the
-- migration + auth schema require it):
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f .ai/runs/2026-08-29-sso-domain-guard-rollback.sql
--
-- NOTE (2026-08-29): authored but NOT executed here — the local DB was not
-- running. Run it once the migration is applied. Expected final line: "ALL GUARD
-- ASSERTIONS PASSED", then the ROLLBACK.

BEGIN;

-- Apply the migration under test (idempotent: CREATE TABLE IF NOT EXISTS /
-- CREATE OR REPLACE / DROP TRIGGER IF EXISTS). Safe whether or not it is already
-- applied on this database.
\i packages/database/supabase/migrations/20260829142619_sso-domain-guard.sql

-- A GoTrue SSO provider to satisfy auth.sso_domains.sso_provider_id (FK).
INSERT INTO auth.sso_providers ("id", "created_at", "updated_at")
VALUES ('99999999-9999-4999-8999-999999999999', now(), now());

DO $$
DECLARE
  raised boolean;
BEGIN
  -- 1) An UNCLAIMED domain (no public.ssoDomain row) must be rejected.
  raised := false;
  BEGIN
    INSERT INTO auth.sso_domains ("id", "sso_provider_id", "domain", "created_at", "updated_at")
    VALUES (gen_random_uuid(), '99999999-9999-4999-8999-999999999999', 'unclaimed.example', now(), now());
  EXCEPTION WHEN others THEN
    raised := true;
    ASSERT SQLERRM LIKE '%no ssoDomain claim%',
      'unclaimed domain raised the wrong error: ' || SQLERRM;
  END;
  ASSERT raised, 'expected an unclaimed domain to be BLOCKED, but the insert succeeded';

  -- 2) A RESERVED domain must be rejected even if (hypothetically) claimed.
  raised := false;
  BEGIN
    INSERT INTO auth.sso_domains ("id", "sso_provider_id", "domain", "created_at", "updated_at")
    VALUES (gen_random_uuid(), '99999999-9999-4999-8999-999999999999', 'gmail.com', now(), now());
  EXCEPTION WHEN others THEN
    raised := true;
    ASSERT SQLERRM LIKE '%reserved domain%',
      'reserved domain raised the wrong error: ' || SQLERRM;
  END;
  ASSERT raised, 'expected a reserved domain to be BLOCKED, but the insert succeeded';

  -- 3) The staff override bypasses the guard entirely (own-domain setup path).
  PERFORM set_config('app.sso_domain_override', 'on', true);
  INSERT INTO auth.sso_domains ("id", "sso_provider_id", "domain", "created_at", "updated_at")
  VALUES (gen_random_uuid(), '99999999-9999-4999-8999-999999999999', 'gmail.com', now(), now());
  PERFORM set_config('app.sso_domain_override', 'off', true);
  ASSERT EXISTS (
    SELECT 1 FROM auth.sso_domains WHERE "domain" = 'gmail.com'
  ), 'override should have allowed the insert';

  RAISE NOTICE 'ALL GUARD ASSERTIONS PASSED';
END $$;

-- Happy path (a real, verified claim is allowed) is exercised end-to-end by
-- verifySsoDomain in packages/ee/src/sso/connections.server.ts and is not
-- re-seeded here — it would require the full company/user/ssoConnection/ssoDomain
-- FK chain. The three assertions above cover the guard's security logic.

ROLLBACK;
