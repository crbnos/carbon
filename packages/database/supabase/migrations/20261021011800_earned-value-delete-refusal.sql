-- Government Contracting Phase 5c: a clear refusal when a project with earned
-- value in a Closed period is deleted.
--
-- Forked from 20261021011600_project-control.sql, the only definition of
-- check_earned_value_period_open. The freeze is unchanged: a Closed period's
-- earned value rows never change. A project delete cascades to its
-- earnedValuePeriod rows, and the freeze refused that cascade with "Earned value
-- of a closed period cannot change", which does not say what the user did.
-- In the cascade the project row is already gone, so the function names the
-- project delete instead.

CREATE OR REPLACE FUNCTION public.check_earned_value_period_open()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status "periodCloseStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "closeStatus" INTO v_status FROM "accountingPeriod" WHERE "id" = OLD."accountingPeriodId" FOR SHARE;
    IF v_status = 'Closed' THEN
      IF TG_OP = 'DELETE' AND NOT EXISTS (
        SELECT 1 FROM "project" p
        WHERE p."id" = OLD."projectId" AND p."companyId" = OLD."companyId"
      ) THEN
        RAISE EXCEPTION 'This project has earned value in a closed accounting period, so it cannot be deleted. Deactivate it instead.';
      END IF;
      RAISE EXCEPTION 'Earned value of a closed period cannot change';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "closeStatus" INTO v_status FROM "accountingPeriod" WHERE "id" = NEW."accountingPeriodId" FOR SHARE;
    IF v_status = 'Closed' THEN
      RAISE EXCEPTION 'Earned value of a closed period cannot change';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
