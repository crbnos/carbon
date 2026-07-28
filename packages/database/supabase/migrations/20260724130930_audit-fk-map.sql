-- FK topology for audit-log snapshots.
--
-- The audit handler freezes FK targets' display values into diffs
-- ("Supplier: Acme → Bolton") so history stays readable after renames or
-- deletes. Which column points at which table was previously hand-declared
-- per FK in audit.config.ts (`snapshotFields`) — 15 columns covered out of
-- the ~280 business FKs on audited tables. Postgres already knows the
-- topology; this function exposes it so the handler can resolve every FK
-- automatically, with audit.config.ts only supplying per-target display
-- columns (`fkDisplayRegistry`).
--
-- For each FK constraint on the given tables, returns the local column that
-- references the target's "id" column. Composite FKs like
-- (col, companyId) → (id, companyId) are handled by pairing conkey/confkey
-- positionally and keeping only the id-referencing pair. FKs that reference
-- a non-id column (e.g. currencyCode.code) are excluded — the snapshot
-- lookup queries the target by id.
--
-- "targetHasCompanyId" tells the handler whether the snapshot lookup can be
-- tenant-scoped (most tables) or not (e.g. "user").

CREATE OR REPLACE FUNCTION public.get_foreign_key_map(p_table_names TEXT[])
RETURNS TABLE(
  "tableName" TEXT,
  "columnName" TEXT,
  "targetTable" TEXT,
  "targetHasCompanyId" BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    c.relname::TEXT,
    a.attname::TEXT,
    tc.relname::TEXT,
    EXISTS (
      SELECT 1 FROM pg_attribute ca
      WHERE ca.attrelid = con.confrelid
        AND ca.attname = 'companyId'
        AND NOT ca.attisdropped
    )
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class tc ON tc.oid = con.confrelid
  JOIN pg_namespace tn ON tn.oid = tc.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS k(attnum, refattnum)
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
  JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.refattnum
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
    AND tn.nspname = 'public'
    AND ra.attname = 'id'
    AND a.attname <> 'id'
    AND c.relname = ANY(p_table_names)
$$;
