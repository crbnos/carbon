-- Accounting cutover (.ai/specs/2026-10-08-accounting-cutover.md).
--
-- Every company posts journals. Before its cutover they are Provisional and
-- count nowhere; the enable turns those dated on or after the cutover date
-- into Posted and the earlier ones into Superseded. This migration adds the
-- cutover stamp, the stand-in role column, the status decision for SQL
-- posting functions, and the guards that keep a Superseded journal fixed and
-- a promotion out of a closed period.

-- ── 1. The cutover stamp ────────────────────────────────────────────────────

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "accountingCutoverDate" DATE,
  ADD COLUMN IF NOT EXISTS "accountingActivatedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "accountingActivatedBy" TEXT REFERENCES "user"("id");

-- The account the opening journal offsets every open item and trial balance
-- line against. Nullable: an existing chart picks or creates it in the
-- enable wizard; a new company gets 3400 from the seed data.
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "migrationClearingAccount" TEXT;

-- ── 2. Stand-in lines ───────────────────────────────────────────────────────

-- The accountDefault column a stand-in line wanted. Before the cutover, a
-- posting that needs an empty default writes the line to
-- retainedEarningsAccount and names the default here; the enable re-points
-- it. Null on every other line. No default is filled by account number here:
-- numbers and names are user-editable, so a match by number can point a
-- default at an unrelated account.
ALTER TABLE "journalLine"
  ADD COLUMN IF NOT EXISTS "accountDefaultRole" TEXT;

-- ── 3. The status an automatic posting writes ───────────────────────────────

CREATE OR REPLACE FUNCTION public.journal_posting_status(p_company_id TEXT)
RETURNS "journalEntryStatus"
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN cs."accountingCutoverDate" IS NULL
    THEN 'Provisional'::"journalEntryStatus"
    ELSE 'Posted'::"journalEntryStatus" END
  FROM "companySettings" cs
  WHERE cs."id" = p_company_id;
$$;

-- ── 4. A Superseded journal never changes ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_posted_record_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parent_status "journalEntryStatus";
BEGIN
  IF TG_TABLE_NAME = 'journal' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."status" IN ('Posted', 'Reversed', 'Superseded') THEN
        RAISE EXCEPTION 'Posted journal % is immutable and cannot be deleted; reverse it instead', OLD."id";
      END IF;
      RETURN OLD;
    END IF;
    IF OLD."status" = 'Superseded' THEN
      RAISE EXCEPTION 'Journal % was superseded at the accounting cutover and cannot change', OLD."id";
    END IF;
    IF OLD."status" = 'Posted' AND NEW."status" IS DISTINCT FROM 'Reversed' THEN
      RAISE EXCEPTION 'Posted journal % is immutable; only the Posted -> Reversed transition is permitted', OLD."id";
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'journalLine' THEN
    SELECT "status" INTO v_parent_status FROM "journal" WHERE "id" = OLD."journalId";
    IF v_parent_status IN ('Posted', 'Reversed', 'Superseded') THEN
      RAISE EXCEPTION 'Journal line % is immutable because journal % is posted', OLD."id", OLD."journalId";
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. A promotion runs the closed-period check ─────────────────────────────

CREATE OR REPLACE FUNCTION public.check_accounting_period_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_status "periodCloseStatus";
  v_old_status "periodCloseStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'Draft' THEN
      SELECT "closeStatus" INTO v_old_status
      FROM "accountingPeriod"
      WHERE ("id" = OLD."accountingPeriodId")
         OR (OLD."accountingPeriodId" IS NULL
             AND "companyId" = OLD."companyId"
             AND OLD."postingDate" BETWEEN "startDate" AND "endDate")
      LIMIT 1;
      IF v_old_status = 'Closed' THEN
        RAISE EXCEPTION 'Cannot delete journal %: accounting period is closed', OLD."id";
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- Skip UPDATEs that neither move the journal between periods nor post it.
  -- A Provisional journal becoming Posted is a posting, like a Draft one.
  IF TG_OP = 'UPDATE'
     AND NEW."postingDate" IS NOT DISTINCT FROM OLD."postingDate"
     AND NEW."accountingPeriodId" IS NOT DISTINCT FROM OLD."accountingPeriodId"
     AND NOT (OLD."status" IN ('Draft', 'Provisional') AND NEW."status" = 'Posted') THEN
    RETURN NEW;
  END IF;

  -- Moving a journal OUT of a closed period changes closed financials too
  IF TG_OP = 'UPDATE'
     AND (NEW."postingDate" IS DISTINCT FROM OLD."postingDate"
          OR NEW."accountingPeriodId" IS DISTINCT FROM OLD."accountingPeriodId") THEN
    SELECT "closeStatus" INTO v_old_status
    FROM "accountingPeriod"
    WHERE ("id" = OLD."accountingPeriodId")
       OR (OLD."accountingPeriodId" IS NULL
           AND "companyId" = OLD."companyId"
           AND OLD."postingDate" BETWEEN "startDate" AND "endDate")
    LIMIT 1;
    IF v_old_status = 'Closed' THEN
      RAISE EXCEPTION 'Cannot move journal % out of a closed accounting period', OLD."id";
    END IF;
  END IF;

  -- FOR SHARE: block behind an in-flight close of this period so a posting
  -- can never slip a line into a period after its snapshot was taken.
  SELECT "closeStatus" INTO v_new_status
  FROM "accountingPeriod"
  WHERE ("id" = NEW."accountingPeriodId")
     OR (NEW."accountingPeriodId" IS NULL
         AND "companyId" = NEW."companyId"
         AND NEW."postingDate" BETWEEN "startDate" AND "endDate")
  LIMIT 1
  FOR SHARE;

  IF v_new_status = 'Closed' THEN
    RAISE EXCEPTION 'Accounting period is closed for posting date %', NEW."postingDate";
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 6. The ledger's denomination and calendar freeze at the enable ──────────

CREATE OR REPLACE FUNCTION public.check_accounting_config_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_activated_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF TG_TABLE_NAME = 'companySettings' THEN
    IF OLD."accountingActivatedAt" IS NOT NULL
       AND (NEW."accountingCutoverDate" IS DISTINCT FROM OLD."accountingCutoverDate"
         OR NEW."accountingActivatedAt" IS DISTINCT FROM OLD."accountingActivatedAt"
         OR NEW."accountingActivatedBy" IS DISTINCT FROM OLD."accountingActivatedBy") THEN
      RAISE EXCEPTION 'The accounting cutover is one-way and cannot change';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'company' THEN
    SELECT cs."accountingActivatedAt" INTO v_activated_at
    FROM "companySettings" cs WHERE cs."id" = NEW."id";
    IF v_activated_at IS NOT NULL
       AND NEW."baseCurrencyCode" IS DISTINCT FROM OLD."baseCurrencyCode" THEN
      RAISE EXCEPTION 'The base currency is locked: accounting was set up %', v_activated_at;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'fiscalYearSettings' THEN
    SELECT cs."accountingActivatedAt" INTO v_activated_at
    FROM "companySettings" cs WHERE cs."id" = NEW."companyId";
    IF v_activated_at IS NOT NULL
       AND NEW."startMonth" IS DISTINCT FROM OLD."startMonth" THEN
      RAISE EXCEPTION 'The fiscal year start is locked: accounting was set up %', v_activated_at;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "companySettings_accounting_config_locked" ON "companySettings";
CREATE TRIGGER "companySettings_accounting_config_locked"
  BEFORE UPDATE ON "companySettings"
  FOR EACH ROW EXECUTE FUNCTION public.check_accounting_config_locked();

DROP TRIGGER IF EXISTS "company_accounting_config_locked" ON "company";
CREATE TRIGGER "company_accounting_config_locked"
  BEFORE UPDATE ON "company"
  FOR EACH ROW EXECUTE FUNCTION public.check_accounting_config_locked();

DROP TRIGGER IF EXISTS "fiscalYearSettings_accounting_config_locked" ON "fiscalYearSettings";
CREATE TRIGGER "fiscalYearSettings_accounting_config_locked"
  BEFORE UPDATE ON "fiscalYearSettings"
  FOR EACH ROW EXECUTE FUNCTION public.check_accounting_config_locked();

-- ── 7. Companies already keeping a ledger in Carbon ─────────────────────────

-- After 20261008211304_reset-accounting only the demo-template companies
-- still have accountingEnabled. Their history is in Carbon already, so their
-- cutover is the start of the earliest period with a Posted journal.
UPDATE "companySettings" cs SET
  "accountingCutoverDate" = sub."cutover",
  "accountingActivatedAt" = NOW(),
  "accountingActivatedBy" = 'system'
FROM (
  SELECT j."companyId", MIN(ap."startDate") AS "cutover"
  FROM "journal" j
  JOIN "accountingPeriod" ap ON ap."id" = j."accountingPeriodId"
  WHERE j."status" = 'Posted'
  GROUP BY j."companyId"
) sub
WHERE sub."companyId" = cs."id"
  AND cs."accountingEnabled" = true
  AND cs."accountingCutoverDate" IS NULL;
