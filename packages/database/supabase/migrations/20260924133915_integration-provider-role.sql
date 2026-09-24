-- Integration provider roles + one-active-per-role exclusivity.
--
-- "Which integrations are accounting providers" is currently answered five
-- different ways (Object.values(ProviderID) in three sweeps,
-- ACCOUNTING_SYNC_INTEGRATION_IDS, an inline array in the accounting layout,
-- and category === "Accounting"), and "which are spend providers" is
-- .eq("id","ramp"). `providerRole` is the one declaration all of them collapse
-- onto.
--
-- It also makes exclusivity expressible at all: nothing today stops a company
-- activating two accounting integrations, and the period-close readiness check
-- literally loops over "at most three".
--
-- `integration` is a GLOBAL registry (id + jsonschema), not a tenant table — no
-- companyId, no composite PK, no RLS policies. The standard table template
-- deliberately does not apply.

ALTER TABLE "integration"
  ADD COLUMN IF NOT EXISTS "providerRole" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_providerRole_check'
  ) THEN
    ALTER TABLE "integration"
      ADD CONSTRAINT "integration_providerRole_check"
      CHECK ("providerRole" IS NULL OR "providerRole" IN ('accounting', 'spend'));
  END IF;
END $$;

-- Backfill. `IS DISTINCT FROM` so a re-run writes nothing — the deploy runner
-- retries a failed file over committed partial state.
UPDATE "integration" SET "providerRole" = 'accounting'
  WHERE id IN ('xero', 'quickbooks', 'rillet')
    AND "providerRole" IS DISTINCT FROM 'accounting';

UPDATE "integration" SET "providerRole" = 'spend'
  WHERE id = 'ramp'
    AND "providerRole" IS DISTINCT FROM 'spend';

-- One active integration per role per company.
--
-- Enforced here rather than in application code because there are too many
-- write paths to guard: upsertCompanyIntegration, the
-- upsert_company_integration_patch RPC, and each provider's OAuth callback —
-- several of them running under the service role, where RLS would not catch a
-- mismatch either.
--
-- Fires ONLY on INSERT and on a false -> true transition, so a company that
-- already holds two active integrations of one role is NOT retroactively
-- invalidated; it simply cannot activate a third. Repairing existing data is a
-- human decision, never a migration's.
CREATE OR REPLACE FUNCTION public.check_single_active_provider_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_conflict TEXT;
BEGIN
  IF NEW."active" IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."active" IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT "providerRole" INTO v_role FROM "integration" WHERE id = NEW."id";
  IF v_role IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ci."id" INTO v_conflict
  FROM "companyIntegration" ci
  JOIN "integration" i ON i.id = ci."id"
  WHERE ci."companyId" = NEW."companyId"
    AND ci."active" IS TRUE
    AND ci."id" <> NEW."id"
    AND i."providerRole" = v_role
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    -- 23505 (unique_violation) so callers can tell a role conflict from a
    -- generic failure and turn it into the "uninstall X first" UX rather than
    -- a 500.
    RAISE EXCEPTION
      'Only one active % integration is allowed per company; % is already active',
      v_role, v_conflict
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "companyIntegration_single_active_role" ON "companyIntegration";
CREATE TRIGGER "companyIntegration_single_active_role"
  BEFORE INSERT OR UPDATE OF "active" ON "companyIntegration"
  FOR EACH ROW EXECUTE FUNCTION public.check_single_active_provider_role();
