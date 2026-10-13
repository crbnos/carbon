-- The change log ("tableChange") is UNLOGGED, so crash recovery empties it. A
-- reader must then be told to fetch everything again. It was told by the
-- postmaster's start time, which does not change when a backend crashes and the
-- postmaster recovers in place: the log came back empty under the same epoch,
-- and a client that had been away was answered "no changes".
--
-- The epoch is now a token kept in a second UNLOGGED table, emptied by the same
-- recovery that empties the log. No token means "reset" until the hourly purge
-- writes a new one. A clean restart keeps both, so it resets nobody.

CREATE UNLOGGED TABLE IF NOT EXISTS util."tableChangeEpoch" (
  "id" BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("id"),
  "token" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT
);

INSERT INTO util."tableChangeEpoch" DEFAULT VALUES ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.table_changes_since(
  p_company_id TEXT,
  p_xid TEXT DEFAULT NULL,
  p_epoch TEXT DEFAULT NULL,
  p_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- NULL after a crash, until util.purge_table_changes() writes a new token.
  v_epoch TEXT := (SELECT "token" FROM util."tableChangeEpoch");
  v_reset BOOLEAN;
  v_changes JSONB := '{}'::JSONB;
BEGIN
  IF NOT (p_company_id = ANY (COALESCE(public.get_companies_with_employee_role(), ARRAY[]::TEXT[]))) THEN
    RAISE EXCEPTION 'Not a member of this company' USING ERRCODE = '42501';
  END IF;

  v_reset := p_xid IS NULL
    OR v_epoch IS NULL
    OR p_epoch IS DISTINCT FROM v_epoch
    OR p_at IS NULL
    OR p_at < pg_catalog.now() - (util.table_change_retention() - interval '1 day');

  IF NOT v_reset THEN
    SELECT COALESCE(pg_catalog.jsonb_object_agg(c."table", c.ids), '{}'::JSONB)
      INTO v_changes
      FROM (
        SELECT "table",
               CASE WHEN pg_catalog.bool_or("rowId" IS NULL) THEN NULL
                    ELSE pg_catalog.to_jsonb(pg_catalog.array_agg(DISTINCT "rowId")) END AS ids
          FROM public."tableChange"
         WHERE "companyId" = p_company_id AND "xid" >= p_xid::XID8
         GROUP BY "table"
      ) c;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'reset', v_reset,
    'changes', v_changes,
    -- Every transaction older than the snapshot's xmin has finished, so every
    -- change it logged is visible above. Anything at or after it is asked for
    -- again next time.
    'xid', pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot())::TEXT,
    'epoch', v_epoch,
    'at', pg_catalog.now()
  );
END;
$$;

-- Retention, hourly; and a new epoch after a crash took the last one.
CREATE OR REPLACE FUNCTION util.purge_table_changes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public."tableChange"
   WHERE "createdAt" < pg_catalog.now() - util.table_change_retention();
  INSERT INTO util."tableChangeEpoch" DEFAULT VALUES ON CONFLICT DO NOTHING;
$$;

REVOKE ALL ON FUNCTION util.purge_table_changes() FROM PUBLIC;
