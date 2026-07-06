-- Tenant-integrity FKs for customer/supplier references.
--
-- Every FK that referenced customer("id") / supplier("id") from a table that
-- carries a "companyId" column is converted to a composite FK on
-- (<column>, "companyId") -> (id, "companyId"), so the database itself rejects
-- a row in company A pointing at a customer/supplier owned by company B.
-- Single-column FKs allowed exactly that (see prod: a salesOrder + opportunity
-- referencing another company's customer, and one supplierPart), which also
-- breaks company export ("NOT-NULL reference(s) escape company scope").
--
-- Written to NEVER fail on pre-existing bad rows: constraints are re-added
-- NOT VALID (new writes enforced immediately), then validated one by one --
-- a constraint whose existing rows violate it stays NOT VALID with a WARNING
-- listing it. After cleaning the offending rows run:
--   ALTER TABLE "<table>" VALIDATE CONSTRAINT "<constraint>";

-- Composite FK targets need a unique index on (id, "companyId"); id alone is
-- already the PK, so this is trivially unique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_id_companyId_key' AND conrelid = '"customer"'::regclass
  ) THEN
    ALTER TABLE "customer" ADD CONSTRAINT "customer_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_id_companyId_key' AND conrelid = '"supplier"'::regclass
  ) THEN
    ALTER TABLE "supplier" ADD CONSTRAINT "supplier_id_companyId_key" UNIQUE ("id", "companyId");
  END IF;
END $$;

DO $$
DECLARE
  fk RECORD;
  delete_rule TEXT;
  update_rule TEXT;
  defer_clause TEXT;
BEGIN
  FOR fk IN
    SELECT
      con.conname,
      child.relname AS child_table,
      parent.relname AS parent_table,
      att.attname AS child_column,
      con.confdeltype,
      con.confupdtype,
      con.condeferrable,
      con.condeferred
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    JOIN pg_attribute refatt
      ON refatt.attrelid = con.confrelid AND refatt.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND parent.relname IN ('customer', 'supplier')
      AND array_length(con.conkey, 1) = 1     -- single-column FKs only
      AND refatt.attname = 'id'
      -- the child must be tenant-scoped itself, or there is nothing to pin
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = con.conrelid
          AND a.attname = 'companyId'
          AND NOT a.attisdropped
      )
    ORDER BY child.relname, con.conname
  LOOP
    -- ON UPDATE SET NULL/SET DEFAULT on a composite FK would also null/default
    -- "companyId" (PG only supports a column list for ON DELETE). No current FK
    -- uses these; if one appears, leave it alone rather than corrupt tenancy.
    IF fk.confupdtype IN ('n', 'd') THEN
      RAISE WARNING 'composite-tenant-fks: skipping %.% (ON UPDATE SET NULL/DEFAULT cannot be made composite safely)',
        fk.child_table, fk.conname;
      CONTINUE;
    END IF;

    update_rule := CASE fk.confupdtype
      WHEN 'c' THEN 'ON UPDATE CASCADE'
      WHEN 'r' THEN 'ON UPDATE RESTRICT'
      ELSE ''
    END;

    -- SET NULL / SET DEFAULT must clear only the referencing column, never
    -- "companyId" (PG15 column-list form).
    delete_rule := CASE fk.confdeltype
      WHEN 'c' THEN 'ON DELETE CASCADE'
      WHEN 'r' THEN 'ON DELETE RESTRICT'
      WHEN 'n' THEN format('ON DELETE SET NULL (%I)', fk.child_column)
      WHEN 'd' THEN format('ON DELETE SET DEFAULT (%I)', fk.child_column)
      ELSE ''
    END;

    defer_clause := CASE
      WHEN fk.condeferrable AND fk.condeferred THEN 'DEFERRABLE INITIALLY DEFERRED'
      WHEN fk.condeferrable THEN 'DEFERRABLE'
      ELSE ''
    END;

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.child_table, fk.conname);
    -- Same constraint name: PostgREST embeds and any FK-name hints keep resolving.
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, "companyId") REFERENCES %I ("id", "companyId") %s %s %s NOT VALID',
      fk.child_table, fk.conname, fk.child_column, fk.parent_table,
      update_rule, delete_rule, defer_clause
    );

    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.child_table, fk.conname);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'composite-tenant-fks: %.% has pre-existing cross-company rows and stays NOT VALID -- clean them up, then run: ALTER TABLE "%" VALIDATE CONSTRAINT "%"; (%)',
        fk.child_table, fk.conname, fk.child_table, fk.conname, SQLERRM;
    END;
  END LOOP;
END $$;
