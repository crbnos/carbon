-- ============================================================
-- Close the concurrency gap between posting and period close introduced by the
-- accountingPeriodBalance snapshot (20260713232634).
--
-- The snapshot is written inside closeAccountingPeriod's transaction, after the
-- period flips to Closed. A period only becomes Closed on COMMIT, and a Locked
-- period still accepts postings (that is the point of Locked). So without extra
-- locking a journal could be inserted into the period in the window between the
-- close txn's snapshot SELECT and its COMMIT: the posting's BEFORE trigger reads
-- the period as still-Locked (the close's UPDATE is uncommitted), lets it
-- through, and it commits a line with postingDate <= endDate that the snapshot
-- never saw. The read path's delta only picks up postingDate > endDate, so that
-- line would be silently dropped from the optimized balance until reopen+reclose.
--
-- Fix: the posting guard reads the target period FOR SHARE. FOR SHARE conflicts
-- with the FOR-NO-KEY-UPDATE row lock that closeAccountingPeriod's
-- `UPDATE ... SET "closeStatus" = 'Closed'` holds until commit, so:
--   * a posting that starts before the close's UPDATE takes its share lock
--     first; the close's UPDATE then waits for the posting to commit, and the
--     snapshot (which runs after the UPDATE) sees that line.
--   * a posting that starts after the close's UPDATE blocks on the exclusive
--     lock until the close commits, then re-reads closeStatus = 'Closed' and is
--     rejected.
-- Either ordering is now race-free. Concurrent postings do NOT block each other
-- (FOR SHARE is shared); only an in-flight close serializes them briefly.
--
-- Forked from 20260702044133_period-close-lifecycle.sql. Only the final
-- period-status SELECT (the INSERT / move-into path) gains FOR SHARE — that is
-- the path a new line lands on. CREATE OR REPLACE keeps the existing
-- journal_check_period_open trigger binding intact.
-- ============================================================

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

  -- Skip UPDATEs that neither move the journal between periods nor post a draft
  IF TG_OP = 'UPDATE'
     AND NEW."postingDate" IS NOT DISTINCT FROM OLD."postingDate"
     AND NEW."accountingPeriodId" IS NOT DISTINCT FROM OLD."accountingPeriodId"
     AND NOT (OLD."status" = 'Draft' AND NEW."status" = 'Posted') THEN
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

  -- FOR SHARE: block behind an in-flight close of this period (see header) so a
  -- posting can never slip a line into a period after its snapshot was taken.
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
