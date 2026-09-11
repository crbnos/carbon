-- Atomic company-integration metadata + Vault path patching.
-- Run from the repository root against an existing migrated local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 \
--   -f packages/database/supabase/tests/integration-metadata-patch.test.sql
-- All fixtures and mutations are rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $schema$
DECLARE
  signature regprocedure := to_regprocedure(
    'public.upsert_company_integration_patch(text,text,jsonb,jsonb,text[],text[],boolean,text)'
  );
BEGIN
  ASSERT signature IS NOT NULL,
    'upsert_company_integration_patch RPC must exist';
  ASSERT has_function_privilege('service_role', signature, 'EXECUTE'),
    'service_role must be allowed to patch integration state';
  ASSERT NOT has_function_privilege('anon', signature, 'EXECUTE'),
    'anon must not be allowed to patch integration state';
  ASSERT NOT has_function_privilege('authenticated', signature, 'EXECUTE'),
    'authenticated must not be allowed to patch integration state';
END;
$schema$;

DO $patches$
DECLARE
  group_id text;
  company_id text;
  stored jsonb;
  secret_before jsonb;
  secret_after jsonb;
  metadata_before jsonb;
  patch_failed boolean := false;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy")
    VALUES ('Integration patch ' || id(), 'system')
    RETURNING id INTO group_id;
  INSERT INTO "company" (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Integration patch ' || id(), group_id, 'USD', 'America/New_York')
    RETURNING id INTO company_id;

  PERFORM upsert_company_integration_patch(
    company_id,
    'ramp',
    '{"entityId":"bootstrap"}'::jsonb,
    '{}'::jsonb,
    ARRAY[]::text[],
    ARRAY[]::text[],
    false,
    'system'
  );
  ASSERT EXISTS (
    SELECT 1 FROM "companyIntegration"
    WHERE id = 'ramp'
      AND "companyId" = company_id
      AND metadata::jsonb->>'entityId' = 'bootstrap'
  ), 'atomic patch did not upsert a missing integration row';
  DELETE FROM "companyIntegration"
  WHERE id = 'ramp' AND "companyId" = company_id;

  INSERT INTO "companyIntegration" (
    id, "companyId", active, metadata, "updatedBy"
  ) VALUES (
    'ramp', company_id, true,
    '{"cardLiabilityAccountId":"account-old","connectionId":"connection-old","webhookId":"webhook-old","cursors":{"repaymentsRepaidAt":"cursor-old"}}'::json,
    'system'
  );

  -- These two callers both started from the same conceptual stale snapshot.
  -- Because each declares only its owned paths, the second patch cannot erase
  -- the first or any untouched sibling.
  PERFORM upsert_company_integration_patch(
    company_id,
    'ramp',
    '{"connectionId":"connection-new","cursors.invoicePushUpdatedAt":"invoice-cursor"}'::jsonb,
    '{}'::jsonb,
    ARRAY[]::text[],
    ARRAY[]::text[],
    NULL,
    'system'
  );
  PERFORM upsert_company_integration_patch(
    company_id,
    'ramp',
    '{"cardLiabilityAccountId":"account-new"}'::jsonb,
    '{"credentials.accessToken":"access-old","webhookSecret":"webhook-secret"}'::jsonb,
    ARRAY[]::text[],
    ARRAY[]::text[],
    NULL,
    'system'
  );

  SELECT metadata::jsonb INTO stored
  FROM "companyIntegration"
  WHERE id = 'ramp' AND "companyId" = company_id;
  ASSERT stored->>'cardLiabilityAccountId' = 'account-new',
    'settings-owned metadata patch was lost';
  ASSERT stored->>'connectionId' = 'connection-new',
    'runtime connection patch was lost';
  ASSERT stored->>'webhookId' = 'webhook-old',
    'untouched metadata sibling was lost';
  ASSERT stored #>> '{cursors,repaymentsRepaidAt}' = 'cursor-old',
    'existing cursor sibling was lost';
  ASSERT stored #>> '{cursors,invoicePushUpdatedAt}' = 'invoice-cursor',
    'nested cursor patch was not created';

  SELECT get_integration_secret(company_id, 'ramp') INTO secret_before;
  ASSERT secret_before->>'credentials.accessToken' = 'access-old',
    'access token was not vaulted';
  ASSERT secret_before->>'webhookSecret' = 'webhook-secret',
    'webhook secret was not vaulted';

  -- If a historical/broken row lost its pointer, adopting the deterministic
  -- Vault record must load and retain every sibling secret before patching.
  UPDATE "companyIntegration" SET "secretRef" = NULL
  WHERE id = 'ramp' AND "companyId" = company_id;
  PERFORM upsert_company_integration_patch(
    company_id,
    'ramp',
    '{}'::jsonb,
    '{"credentials.accessToken":"access-adopted"}'::jsonb,
    ARRAY[]::text[],
    ARRAY[]::text[],
    NULL,
    'system'
  );
  SELECT get_integration_secret(company_id, 'ramp') INTO secret_before;
  ASSERT secret_before->>'credentials.accessToken' = 'access-adopted',
    'orphaned deterministic Vault secret was not adopted';
  ASSERT secret_before->>'webhookSecret' = 'webhook-secret',
    'adopting an orphaned Vault record erased a sibling secret';

  -- Force the final metadata write to fail AFTER the Vault update. The caught
  -- statement error must roll the Vault mutation back with the row mutation.
  metadata_before := stored;
  UPDATE "integration"
  SET jsonschema = '{"type":"object","properties":{},"additionalProperties":false}'::json
  WHERE id = 'ramp';

  BEGIN
    PERFORM upsert_company_integration_patch(
      company_id,
      'ramp',
      '{"connectionId":"must-not-stick"}'::jsonb,
      '{"credentials.accessToken":"must-not-stick"}'::jsonb,
      ARRAY[]::text[],
      ARRAY[]::text[],
      NULL,
      'system'
    );
  EXCEPTION WHEN OTHERS THEN
    patch_failed := true;
  END;
  ASSERT patch_failed,
    'invalid metadata should fail the atomic patch';

  SELECT metadata::jsonb INTO stored
  FROM "companyIntegration"
  WHERE id = 'ramp' AND "companyId" = company_id;
  SELECT get_integration_secret(company_id, 'ramp') INTO secret_after;
  ASSERT stored = metadata_before,
    'metadata changed despite the failed atomic patch';
  ASSERT secret_after = secret_before,
    'Vault secret changed despite the failed metadata write';

  RAISE NOTICE 'PASS disjoint path patches compose and Vault/metadata roll back together';
END;
$patches$;

ROLLBACK;
