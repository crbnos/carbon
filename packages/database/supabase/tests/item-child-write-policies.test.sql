-- No RLS policy recurses, and item children that item's SELECT reads back
-- (supplierPart, customerPartToItem) can be written by whoever holds the
-- item's page, and by no one else.
-- Run from the repository root against an existing local database:
-- pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/item-child-write-policies.test.sql
-- All fixtures and role changes are confined to the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL "app.sync_in_progress" = 'true';
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION pg_temp.act_as(user_id text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.path', '/test', true);
END;
$fn$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- Postgres expands a table's policies when it plans a statement, and refuses a
-- policy that reaches its own table again. EXPLAIN plans without running, so
-- this asks every table, for every command, whether its policies recurse.
DO $recursion$
DECLARE
  t record;
  statement text;
  recursive text[] := '{}';
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOR t IN
    SELECT c.relname,
      (SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attgenerated = '' AND a.attidentity = ''
        ORDER BY a.attnum LIMIT 1) AS col
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    FOREACH statement IN ARRAY ARRAY[
      format('EXPLAIN SELECT * FROM public.%I', t.relname),
      format('EXPLAIN INSERT INTO public.%I DEFAULT VALUES', t.relname),
      format('EXPLAIN UPDATE public.%I SET %I = %I', t.relname, t.col, t.col),
      format('EXPLAIN DELETE FROM public.%I', t.relname)
    ] LOOP
      BEGIN
        EXECUTE statement;
      EXCEPTION
        WHEN invalid_object_definition THEN
          recursive := recursive || (split_part(statement, ' ', 2) || ' ' || t.relname || ': ' || SQLERRM);
        WHEN insufficient_privilege THEN
          NULL; -- the API role has no grant for this command on this table
      END;
    END LOOP;
  END LOOP;
  EXECUTE 'RESET ROLE';
  IF cardinality(recursive) > 0 THEN
    RAISE EXCEPTION 'policies recurse: %', array_to_string(recursive, '; ');
  END IF;
END
$recursion$;

DO $proof$
DECLARE
  grp text; company_a text; company_b text;
  parts text := gen_random_uuid()::text;      -- Full on the whole Items module
  materials text := gen_random_uuid()::text;  -- Full on Materials only
  plain text := gen_random_uuid()::text;      -- an employee with no rights
  other text := gen_random_uuid()::text;      -- Full on Items, in company B
  part text; material text; supplier_a text; customer_a text;
  supplier_new text;      -- a supplier the item has no part from yet: a write that is let in adds one
  supplier_refused text;  -- the same, for the writes that must be refused
  part_sp text; material_sp text; part_cp text;
  n int;
BEGIN
  INSERT INTO "companyGroup" (name, "createdBy") VALUES ('Item children ' || id(), 'system') RETURNING id INTO grp;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Item children A', grp, 'USD', 'America/New_York') RETURNING id INTO company_a;
  INSERT INTO company (name, "companyGroupId", "baseCurrencyCode", timezone)
    VALUES ('Item children B', grp, 'USD', 'America/New_York') RETURNING id INTO company_b;
  INSERT INTO "user" (id, email) VALUES
    (parts, parts || '@authz.invalid'), (materials, materials || '@authz.invalid'),
    (plain, plain || '@authz.invalid'), (other, other || '@authz.invalid');
  INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
    (parts, company_a, 'employee'), (materials, company_a, 'employee'),
    (plain, company_a, 'employee'), (other, company_b, 'employee');
  INSERT INTO permission ("companyId", "userId", module, page, level, "createdBy") VALUES
    (company_a, parts, 'Parts', NULL, 'Full', 'system'),
    (company_a, materials, 'Parts', 'parts.materials', 'Full', 'system'),
    (company_b, other, 'Parts', NULL, 'Full', 'system');

  INSERT INTO item ("readableId", name, type, "itemTrackingType", "companyId", "createdBy")
    VALUES ('IC-PART', 'Item children part', 'Part', 'Inventory', company_a, 'system') RETURNING id INTO part;
  INSERT INTO item ("readableId", name, type, "itemTrackingType", "companyId", "createdBy")
    VALUES ('IC-MAT', 'Item children material', 'Material', 'Inventory', company_a, 'system') RETURNING id INTO material;
  INSERT INTO supplier ("readableId", name, "companyId", "createdBy") VALUES ('IC-SUP', 'Item children supplier', company_a, 'system') RETURNING id INTO supplier_a;
  INSERT INTO supplier ("readableId", name, "companyId", "createdBy") VALUES ('IC-SUP2', 'Item children new supplier', company_a, 'system') RETURNING id INTO supplier_new;
  INSERT INTO supplier ("readableId", name, "companyId", "createdBy") VALUES ('IC-SUP3', 'Item children refused supplier', company_a, 'system') RETURNING id INTO supplier_refused;
  INSERT INTO customer ("readableId", name, "companyId", "createdBy") VALUES ('IC-CUS', 'Item children customer', company_a, 'system') RETURNING id INTO customer_a;
  INSERT INTO "supplierPart" ("itemId", "supplierId", "companyId", "createdBy")
    VALUES (part, supplier_a, company_a, 'system') RETURNING id INTO part_sp;
  INSERT INTO "supplierPart" ("itemId", "supplierId", "companyId", "createdBy")
    VALUES (material, supplier_a, company_a, 'system') RETURNING id INTO material_sp;

  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Full on Items: every write on both tables, on a part.
  PERFORM pg_temp.act_as(parts);
  IF get_item_type(part, company_a) IS DISTINCT FROM 'Part' THEN
    RAISE EXCEPTION 'get_item_type must read an item of the caller''s company';
  END IF;
  INSERT INTO "supplierPart" ("itemId", "supplierId", "companyId", "supplierPartId", "createdBy")
    VALUES (part, supplier_new, company_a, 'SP-NEW', parts);
  UPDATE "supplierPart" SET "supplierPartId" = 'SP-1' WHERE id = part_sp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'parts_update must update a part''s supplier part, updated %', n; END IF;
  INSERT INTO "customerPartToItem" ("customerId", "customerPartId", "itemId", "companyId")
    VALUES (customer_a, 'CP-1', part, company_a) RETURNING id INTO part_cp;
  UPDATE "customerPartToItem" SET "customerPartId" = 'CP-2' WHERE id = part_cp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'parts_update must update a part''s customer part number, updated %', n; END IF;
  DELETE FROM "customerPartToItem" WHERE id = part_cp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'parts_delete must delete a part''s customer part number, deleted %', n; END IF;

  -- Full on Materials only: the item's type decides.
  PERFORM pg_temp.act_as(materials);
  UPDATE "supplierPart" SET "supplierPartId" = 'SP-2' WHERE id = part_sp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'materials rights must not update a part''s supplier part, updated %', n; END IF;
  UPDATE "supplierPart" SET "supplierPartId" = 'SP-3' WHERE id = material_sp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'materials rights must update a material''s supplier part, updated %', n; END IF;
  BEGIN
    INSERT INTO "supplierPart" ("itemId", "supplierId", "companyId", "createdBy")
      VALUES (part, supplier_refused, company_a, materials);
    RAISE EXCEPTION 'materials rights must not add a supplier part to a part';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM "supplierPart" WHERE id = material_sp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'materials rights must delete a material''s supplier part, deleted %', n; END IF;

  -- No rights: nothing.
  PERFORM pg_temp.act_as(plain);
  UPDATE "supplierPart" SET "supplierPartId" = 'SP-4' WHERE id = part_sp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'an employee with no rights must not update a supplier part, updated %', n; END IF;
  BEGIN
    INSERT INTO "customerPartToItem" ("customerId", "customerPartId", "itemId", "companyId")
      VALUES (customer_a, 'CP-3', part, company_a);
    RAISE EXCEPTION 'an employee with no rights must not add a customer part number';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Another company: the lookup answers nothing, and nothing is written.
  PERFORM pg_temp.act_as(other);
  IF get_item_type(part, company_a) IS NOT NULL OR get_item_type(part, company_b) IS NOT NULL THEN
    RAISE EXCEPTION 'get_item_type must not read another company''s item';
  END IF;
  DELETE FROM "supplierPart" WHERE id = part_sp;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'another company''s employee must not delete a supplier part, deleted %', n; END IF;
  BEGIN
    INSERT INTO "supplierPart" ("itemId", "supplierId", "companyId", "createdBy")
      VALUES (part, supplier_refused, company_a, other);
    RAISE EXCEPTION 'another company''s employee must not add a supplier part';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  EXECUTE 'RESET ROLE';
END
$proof$;

ROLLBACK;
