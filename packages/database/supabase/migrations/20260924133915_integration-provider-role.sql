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
--
-- A trigger rather than a UNIQUE partial index, for two independent reasons:
--   1. `providerRole` lives on the GLOBAL `integration` registry, not on
--      `companyIntegration`. A unique index can only span columns of its own
--      table and IMMUTABLE expressions of them, so expressing "one active per
--      (companyId, providerRole)" as an index would mean denormalizing
--      `providerRole` onto every `companyIntegration` row and keeping the copy
--      in sync — a strictly larger correctness problem than the one it solves.
--   2. CREATE UNIQUE INDEX validates existing rows, so it would FAIL outright
--      on any company that already holds two active integrations of one role —
--      exactly the state the paragraph above deliberately grandfathers.
-- The index's real advantage is that it makes the race structurally impossible;
-- the advisory lock below buys that back for the trigger.
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

  -- Serialize activations per (company, role) before the lookup. The check
  -- below is a plain read, so under READ COMMITTED (what every write path runs
  -- at) two concurrent activations — two OAuth callbacks, two
  -- upsert_company_integration_patch calls — would each miss the other's
  -- uncommitted row, both find no conflict, and both commit: two active
  -- accounting integrations, the exact state this trigger exists to prevent.
  -- Holding the lock makes the second transaction wait for the first to commit,
  -- and its next statement then takes a fresh snapshot that sees that row.
  --
  -- The E'\x1f' separator and hashtextextended() match
  -- upsert_company_integration_patch's own lock key; the 'providerRole' tag
  -- keeps the two key spaces from ever colliding (that one keys on
  -- companyId + integrationId, and an integration could one day be ID'd
  -- 'accounting'). `companyId` is NOT NULL, so the key is never NULL — which
  -- would silently acquire no lock at all.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      NEW."companyId" || E'\x1f' || 'providerRole' || E'\x1f' || v_role, 0
    )
  );

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
