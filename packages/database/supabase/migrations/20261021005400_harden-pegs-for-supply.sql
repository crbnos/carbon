-- Projects Phase 3: the one split rule of a grouped receipt or job completion.
--
-- A grouped PO line receipt (post-receipt) and a grouped job completion
-- (complete_job_to_inventory) both call this function. It is the only code
-- that turns a Soft peg Hard:
-- 1. Lock the current Soft and Manual pegs of the supply, in need order.
-- 2. Take each peg from p_quantity until the quantity is used up.
-- 3. Supersede each peg it takes. Insert a Hard row for the covered part and,
--    when the peg is covered in part, a row for the rest in the peg's state.
-- 4. Return one row per Hard row ("projectId", "quantity", "pegId").
-- 5. Return the quantity left after every peg as one more row, with "pegId"
--    NULL and "projectId" = the group's exception project, or NULL (common
--    stock) under the Common Stock rule.
-- The caller writes the ledger rows from the returned rows.
CREATE OR REPLACE FUNCTION harden_pegs_for_supply(
  p_company_id TEXT,
  p_user_id TEXT,
  p_supply_type "projectPegSupplyType",
  p_supply_id TEXT,
  p_quantity NUMERIC
) RETURNS TABLE ("projectId" TEXT, "quantity" NUMERIC, "pegId" TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_remaining NUMERIC := COALESCE(p_quantity, 0);
  v_peg RECORD;
  v_take NUMERIC;
  v_hard_id TEXT;
  v_group_id TEXT;
  v_excess_rule "planningGroupExcessRule";
  v_exception_project_id TEXT;
BEGIN
  PERFORM assert_company_access(p_company_id);

  IF v_remaining <= 0 THEN
    RETURN;
  END IF;

  FOR v_peg IN
    SELECT pp.*
    FROM "projectPeg" pp
    LEFT JOIN "project" p
      ON p."id" = pp."projectId" AND p."companyId" = pp."companyId"
    WHERE pp."companyId" = p_company_id
      AND pp."supplyType" = p_supply_type
      AND pp."supplyId" = p_supply_id
      AND pp."supersededAt" IS NULL
      AND pp."state" IN ('Soft', 'Manual')
    ORDER BY pp."needDate" NULLS LAST, p."planningPriority", pp."demandSourceId", pp."id"
    FOR UPDATE OF pp
  LOOP
    v_group_id := v_peg."planningGroupId";
    EXIT WHEN v_remaining <= 0;

    v_take := LEAST(v_peg."quantity", v_remaining);
    v_remaining := v_remaining - v_take;

    UPDATE "projectPeg"
    SET "supersededAt" = now()
    WHERE "id" = v_peg."id" AND "companyId" = p_company_id;

    INSERT INTO "projectPeg" (
      "companyId", "planningGroupId", "itemId", "locationId", "supplyType", "supplyId",
      "projectId", "projectElementId", "demandSourceType", "demandSourceId", "parentPegId",
      "quantity", "needDate", "state", "hardenedAt", "createdByRunId", "createdBy"
    ) VALUES (
      p_company_id, v_peg."planningGroupId", v_peg."itemId", v_peg."locationId",
      v_peg."supplyType", v_peg."supplyId", v_peg."projectId", v_peg."projectElementId",
      v_peg."demandSourceType", v_peg."demandSourceId", v_peg."parentPegId",
      v_take, v_peg."needDate", 'Hard', now(), v_peg."createdByRunId", p_user_id
    )
    RETURNING "id" INTO v_hard_id;

    -- The uncovered part keeps the peg's state: a Manual override stays a
    -- Manual override with its reason.
    IF v_take < v_peg."quantity" THEN
      INSERT INTO "projectPeg" (
        "companyId", "planningGroupId", "itemId", "locationId", "supplyType", "supplyId",
        "projectId", "projectElementId", "demandSourceType", "demandSourceId", "parentPegId",
        "quantity", "needDate", "state", "manualReason", "createdByRunId", "createdBy"
      ) VALUES (
        p_company_id, v_peg."planningGroupId", v_peg."itemId", v_peg."locationId",
        v_peg."supplyType", v_peg."supplyId", v_peg."projectId", v_peg."projectElementId",
        v_peg."demandSourceType", v_peg."demandSourceId", v_peg."parentPegId",
        v_peg."quantity" - v_take, v_peg."needDate", v_peg."state", v_peg."manualReason",
        v_peg."createdByRunId", p_user_id
      );
    END IF;

    "projectId" := v_peg."projectId";
    "quantity" := v_take;
    "pegId" := v_hard_id;
    RETURN NEXT;
  END LOOP;

  IF v_remaining > 0 THEN
    IF v_group_id IS NULL THEN
      IF p_supply_type = 'Purchase Order Line' THEN
        SELECT pol."planningGroupId" INTO v_group_id
        FROM "purchaseOrderLine" pol
        WHERE pol."id" = p_supply_id AND pol."companyId" = p_company_id;
      ELSIF p_supply_type = 'Job' THEN
        SELECT j."planningGroupId" INTO v_group_id
        FROM "job" j
        WHERE j."id" = p_supply_id AND j."companyId" = p_company_id;
      END IF;
    END IF;

    SELECT g."excessRule", g."exceptionProjectId"
    INTO v_excess_rule, v_exception_project_id
    FROM "planningGroup" g
    WHERE g."id" = v_group_id AND g."companyId" = p_company_id;

    "projectId" := CASE
      WHEN v_excess_rule = 'Exception Project' THEN v_exception_project_id
      ELSE NULL
    END;
    "quantity" := v_remaining;
    "pegId" := NULL;
    RETURN NEXT;
  END IF;
END;
$$;
