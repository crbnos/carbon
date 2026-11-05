-- Projects Phase 3: the reverse of harden_pegs_for_supply, for a negative
-- receipt on a grouped PO line.
--
-- A grouped receipt split its units into member stripes: the Hard pegs in need
-- order, then the excess. A return takes the units back in the reverse order:
-- 1. The excess first: what the supply received beyond its current Hard pegs
--    (p_received_quantity minus the Hard total). It returns from the group's
--    excess stripe (the exception project, or NULL for common stock).
-- 2. Then the current Hard pegs of the supply, latest first: hardenedAt
--    descending, then the reverse of the harden order.
-- 3. Each Hard peg it takes is superseded. A Soft row replaces the returned
--    part, so the next MRP run can re-peg the open supply. When the peg is
--    returned in part, a Hard row keeps the rest, with its hardenedAt and
--    itemLedgerId.
-- 4. Quantity left after every Hard peg returns from the excess stripe too.
-- It returns one row per stripe ("projectId", "quantity", "pegId"); "pegId" is
-- the Hard peg it took, NULL for the excess. The caller writes the ledger rows.
CREATE OR REPLACE FUNCTION soften_pegs_for_return(
  p_company_id TEXT,
  p_user_id TEXT,
  p_supply_type "projectPegSupplyType",
  p_supply_id TEXT,
  p_quantity NUMERIC,
  p_received_quantity NUMERIC
) RETURNS TABLE ("projectId" TEXT, "quantity" NUMERIC, "pegId" TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_remaining NUMERIC := COALESCE(p_quantity, 0);
  v_hard_total NUMERIC;
  v_excess NUMERIC;
  v_take NUMERIC;
  v_peg RECORD;
  v_group_id TEXT;
  v_excess_project_id TEXT;
  v_excess_rule "planningGroupExcessRule";
  v_exception_project_id TEXT;
BEGIN
  PERFORM assert_company_access(p_company_id);

  IF v_remaining <= 0 THEN
    RETURN;
  END IF;

  IF p_supply_type = 'Purchase Order Line' THEN
    SELECT pol."planningGroupId" INTO v_group_id
    FROM "purchaseOrderLine" pol
    WHERE pol."id" = p_supply_id AND pol."companyId" = p_company_id;
  ELSIF p_supply_type = 'Job' THEN
    SELECT j."planningGroupId" INTO v_group_id
    FROM "job" j
    WHERE j."id" = p_supply_id AND j."companyId" = p_company_id;
  END IF;

  IF v_group_id IS NULL THEN
    SELECT pp."planningGroupId" INTO v_group_id
    FROM "projectPeg" pp
    WHERE pp."companyId" = p_company_id
      AND pp."supplyType" = p_supply_type
      AND pp."supplyId" = p_supply_id
    LIMIT 1;
  END IF;

  SELECT g."excessRule", g."exceptionProjectId"
  INTO v_excess_rule, v_exception_project_id
  FROM "planningGroup" g
  WHERE g."id" = v_group_id AND g."companyId" = p_company_id;

  v_excess_project_id := CASE
    WHEN v_excess_rule = 'Exception Project' THEN v_exception_project_id
    ELSE NULL
  END;

  SELECT COALESCE(SUM(pp."quantity"), 0) INTO v_hard_total
  FROM "projectPeg" pp
  WHERE pp."companyId" = p_company_id
    AND pp."supplyType" = p_supply_type
    AND pp."supplyId" = p_supply_id
    AND pp."supersededAt" IS NULL
    AND pp."state" = 'Hard';

  -- 1. The excess went out last, so it comes back first.
  v_excess := GREATEST(COALESCE(p_received_quantity, 0) - v_hard_total, 0);
  IF v_excess > 0 THEN
    v_take := LEAST(v_excess, v_remaining);
    v_remaining := v_remaining - v_take;
    "projectId" := v_excess_project_id;
    "quantity" := v_take;
    "pegId" := NULL;
    RETURN NEXT;
  END IF;

  -- 2. The Hard pegs, latest first.
  IF v_remaining > 0 THEN
    FOR v_peg IN
      SELECT pp.*
      FROM "projectPeg" pp
      LEFT JOIN "project" p
        ON p."id" = pp."projectId" AND p."companyId" = pp."companyId"
      WHERE pp."companyId" = p_company_id
        AND pp."supplyType" = p_supply_type
        AND pp."supplyId" = p_supply_id
        AND pp."supersededAt" IS NULL
        AND pp."state" = 'Hard'
      ORDER BY pp."hardenedAt" DESC NULLS LAST,
        pp."needDate" DESC NULLS FIRST,
        p."planningPriority" DESC NULLS LAST,
        pp."demandSourceId" DESC,
        pp."id" DESC
      FOR UPDATE OF pp
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_take := LEAST(v_peg."quantity", v_remaining);
      v_remaining := v_remaining - v_take;

      UPDATE "projectPeg"
      SET "supersededAt" = now()
      WHERE "id" = v_peg."id" AND "companyId" = p_company_id;

      -- 3. The returned part is open supply again.
      INSERT INTO "projectPeg" (
        "companyId", "planningGroupId", "itemId", "locationId", "supplyType", "supplyId",
        "projectId", "projectElementId", "demandSourceType", "demandSourceId", "parentPegId",
        "quantity", "needDate", "state", "createdByRunId", "createdBy"
      ) VALUES (
        p_company_id, v_peg."planningGroupId", v_peg."itemId", v_peg."locationId",
        v_peg."supplyType", v_peg."supplyId", v_peg."projectId", v_peg."projectElementId",
        v_peg."demandSourceType", v_peg."demandSourceId", v_peg."parentPegId",
        v_take, v_peg."needDate", 'Soft', v_peg."createdByRunId", p_user_id
      );

      IF v_take < v_peg."quantity" THEN
        INSERT INTO "projectPeg" (
          "companyId", "planningGroupId", "itemId", "locationId", "supplyType", "supplyId",
          "projectId", "projectElementId", "demandSourceType", "demandSourceId", "parentPegId",
          "quantity", "needDate", "state", "hardenedAt", "itemLedgerId", "createdByRunId",
          "createdBy"
        ) VALUES (
          p_company_id, v_peg."planningGroupId", v_peg."itemId", v_peg."locationId",
          v_peg."supplyType", v_peg."supplyId", v_peg."projectId", v_peg."projectElementId",
          v_peg."demandSourceType", v_peg."demandSourceId", v_peg."parentPegId",
          v_peg."quantity" - v_take, v_peg."needDate", 'Hard', v_peg."hardenedAt",
          v_peg."itemLedgerId", v_peg."createdByRunId", p_user_id
        );
      END IF;

      "projectId" := v_peg."projectId";
      "quantity" := v_take;
      "pegId" := v_peg."id";
      RETURN NEXT;
    END LOOP;
  END IF;

  -- 4. More returned than the pegs and the excess hold.
  IF v_remaining > 0 THEN
    "projectId" := v_excess_project_id;
    "quantity" := v_remaining;
    "pegId" := NULL;
    RETURN NEXT;
  END IF;
END;
$$;
