-- soften_pegs_for_return: a negative receipt on a grouped PO line takes the units back
-- from the excess, then from the Hard pegs latest first, and turns those pegs Soft.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/soften-pegs-for-return.test.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';

-- Soft pegs of 20, 30 and 10 on one supply, needed a week apart in that order.
CREATE FUNCTION pg_temp.peg_supply(
  p_company_id text, p_group_id text, p_item_id text, p_location_id text,
  p_supply_id text, p_projects text[], p_quantities numeric[]
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  FOR n IN 1..array_length(p_projects, 1) LOOP
    INSERT INTO "projectPeg" ("companyId", "planningGroupId", "itemId", "locationId",
        "supplyType", "supplyId", "projectId", "demandSourceType", "demandSourceId",
        quantity, "needDate", state, "createdByRunId", "createdBy")
      VALUES (p_company_id, p_group_id, p_item_id, p_location_id,
        'Purchase Order Line', p_supply_id, p_projects[n], 'Project Material', 'pem-' || n,
        p_quantities[n], DATE '2026-11-02' + 7 * (n - 1), 'Soft', 'run-1', 'system');
  END LOOP;
END;
$fn$;

-- "<project>:<quantity>:<hard|excess>" for every row the function returns, in order.
CREATE FUNCTION pg_temp.harden(p_company_id text, p_supply_id text, p_quantity numeric) RETURNS text
LANGUAGE sql AS $fn$
  SELECT string_agg(COALESCE(h."projectId", 'common') || ':' || h.quantity::text || ':'
           || CASE WHEN h."pegId" IS NULL THEN 'excess' ELSE 'hard' END, ',' ORDER BY h.n)
  FROM (
    SELECT r.*, row_number() OVER () AS n
    FROM harden_pegs_for_supply(p_company_id, 'system', 'Purchase Order Line', p_supply_id, p_quantity) r
  ) h;
$fn$;

-- "<project>:<quantity>:<peg|excess>" for every row a return gives, in order.
CREATE FUNCTION pg_temp.give_back(p_company_id text, p_supply_id text, p_quantity numeric, p_received numeric) RETURNS text
LANGUAGE sql AS $fn$
  SELECT string_agg(COALESCE(s."projectId", 'common') || ':' || s.quantity::text || ':'
           || CASE WHEN s."pegId" IS NULL THEN 'excess' ELSE 'peg' END, ',' ORDER BY s.n)
  FROM (
    SELECT r.*, row_number() OVER () AS n
    FROM soften_pegs_for_return(p_company_id, 'system', 'Purchase Order Line', p_supply_id, p_quantity, p_received) r
  ) s;
$fn$;

-- "<project>:<quantity>:<state>" for the supply's current pegs.
CREATE FUNCTION pg_temp.current_pegs(p_supply_id text) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE(string_agg("projectId" || ':' || quantity::text || ':' || state, ','
           ORDER BY state::text, "needDate", quantity), '')
  FROM "projectPeg" WHERE "supplyId" = p_supply_id AND "supersededAt" IS NULL;
$fn$;

DO $cases$
DECLARE
  v_group_id text; v_company_id text; v_location_id text; v_item_id text;
  v_plg text; v_plg_exception text;
  v_p1 text; v_p2 text; v_p3 text;
  v_result text; v_expected text;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Soften pegs test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Soften pegs test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
  INSERT INTO location (name, "addressLine1", city, "postalCode", "companyId", "createdBy", timezone)
    VALUES ('Plant', '1 Test Way', 'Testville', '00000', v_company_id, 'system', 'UTC') RETURNING id INTO v_location_id;
  INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
    VALUES ('EA', 'Each', v_company_id, 'system') ON CONFLICT DO NOTHING;
  INSERT INTO item ("readableId", name, type, "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
    VALUES ('ST-050', 'Lens', 'Part', 'Buy', 'Inventory', 'EA', v_company_id, 'system') RETURNING id INTO v_item_id;

  INSERT INTO "planningGroup" (name, "locationId", "companyId", "createdBy")
    VALUES ('Star Tracker', v_location_id, v_company_id, 'system') RETURNING id INTO v_plg;
  INSERT INTO project (name, identifier, "locationId", "projectStock", "planningGroupId", "companyId", "createdBy")
    VALUES ('P-101', 'PA', v_location_id, true, v_plg, v_company_id, 'system') RETURNING id INTO v_p1;
  INSERT INTO project (name, identifier, "locationId", "projectStock", "planningGroupId", "companyId", "createdBy")
    VALUES ('P-102', 'PB', v_location_id, true, v_plg, v_company_id, 'system') RETURNING id INTO v_p2;
  INSERT INTO project (name, identifier, "locationId", "projectStock", "planningGroupId", "companyId", "createdBy")
    VALUES ('P-103', 'PC', v_location_id, true, v_plg, v_company_id, 'system') RETURNING id INTO v_p3;

  -- (1) Received 60 against pegs of 20, 30 and 10. A return of 15 takes P-103's 10
  -- and 5 of P-102's 30, the reverse of the need order.
  PERFORM pg_temp.peg_supply(v_company_id, v_plg, v_item_id, v_location_id, 'pol-a',
    ARRAY[v_p1, v_p2, v_p3], ARRAY[20, 30, 10]::numeric[]);
  PERFORM harden_pegs_for_supply(v_company_id, 'system', 'Purchase Order Line', 'pol-a', 60);
  UPDATE "projectPeg" SET "itemLedgerId" = 'il-' || "projectId"
    WHERE "supplyId" = 'pol-a' AND "supersededAt" IS NULL AND state = 'Hard';
  v_result := pg_temp.give_back(v_company_id, 'pol-a', 15, 60);
  v_expected := v_p3 || ':10:peg,' || v_p2 || ':5:peg';
  ASSERT v_result = v_expected, 'A return of 15 must take 10 from P-103 and 5 from P-102, got: ' || COALESCE(v_result, 'nothing');
  ASSERT pg_temp.current_pegs('pol-a')
    = v_p1 || ':20:Hard,' || v_p2 || ':25:Hard,' || v_p2 || ':5:Soft,' || v_p3 || ':10:Soft',
    'A return of 15 must leave Hard 20 and 25 and Soft 5 and 10: ' || pg_temp.current_pegs('pol-a');
  ASSERT (SELECT "itemLedgerId" FROM "projectPeg" WHERE "supplyId" = 'pol-a' AND "supersededAt" IS NULL
            AND state = 'Hard' AND "projectId" = v_p2) = 'il-' || v_p2,
    'The Hard rest of a peg must keep its item ledger row';
  ASSERT (SELECT count(*) FROM "projectPeg" WHERE "supplyId" = 'pol-a' AND "supersededAt" IS NULL
            AND state = 'Soft' AND ("itemLedgerId" IS NOT NULL OR "hardenedAt" IS NOT NULL)) = 0,
    'A Soft row must carry no item ledger row and no hardenedAt';
  ASSERT (SELECT count(*) FROM "projectPeg" WHERE "supplyId" = 'pol-a' AND "supersededAt" IS NOT NULL AND state = 'Hard') = 2,
    'The 2 Hard pegs it took must be superseded, not updated';

  -- (2) Received 65: the 5 of excess (common stock) comes back first.
  PERFORM pg_temp.peg_supply(v_company_id, v_plg, v_item_id, v_location_id, 'pol-b',
    ARRAY[v_p1, v_p2, v_p3], ARRAY[20, 30, 10]::numeric[]);
  PERFORM harden_pegs_for_supply(v_company_id, 'system', 'Purchase Order Line', 'pol-b', 65);
  v_result := pg_temp.give_back(v_company_id, 'pol-b', 8, 65);
  v_expected := 'common:5:excess,' || v_p3 || ':3:peg';
  ASSERT v_result = v_expected, 'A return of 8 must take the excess of 5 first, got: ' || COALESCE(v_result, 'nothing');

  -- (3) Under the Exception Project rule the excess comes back from the exception project.
  INSERT INTO "planningGroup" (name, "locationId", "excessRule", "exceptionProjectId", "companyId", "createdBy")
    VALUES ('Optics', v_location_id, 'Exception Project', v_p3, v_company_id, 'system') RETURNING id INTO v_plg_exception;
  PERFORM pg_temp.peg_supply(v_company_id, v_plg_exception, v_item_id, v_location_id, 'pol-c',
    ARRAY[v_p1], ARRAY[10]::numeric[]);
  PERFORM harden_pegs_for_supply(v_company_id, 'system', 'Purchase Order Line', 'pol-c', 12);
  v_result := pg_temp.give_back(v_company_id, 'pol-c', 3, 12);
  v_expected := v_p3 || ':2:excess,' || v_p1 || ':1:peg';
  ASSERT v_result = v_expected, 'The excess must come back from the exception project, got: ' || COALESCE(v_result, 'nothing');

  -- (4) A return beyond every Hard peg takes the rest from the excess stripe.
  PERFORM pg_temp.peg_supply(v_company_id, v_plg, v_item_id, v_location_id, 'pol-d',
    ARRAY[v_p1], ARRAY[10]::numeric[]);
  PERFORM harden_pegs_for_supply(v_company_id, 'system', 'Purchase Order Line', 'pol-d', 10);
  v_result := pg_temp.give_back(v_company_id, 'pol-d', 12, 10);
  v_expected := v_p1 || ':10:peg,common:2:excess';
  ASSERT v_result = v_expected, 'A return beyond the pegs must end on the excess stripe, got: ' || COALESCE(v_result, 'nothing');
  ASSERT pg_temp.current_pegs('pol-d') = v_p1 || ':10:Soft',
    'A full return must leave the peg Soft: ' || pg_temp.current_pegs('pol-d');

  RAISE NOTICE 'ALL SOFTEN PEGS FOR RETURN CASES PASSED (Hard pegs latest first, excess first, exception project, return beyond the pegs)';
END;
$cases$;
ROLLBACK;
