-- A step record's index names a unit in the full make-method axis. Both the
-- record and its best-effort material posting must serialize with Quality.
CREATE FUNCTION util.lock_step_record_unit(
  p_company_id text, p_step_id text, p_index integer,
  p_operation_id text DEFAULT NULL, p_unit_id text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE
  v_method text;
  v_serial boolean;
  v_unit text;
  v_issue text;
BEGIN
  SELECT op."jobMakeMethodId", method."requiresSerialTracking" AND cs."holdUnitsWithOpenIssues"
  INTO STRICT v_method, v_serial
  FROM "jobOperationStep" step
  JOIN "jobOperation" op ON op.id = step."operationId" AND op."companyId" = step."companyId"
  LEFT JOIN "jobMakeMethod" method ON method.id = op."jobMakeMethodId" AND method."companyId" = op."companyId"
  LEFT JOIN "companySettings" cs ON cs.id = op."companyId"
  WHERE step.id = p_step_id AND step."companyId" = p_company_id
    AND (p_operation_id IS NULL OR op.id = p_operation_id);
  IF v_serial IS NOT TRUE THEN RETURN; END IF;

  -- Lock only this unit. OFFSET on a locking SELECT would lock its predecessors.
  SELECT u.id INTO v_unit FROM "trackedEntity" u
  WHERE u."companyId" = p_company_id AND u.id = (
    SELECT te.id FROM "trackedEntity" te
    WHERE te."companyId" = p_company_id AND te.attributes->>'Job Make Method' = v_method
    ORDER BY te."createdAt", te."readableId" NULLS LAST, te.id LIMIT 1 OFFSET p_index
  ) FOR UPDATE;
  IF v_unit IS NULL OR (p_unit_id IS NOT NULL AND v_unit <> p_unit_id) THEN
    RAISE EXCEPTION 'The serial for this step changed. Reopen the operation and select the unit.';
  END IF;
  -- An in-flight NCR link takes a foreign-key lock on this unit. Read in a
  -- new statement after the lock wait so a committed link is visible.
  SELECT h."issueNumber" INTO v_issue FROM "unitQualityHold" h
    WHERE h."companyId" = p_company_id AND h."trackedEntityId" = v_unit
    ORDER BY h."issueNumber" LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'This unit is on hold for issue %', v_issue; END IF;
END;
$$;

CREATE FUNCTION util.guard_step_record_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM assert_company_access(NEW."companyId");
  PERFORM util.lock_step_record_unit(NEW."companyId", NEW."jobOperationStepId", NEW.index);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "jobOperationStepRecord_quality_hold"
BEFORE INSERT OR UPDATE ON "jobOperationStepRecord"
FOR EACH ROW EXECUTE FUNCTION util.guard_step_record_unit();

-- A new link acquires a foreign-key lock on the serial. Reopening an existing
-- NCR reuses its links, so acquire that same lock before its hold takes effect.
CREATE FUNCTION util.lock_reopened_issue_units() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM assert_company_access(NEW."companyId");
  IF EXISTS (SELECT 1 FROM "companySettings" WHERE id = NEW."companyId" AND "holdUnitsWithOpenIssues") THEN
    PERFORM u.id FROM "trackedEntity" u
      JOIN "jobMakeMethod" method ON method.id = u.attributes->>'Job Make Method'
        AND method."companyId" = u."companyId" AND method."requiresSerialTracking"
      WHERE u."companyId" = NEW."companyId" AND u.id IN (
        SELECT "trackedEntityId" FROM "nonConformanceTrackedEntity"
        WHERE "companyId" = NEW."companyId" AND "nonConformanceId" = NEW.id
        UNION ALL
        SELECT "trackedEntityId" FROM "nonConformanceItemTrackedEntity"
        WHERE "companyId" = NEW."companyId" AND "nonConformanceId" = NEW.id
      ) ORDER BY u.id FOR KEY SHARE OF u;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "nonConformance_reopen_unit_hold"
BEFORE UPDATE OF status ON "nonConformance"
FOR EACH ROW WHEN (OLD.status = 'Closed' AND NEW.status <> 'Closed')
EXECUTE FUNCTION util.lock_reopened_issue_units();
