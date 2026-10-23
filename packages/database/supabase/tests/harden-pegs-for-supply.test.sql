-- harden_pegs_for_supply: the one split rule of a grouped receipt or job completion.
-- Isolated fixture company; no existing business data is read or edited. Always rolls back.
-- Run: pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -f packages/database/supabase/tests/harden-pegs-for-supply.test.sql
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
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Harden pegs test', 'system') RETURNING id INTO v_group_id;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Harden pegs test', v_group_id, 'USD', 'UTC') RETURNING id INTO v_company_id;
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

  -- (1) A receipt of 60 against pegs of 20, 30 and 10 hardens all 3.
  PERFORM pg_temp.peg_supply(v_company_id, v_plg, v_item_id, v_location_id, 'pol-a',
    ARRAY[v_p1, v_p2, v_p3], ARRAY[20, 30, 10]::numeric[]);
  v_result := pg_temp.harden(v_company_id, 'pol-a', 60);
  v_expected := v_p1 || ':20:hard,' || v_p2 || ':30:hard,' || v_p3 || ':10:hard';
  ASSERT v_result = v_expected, 'A receipt of 60 must return 3 Hard rows, got: ' || COALESCE(v_result, 'nothing');
  ASSERT pg_temp.current_pegs('pol-a') = v_p1 || ':20:Hard,' || v_p2 || ':30:Hard,' || v_p3 || ':10:Hard',
    'A receipt of 60 must leave 3 Hard pegs and no Soft peg: ' || pg_temp.current_pegs('pol-a');
  ASSERT (SELECT count(*) FROM "projectPeg" WHERE "supplyId" = 'pol-a' AND "supersededAt" IS NOT NULL AND state = 'Soft') = 3,
    'The 3 Soft pegs must be superseded, not updated';
  ASSERT (SELECT count(*) FROM "projectPeg" WHERE "supplyId" = 'pol-a' AND state = 'Hard' AND "hardenedAt" IS NOT NULL
            AND "createdByRunId" = 'run-1') = 3,
    'Each Hard row must carry hardenedAt and the run that pegged it';

  -- (2) A receipt of 25 covers P-101 in full and P-102 in part.
  PERFORM pg_temp.peg_supply(v_company_id, v_plg, v_item_id, v_location_id, 'pol-b',
    ARRAY[v_p1, v_p2, v_p3], ARRAY[20, 30, 10]::numeric[]);
  v_result := pg_temp.harden(v_company_id, 'pol-b', 25);
  v_expected := v_p1 || ':20:hard,' || v_p2 || ':5:hard';
  ASSERT v_result = v_expected, 'A receipt of 25 must return 20 and 5, got: ' || COALESCE(v_result, 'nothing');
  ASSERT pg_temp.current_pegs('pol-b')
    = v_p1 || ':20:Hard,' || v_p2 || ':5:Hard,' || v_p2 || ':25:Soft,' || v_p3 || ':10:Soft',
    'A receipt of 25 must leave Soft rows of 25 and 10: ' || pg_temp.current_pegs('pol-b');

  -- (3) A receipt of 65 hardens all 3 and returns the excess last, to common stock.
  PERFORM pg_temp.peg_supply(v_company_id, v_plg, v_item_id, v_location_id, 'pol-c',
    ARRAY[v_p1, v_p2, v_p3], ARRAY[20, 30, 10]::numeric[]);
  v_result := pg_temp.harden(v_company_id, 'pol-c', 65);
  v_expected := v_p1 || ':20:hard,' || v_p2 || ':30:hard,' || v_p3 || ':10:hard,common:5:excess';
  ASSERT v_result = v_expected, 'A receipt of 65 must return 4 rows with the excess last, got: ' || COALESCE(v_result, 'nothing');

  -- Under the Exception Project rule the excess goes to the exception project.
  INSERT INTO "planningGroup" (name, "locationId", "excessRule", "exceptionProjectId", "companyId", "createdBy")
    VALUES ('Optics', v_location_id, 'Exception Project', v_p3, v_company_id, 'system') RETURNING id INTO v_plg_exception;
  PERFORM pg_temp.peg_supply(v_company_id, v_plg_exception, v_item_id, v_location_id, 'pol-d',
    ARRAY[v_p1], ARRAY[10]::numeric[]);
  v_result := pg_temp.harden(v_company_id, 'pol-d', 12);
  v_expected := v_p1 || ':10:hard,' || v_p3 || ':2:excess';
  ASSERT v_result = v_expected, 'The excess must go to the exception project, got: ' || COALESCE(v_result, 'nothing');

  -- A Hard peg is never taken again: a second receipt on pol-a is all excess.
  v_result := pg_temp.harden(v_company_id, 'pol-a', 4);
  ASSERT v_result = 'common:4:excess', 'A Hard peg must not harden twice, got: ' || COALESCE(v_result, 'nothing');

  RAISE NOTICE 'ALL HARDEN PEGS FOR SUPPLY CASES PASSED (full receipt, partial receipt, excess to common stock, excess to the exception project, Hard pegs never re-taken)';
END;
$cases$;
ROLLBACK;
