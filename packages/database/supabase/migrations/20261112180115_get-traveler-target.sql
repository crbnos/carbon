-- The traveler scan (.ai/specs/2026-11-12-serial-traveler-line-flow.md, S3).
-- From the scanned unit, follow Consume edges (input = unit, output = parent)
-- while the unit is Consumed. At each step take the newest Consume edge for
-- which no later Unconsume gives the unit back from that parent (input =
-- parent, output = unit). Stop at a unit that is not Consumed, at a unit with
-- no such edge, or after 20 steps, and return that unit. No row when the
-- scanned unit is not in the company. SECURITY INVOKER: the caller's RLS applies.

CREATE OR REPLACE FUNCTION get_traveler_target(
  p_tracked_entity_id TEXT,
  p_company_id TEXT
)
RETURNS TABLE (
  "trackedEntityId" TEXT,
  "status" "trackedEntityStatus",
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "itemId" TEXT,
  "depth" INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_id TEXT;
  v_status "trackedEntityStatus";
  v_attributes JSONB;
  v_item_id TEXT;
  v_depth INTEGER := 0;
  v_parent_id TEXT;
  v_next_id TEXT;
  v_next_status "trackedEntityStatus";
  v_next_attributes JSONB;
  v_next_item_id TEXT;
BEGIN
  SELECT te."id", te."status", te."attributes", te."itemId"
  INTO v_id, v_status, v_attributes, v_item_id
  FROM "trackedEntity" te
  WHERE te."id" = p_tracked_entity_id
    AND te."companyId" = p_company_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  WHILE v_status = 'Consumed' AND v_depth < 20 LOOP
    SELECT tao."trackedEntityId"
    INTO v_parent_id
    FROM "trackedActivityInput" tai
    INNER JOIN "trackedActivity" ta
      ON ta."id" = tai."trackedActivityId"
      AND ta."companyId" = p_company_id
      AND ta."type" = 'Consume'
    INNER JOIN "trackedActivityOutput" tao
      ON tao."trackedActivityId" = ta."id"
      AND tao."companyId" = p_company_id
      AND tao."trackedEntityId" <> v_id
    WHERE tai."trackedEntityId" = v_id
      AND tai."companyId" = p_company_id
      AND NOT EXISTS (
        SELECT 1
        FROM "trackedActivityInput" uin
        INNER JOIN "trackedActivity" ua
          ON ua."id" = uin."trackedActivityId"
          AND ua."companyId" = p_company_id
          AND ua."type" = 'Unconsume'
          AND ua."createdAt" > ta."createdAt"
        INNER JOIN "trackedActivityOutput" uout
          ON uout."trackedActivityId" = ua."id"
          AND uout."companyId" = p_company_id
          AND uout."trackedEntityId" = v_id
        WHERE uin."trackedEntityId" = tao."trackedEntityId"
          AND uin."companyId" = p_company_id
      )
    ORDER BY ta."createdAt" DESC, ta."id" DESC
    LIMIT 1;

    -- SELECT INTO sets NULL when no edge is found.
    EXIT WHEN v_parent_id IS NULL;

    SELECT te."id", te."status", te."attributes", te."itemId"
    INTO v_next_id, v_next_status, v_next_attributes, v_next_item_id
    FROM "trackedEntity" te
    WHERE te."id" = v_parent_id
      AND te."companyId" = p_company_id;

    EXIT WHEN NOT FOUND;

    v_id := v_next_id;
    v_status := v_next_status;
    v_attributes := v_next_attributes;
    v_item_id := v_next_item_id;
    v_depth := v_depth + 1;
  END LOOP;

  RETURN QUERY
  SELECT
    v_id,
    v_status,
    v_attributes->>'Job',
    v_attributes->>'Job Make Method',
    v_item_id,
    v_depth;
END;
$$;
