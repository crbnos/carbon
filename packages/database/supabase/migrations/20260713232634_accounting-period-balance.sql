-- ============================================================
-- accountingPeriodBalance: per-account GL balance snapshots at period close.
--
-- One row per (leaf account, company, closed period) holding the CUMULATIVE
-- balance through the period's endDate (not the per-period net), so a read
-- needs exactly one snapshot row. Written by snapshotAccountingPeriodBalances,
-- which the period-close flow calls inside its transaction. The balance RPCs
-- (next migration) read "latest snapshot + journal lines after it" and fall
-- back to the full-history scan when no snapshot exists, so this table is
-- inert until a close flow starts writing it.
--
-- Correctness invariants the period-close flow MUST enforce (and where each is):
--   1. No posting with a postingDate inside a closed period (the check must
--      be on postingDate, not just the assigned accountingPeriodId — the edge
--      functions' getCurrentAccountingPeriod resolves periods by server time,
--      so a backdated postingDate could otherwise land behind a snapshot).
--      Enforced by check_accounting_period_open (period-close-lifecycle), which
--      also takes the period row FOR SHARE (migration 20260713235930) so a
--      posting can't race the close and slip behind the snapshot.
--   2. Periods close in order: a period cannot close while an earlier period
--      for the same company is open. Enforced by closeAccountingPeriod.
--   3. Reopening period N deletes this company's snapshots with
--      "endingBalanceDate" >= that period's endDate (they are cumulative, so
--      later snapshots embed period N's data). Enforced by reopenAccountingPeriod.
-- ============================================================

CREATE TABLE IF NOT EXISTS "accountingPeriodBalance" (
    "id" TEXT NOT NULL DEFAULT id('apb'),
    "companyId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL REFERENCES "account"("id"),
    -- cumulative balance through the period's endDate, Draft journals excluded
    "endingBalance" NUMERIC NOT NULL DEFAULT 0,
    -- denormalized period endDate so reads don't join accountingPeriod
    "endingBalanceDate" DATE NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("accountingPeriodId") REFERENCES "accountingPeriod"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "accountingPeriodBalance_account_period_key"
  ON "accountingPeriodBalance" ("accountId", "accountingPeriodId", "companyId");
-- the read path's lookup: snapshots for a company at a specific endDate
CREATE INDEX IF NOT EXISTS "accountingPeriodBalance_companyId_date_idx"
  ON "accountingPeriodBalance" ("companyId", "endingBalanceDate" DESC, "accountId");
CREATE INDEX IF NOT EXISTS "accountingPeriodBalance_companyId_idx"
  ON "accountingPeriodBalance" ("companyId");
CREATE INDEX IF NOT EXISTS "accountingPeriodBalance_accountingPeriodId_idx"
  ON "accountingPeriodBalance" ("accountingPeriodId");
CREATE INDEX IF NOT EXISTS "accountingPeriodBalance_accountId_idx"
  ON "accountingPeriodBalance" ("accountId");
CREATE INDEX IF NOT EXISTS "accountingPeriodBalance_createdBy_idx"
  ON "accountingPeriodBalance" ("createdBy");

ALTER TABLE "public"."accountingPeriodBalance" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."accountingPeriodBalance";
CREATE POLICY "SELECT" ON "public"."accountingPeriodBalance"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."accountingPeriodBalance";
CREATE POLICY "INSERT" ON "public"."accountingPeriodBalance"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."accountingPeriodBalance";
CREATE POLICY "UPDATE" ON "public"."accountingPeriodBalance"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

-- Snapshots are an internal, derived optimization artifact tied to the period
-- lifecycle. reopenAccountingPeriod clears them through the RLS-enforced request
-- client, and reopening is an update-tier action (like lock/close), so gate the
-- DELETE on accounting_update — not accounting_delete — otherwise the reopen
-- route (which holds accounting_update) would silently no-op the cleanup and
-- leave stale snapshots behind. Deleting a snapshot only forces a full-scan
-- recompute, so update-tier access is the right bar.
DROP POLICY IF EXISTS "DELETE" ON "public"."accountingPeriodBalance";
CREATE POLICY "DELETE" ON "public"."accountingPeriodBalance"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

-- Snapshot writer. Runs the last full-history scan a period will ever need —
-- once, at close time, inside the close transaction. Idempotent via upsert so
-- a retried close (or a re-close after reopen) refreshes the rows in place.
CREATE OR REPLACE FUNCTION "snapshotAccountingPeriodBalances" (
  p_company_id TEXT,
  p_period_id TEXT,
  p_user_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_end_date DATE;
  v_close_status "periodCloseStatus";
BEGIN
  SELECT "endDate", "closeStatus" INTO v_end_date, v_close_status
  FROM "accountingPeriod"
  WHERE "id" = p_period_id AND "companyId" = p_company_id;

  IF v_end_date IS NULL THEN
    RAISE EXCEPTION 'Accounting period % not found for company %', p_period_id, p_company_id;
  END IF;

  -- Only Closed periods may hold a snapshot. A Closed period cannot receive new
  -- postings (the journal_check_period_open trigger from the period-close
  -- lifecycle blocks any journal whose postingDate lands in a closed period), so
  -- its cumulative balance is frozen and the snapshot can never go stale.
  -- closeAccountingPeriod flips the period to Closed inside its transaction
  -- before calling this, so the check passes for the intended caller; refusing
  -- anything else is defense-in-depth against writing a snapshot a later posting
  -- could invalidate.
  IF v_close_status IS DISTINCT FROM 'Closed' THEN
    RAISE EXCEPTION 'Cannot snapshot accounting period %: period is not Closed (closeStatus=%)',
      p_period_id, v_close_status;
  END IF;

  INSERT INTO "accountingPeriodBalance"
    ("companyId", "accountingPeriodId", "accountId", "endingBalance", "endingBalanceDate", "createdBy")
  SELECT
    p_company_id,
    p_period_id,
    a."id",
    COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" <= v_end_date
                      THEN jl."amount" ELSE 0 END), 0),
    v_end_date,
    p_user_id
  FROM "account" a
  LEFT JOIN "journalLine" jl ON jl."accountId" = a."id" AND jl."companyId" = p_company_id
  LEFT JOIN "journal" j ON j."id" = jl."journalId"
  WHERE a."isGroup" = false
    AND a."active" = true
    AND a."companyGroupId" = (SELECT "companyGroupId" FROM "company" WHERE "id" = p_company_id)
  GROUP BY a."id"
  ON CONFLICT ("accountId", "accountingPeriodId", "companyId")
  DO UPDATE SET
    "endingBalance" = EXCLUDED."endingBalance",
    "endingBalanceDate" = EXCLUDED."endingBalanceDate",
    "updatedBy" = p_user_id,
    "updatedAt" = NOW();
END;
$$;
