-- Prohibit deleting a unit of measure that is still referenced anywhere.
--
-- The 23 foreign keys to "unitOfMeasure"("code","companyId") disagree about
-- ON DELETE: six CASCADE (purchaseOrderLine x2, purchaseInvoiceLine x2,
-- salesOrderLine, kanban), four SET NULL, thirteen RESTRICT. So deleting a code
-- that had only ever reached the CASCADE tables silently deleted those order,
-- invoice and kanban rows with it. Ten further UoM columns carry no FK at all
-- (salesInvoiceLine, receiptLine, shipmentLine, supplierPart, the three
-- *OperationStep tables, both maintenance item tables, workCenterReplacementPart),
-- so they never blocked anything and were left pointing at a code that no longer
-- existed.
--
-- One BEFORE DELETE guard covers every case, FK or not. The FK actions are
-- deliberately left as they are: the CASCADEs exist so that deleting a company
-- still works (20250430131239_delete-company-2.sql), and this guard returns early
-- on that path exactly as protect_system_required_actions does
-- (20260321002430_delete-company-fix.sql).
--
-- Company restore/import are unaffected. They wipe in reverse topological order
-- under session_replication_role='replica' where the role allows it, which
-- disables user triggers outright; and because "unitOfMeasure" references only
-- "company" it sorts first and is therefore wiped last — after every table that
-- points at it — so the guard is a no-op in non-replica mode too.

CREATE SCHEMA IF NOT EXISTS util;

-- Every base-table column that stores a unitOfMeasure."code", read from the
-- catalog rather than hard-coded, so a table added later is covered without
-- another migration. Views are excluded (they mirror their base tables), as is
-- "unitOfMeasure" itself. A referencing table must be company-scoped, since the
-- code is only unique per company.
CREATE OR REPLACE FUNCTION util.unit_of_measure_referencing_columns()
RETURNS TABLE ("tableName" TEXT, "columnNames" TEXT[])
LANGUAGE sql
STABLE
AS $$
  SELECT c.table_name::TEXT, array_agg(c.column_name::TEXT ORDER BY c.column_name)
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema
   AND t.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND c.table_name <> 'unitOfMeasure'
    AND c.column_name ILIKE '%unitofmeasure%'
    AND c.data_type IN ('text', 'character varying')
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns cc
      WHERE cc.table_schema = c.table_schema
        AND cc.table_name = c.table_name
        AND cc.column_name = 'companyId'
    )
  GROUP BY c.table_name
  ORDER BY c.table_name;
$$;

-- Rows per table that use this code. A table with two UoM columns
-- (purchaseOrderLine, purchaseInvoiceLine, supplierQuoteLine, purchasingRfqLine)
-- ORs them so one row is counted once, not twice. Tables with no matching rows
-- are omitted, so "returns nothing" means "not in use".
CREATE OR REPLACE FUNCTION util.unit_of_measure_usage(
  p_code TEXT,
  p_company_id TEXT
)
RETURNS TABLE ("tableName" TEXT, "count" BIGINT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ref RECORD;
  predicate TEXT;
  matches BIGINT;
BEGIN
  IF p_code IS NULL OR p_company_id IS NULL THEN
    RETURN;
  END IF;

  FOR ref IN SELECT * FROM util.unit_of_measure_referencing_columns() LOOP
    SELECT string_agg(format('%I = $1', col), ' OR ')
    INTO predicate
    FROM unnest(ref."columnNames") AS col;

    EXECUTE format(
      'SELECT count(*) FROM %I WHERE "companyId" = $2 AND (%s)',
      ref."tableName",
      predicate
    )
    INTO matches
    USING p_code, p_company_id;

    IF matches > 0 THEN
      "tableName" := ref."tableName";
      "count" := matches;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- Where a unit of measure is used, for the delete confirmation. SECURITY DEFINER
-- because the answer must not depend on which modules the caller can read: a user
-- with only purchasing access still needs to be told the code is on a sales order.
-- Takes the id rather than a (code, companyId) pair so there is no cross-tenant
-- surface — the company is resolved from the row and then authorized.
CREATE OR REPLACE FUNCTION get_unit_of_measure_usage(p_id TEXT)
RETURNS TABLE ("tableName" TEXT, "count" BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, util, pg_temp
AS $$
DECLARE
  uom RECORD;
  allowed TEXT[];
BEGIN
  SELECT "code", "companyId" INTO uom
  FROM "unitOfMeasure"
  WHERE "id" = p_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- COALESCE is load-bearing: get_companies_with_any_role() array_aggs to NULL
  -- (not an empty array) for a caller with no memberships, and `NOT (x = ANY
  -- (NULL))` is NULL, not TRUE — so an unguarded IF would fall through and hand
  -- an anonymous caller the counts. The RLS policies use the same helper safely
  -- because a NULL USING clause filters the row out; inverting it here does not.
  allowed := COALESCE(get_companies_with_any_role(), ARRAY[]::TEXT[]);

  IF NOT (uom."companyId" = ANY (allowed)) THEN
    RAISE EXCEPTION 'Not authorized to read this unit of measure'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT u."tableName", u."count"
    FROM util.unit_of_measure_usage(uom."code", uom."companyId") u
    ORDER BY u."count" DESC, u."tableName";
END;
$$;

-- No REVOKE here: EXECUTE is granted broadly on every public function by
-- Supabase's own DDL trigger, so the role check above is the gate, exactly as it
-- is for get_claims and get_companies_with_any_role. An unauthenticated caller
-- resolves to no companies and is refused.

CREATE OR REPLACE FUNCTION prevent_unit_of_measure_deletion_when_in_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, util, pg_temp
AS $$
DECLARE
  usage TEXT;
BEGIN
  -- The company itself is being deleted; let the cascade through.
  IF NOT EXISTS (SELECT 1 FROM "company" WHERE id = OLD."companyId") THEN
    RETURN OLD;
  END IF;

  SELECT string_agg(format('%s (%s)', u."tableName", u."count"), ', ' ORDER BY u."count" DESC)
  INTO usage
  FROM util.unit_of_measure_usage(OLD."code", OLD."companyId") u;

  IF usage IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot delete unit of measure "%" because it is in use: %', OLD."code", usage
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "prevent_unit_of_measure_deletion_when_in_use_trigger" ON "unitOfMeasure";
CREATE TRIGGER "prevent_unit_of_measure_deletion_when_in_use_trigger"
  BEFORE DELETE ON "unitOfMeasure"
  FOR EACH ROW EXECUTE FUNCTION prevent_unit_of_measure_deletion_when_in_use();
