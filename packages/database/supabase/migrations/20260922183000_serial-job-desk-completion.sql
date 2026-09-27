-- A serial job whose units already exist completes from the desk again.
--
-- 20260922050131 refused EVERY serial-tracked job that had an operation
-- shortfall, on the assumption that a missing operation quantity meant a
-- missing serial unit. It does not. Serial numbers are assigned at job
-- CREATION (assignJobSerialNumbers, on the create paths only), so the ordinary
-- desk flow -- create a serial job, release it, never open the Operations tab,
-- press Complete -- has every numbered unit Reserved and ready to receive while
-- each operation still reads 0. Those jobs completed before that migration and
-- were refused after it, with "a serial number is required" naming serials that
-- were sitting right there.
--
-- Fix: drop the guard. complete_job_to_inventory's serial branch already
-- refuses a job genuinely short of units ("has N serial unit(s) left to
-- receive, fewer than the M being completed") after trying the un-numbered seed
-- fallback, and it runs in the same transaction, so a real shortage still rolls
-- the completion back. The guard could only ever duplicate that decision from
-- worse evidence: operation quantities rather than the tracked entities the
-- receipt actually consumes. Deleting it removes the disagreement instead of
-- teaching two places to agree.
--
-- Recreated VERBATIM from 20260922050131_mark-complete-completes-remaining-quantities.sql
-- minus the serial guard and its now-unused v_serial_* locals.

CREATE OR REPLACE FUNCTION complete_job_remaining_quantities(
  p_job_id TEXT,
  p_quantity_complete NUMERIC,
  p_user_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shortfall NUMERIC;
BEGIN
  -- Only the manual path closes operations. Under a trigger this is the MES
  -- path, where the floor reports its own quantities — and where writing a
  -- sibling jobOperation row fails with "tuple to be updated was already
  -- modified by an operation triggered by the current command", since
  -- sync_finish_job_operation is a BEFORE trigger mid-statement on those rows.
  IF pg_trigger_depth() > 0 THEN
    RETURN;
  END IF;

  -- The largest shortfall across the terminal operations. MAX, not SUM: these
  -- are parallel paths to the same finished part and each must report the full
  -- quantity, so summing them would invent units nobody required. Reworked
  -- units already satisfy the auto-Done predicate, so they count as reported.
  SELECT COALESCE(MAX(
           p_quantity_complete
           - COALESCE(t."quantityComplete", 0)
           - COALESCE(t."quantityReworked", 0)
         ), 0)
  INTO v_shortfall
  FROM terminal_job_operations(p_job_id) t;

  IF v_shortfall <= 0 THEN
    RETURN;
  END IF;

  -- Status as well as quantity. The auto-Done predicate lives in
  -- sync_update_job_operation_quantities, which fires on productionQuantity
  -- writes — not on a jobOperation update — so nothing else would close these
  -- operations, and a quantity-only write would leave the routing open behind a
  -- Completed job: the very symptom this function exists to remove.
  --
  -- Setting status here fires sync_finish_job_operation on each row. The caller
  -- must therefore have marked the job Completed already: the interceptor's
  -- status gate then returns early. Called while the job is still open it would
  -- instead re-enter complete_job_to_inventory and, being a BEFORE row trigger
  -- reading the pre-update quantityComplete, receive the goods a second time.
  --
  -- Every open terminal operation is closed, not only the short ones: an
  -- operation whose quantity already meets the target is Done by the same
  -- predicate the interceptor uses, so leaving it Ready on a Completed job
  -- would recreate the inconsistency this function exists to remove.
  --
  -- Reworked units already count as reported, so the new quantityComplete is
  -- the target MINUS them. Assigning the full target on top of a reworked unit
  -- would report more units than the operation ever produced (target 3 with 1
  -- complete + 1 reworked must end at 2 complete + 1 reworked, not 3 + 1).
  -- GREATEST never lowers a quantity the floor already reported.
  UPDATE "jobOperation" jo
  SET "quantityComplete" = GREATEST(
        COALESCE(t."quantityComplete", 0),
        p_quantity_complete - COALESCE(t."quantityReworked", 0)
      ),
      status = 'Done',
      "updatedBy" = COALESCE(p_user_id, jo."updatedBy", jo."createdBy"),
      "updatedAt" = NOW()
  FROM terminal_job_operations(p_job_id) t
  WHERE jo.id = t.id;
END;
$$;

-- SECURITY DEFINER with no p_company_id to bind the call to a tenant; it stays
-- an internal helper of complete_job_to_inventory, which does enforce the
-- company check. CREATE OR REPLACE preserves grants, but re-assert them so the
-- revoke cannot be lost if this function is ever recreated from this file.
REVOKE ALL ON FUNCTION complete_job_remaining_quantities(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
